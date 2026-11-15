import { all, one } from './db';
import { ticketGates, orderGates, getOrder } from './domain';

/** Quy đổi và hao hụt theo công đoạn; lệnh đóng gói tách theo dòng trái tươi và dòng cấp đông. */
export async function stageStats(tenantId: string, from = '', to = '9999') {
  const rows = await all<any>(
    `SELECT type, src, COUNT(*) n, SUM(in_g) in_g, SUM(out_g) out_g, SUM(by_g) by_g, SUM(loss_g) loss_g, SUM(in_cost) in_cost, SUM(extra_cost) extra_cost, SUM(by_value) by_value, SUM(loss_cost) loss_cost, SUM(in_g*norm/1000) exp_g
     FROM (SELECT w.*, (SELECT l.stage FROM work_inputs x JOIN lots l ON l.id=x.lot_id WHERE x.work_id=w.id LIMIT 1) src FROM works w WHERE w.tenant_id=? AND w.date>=? AND w.date<=?)
     GROUP BY type, CASE WHEN type='pack' THEN src ELSE '' END`, tenantId, from, to);
  const key = (r: any) => (r.type === 'pack' ? (r.src === 'freeze' ? 'packFrozen' : 'packFresh') : r.type);
  const m: Record<string, any> = {};
  for (const r of rows) m[key(r)] = r;
  const y = (k: string) => (m[k] && m[k].in_g ? m[k].out_g / m[k].in_g : null);
  const mul = (...ks: string[]) => ks.reduce((a: number | null, k) => (a == null || y(k) == null ? null : a * y(k)!), 1);
  return { m, yieldFresh: m.packFresh ? mul('sort', 'packFresh') : null, yieldFrozen: m.peel ? mul('sort', 'peel', 'freeze', 'packFrozen') ?? mul('sort', 'peel', 'freeze') ?? mul('sort', 'peel') : null };
}

/** Danh sách việc cần xử lý: cổng kiểm soát chưa đạt, lô bị giữ, hàng tồn lâu. */
export async function alerts(t: any) {
  const out: { level: 'miss' | 'wait'; text: string; href: string }[] = [];
  const tks = await all<any>(`SELECT w.*, p.area_expiry FROM weigh_tickets w JOIN partners p ON p.id=w.partner_id WHERE w.tenant_id=? ORDER BY w.date DESC LIMIT 100`, t.id);
  for (const tk of tks) for (const g of ticketGates(tk, tk)) if (g.state !== 'ok') out.push({ level: g.key === 'g2' ? 'miss' : 'wait', text: `Phiếu ${tk.code}: ${g.msg}`, href: `/app/can/${tk.id}` });
  const drafts = await all<any>(`SELECT id FROM orders WHERE tenant_id=? AND status='draft' ORDER BY date LIMIT 10`, t.id);
  for (const d of drafts) {
    const o = await getOrder(t.id, d.id);
    const bad = orderGates(t, o).filter((g) => g.state !== 'ok');
    out.push({ level: bad.some((g) => g.state === 'miss') ? 'miss' : 'wait', text: bad.length ? `Đơn ${o.code} chưa xuất được: ${bad.map((g) => g.name.toLowerCase()).join(', ')}.` : `Đơn ${o.code} đã đủ điều kiện, chờ xuất hàng.`, href: `/app/don-hang/${o.id}` });
  }
  const holds = await all<any>(`SELECT id, code, qty_g FROM lots WHERE tenant_id=? AND status='hold' AND qty_g>0`, t.id);
  for (const l of holds) out.push({ level: 'miss', text: `Lô ${l.code} đang bị giữ, còn ${l.qty_g / 1000} kg.`, href: `/app/truy-xuat?lot=${l.id}` });
  const old = await all<any>(`SELECT l.id, l.code, l.qty_g, l.date FROM lots l JOIN items i ON i.id=l.item_id WHERE l.tenant_id=? AND l.qty_g>0 AND l.status='ok' AND l.stage IN ('receive','sort') AND i.kind<>'PP' AND l.date <= date('now','+7 hours','-3 days') ORDER BY l.date LIMIT 10`, t.id);
  for (const l of old) out.push({ level: 'wait', text: `Lô ${l.code} nhập từ ${l.date.slice(8, 10)}/${l.date.slice(5, 7)}, còn ${l.qty_g / 1000} kg trái chưa xử lý: nguy cơ hao hụt tự nhiên.`, href: `/app/truy-xuat?lot=${l.id}` });
  return out;
}

export async function totals(tenantId: string, from = '', to = '9999') {
  const buy = await one<any>(`SELECT COALESCE(SUM(total_g),0) g, COALESCE(SUM(total_amount),0) d, COALESCE(SUM(CASE WHEN source<>'own' THEN total_amount-paid ELSE 0 END),0) debt FROM weigh_tickets WHERE tenant_id=? AND date>=? AND date<=?`, tenantId, from, to);
  const sell = await one<any>(`SELECT COALESCE(SUM(revenue),0) rev, COALESCE(SUM(deduct),0) ded, COALESCE(SUM(cogs),0) cogs, COALESCE(SUM(trip_cost),0) trip, COALESCE(SUM(paid),0) paid, COUNT(*) n,
      COALESCE((SELECT SUM(qty_g) FROM order_lines l JOIN orders o2 ON o2.id=l.order_id WHERE o2.tenant_id=?1 AND o2.status='shipped' AND o2.date>=?2 AND o2.date<=?3),0) g
     FROM orders WHERE tenant_id=?1 AND status='shipped' AND date>=?2 AND date<=?3`, tenantId, from, to);
  const stock = await all<any>(`SELECT i.kind, SUM(l.qty_g) g, SUM(l.cost_total*1.0*l.qty_g/l.qty_in_g) v FROM lots l JOIN items i ON i.id=l.item_id WHERE l.tenant_id=? AND l.qty_g>0 GROUP BY i.kind`, tenantId);
  const net = sell.rev - sell.ded;
  return { buy, sell: { ...sell, net, profit: net - sell.cogs - sell.trip, recv: net - sell.paid }, stock };
}
