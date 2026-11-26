import { all, one } from './db';
import { ticketGates, orderGates, getOrder } from './domain';
import type { Proc } from './proc';

const ZERO = { n: 0, in_g: 0, out_g: 0, by_g: 0, loss_g: 0, in_cost: 0, extra_cost: 0, by_value: 0, loss_cost: 0, exp_g: 0 };
const addUp = (rows: any[]) => rows.reduce((a, r) => { for (const k of Object.keys(ZERO)) a[k] += r[k] || 0; return a; }, { ...ZERO });

/**
 * Số liệu theo từng quy trình: mỗi bước vào bao nhiêu, ra bao nhiêu, hao hụt, chi phí; cả chuỗi 100 kg đầu vào ra bao nhiêu thành phẩm,
 * giá nguyên liệu, giá thành, giá bán. Bước dùng chung với quy trình khác mà chưa có lệnh riêng thì lấy số chung.
 */
export async function procStats(tenantId: string, procs: Proc[], from = '', to = '9999') {
  const w = await all<any>(
    `SELECT process_id pid, type, COUNT(*) n, SUM(in_g) in_g, SUM(out_g) out_g, SUM(by_g) by_g, SUM(loss_g) loss_g, SUM(in_cost) in_cost, SUM(extra_cost) extra_cost, SUM(by_value) by_value, SUM(loss_cost) loss_cost, SUM(in_g*norm/1000) exp_g
     FROM works WHERE tenant_id=? AND void_at IS NULL AND date>=? AND date<=? GROUP BY process_id, type`, tenantId, from, to);
  const sales = await all<any>(
    `SELECT w.process_id pid, l.stage, SUM(ol.qty_g) g, SUM(ol.amount) rev, SUM(ol.cost) cost FROM order_lines ol JOIN orders o ON o.id=ol.order_id JOIN lots l ON l.id=ol.lot_id LEFT JOIN works w ON w.id=l.work_id
     WHERE ol.tenant_id=? AND o.status='shipped' AND o.date>=? AND o.date<=? GROUP BY w.process_id, l.stage`, tenantId, from, to);
  const stock = await all<any>(
    `SELECT w.process_id pid, l.stage, SUM(l.qty_g) g, COUNT(*) n, MIN(l.date) oldest, SUM(l.cost_total*1.0*l.qty_g/l.qty_in_g) v, SUM(l.status='hold') hold, SUM(l.boxes) boxes
     FROM lots l JOIN items i ON i.id=l.item_id LEFT JOIN works w ON w.id=l.work_id WHERE l.tenant_id=? AND l.qty_g>0 AND i.kind<>'PP' GROUP BY w.process_id, l.stage`, tenantId);
  const raw = stock.filter((x) => x.stage === 'receive');
  const list = procs.map((p) => {
    const own = p.steps.map((s) => w.find((x) => x.pid === p.id && x.type === s.skey));
    const steps = p.steps.map((s, i) => {
      // Bước dùng chung với quy trình khác (ví dụ phân loại): chỉ mượn số chung khi quy trình này đã có lệnh ở bước sau
      let r = own[i], shared = false;
      if (!r && own.slice(i + 1).some(Boolean)) { const o = w.filter((x) => x.type === s.skey); if (o.length) { r = addUp(o); shared = true; } }
      r = r || { ...ZERO };
      let st = stock.find((x) => x.pid === p.id && x.stage === s.skey), stShared = false;
      if (!st && !s.last) { const o = stock.filter((x) => x.stage === s.skey); if (o.length) { stShared = true; st = { ...o[0], g: o.reduce((a, x) => a + x.g, 0), n: o.reduce((a, x) => a + x.n, 0), v: o.reduce((a, x) => a + x.v, 0), hold: o.reduce((a, x) => a + x.hold, 0), boxes: o.reduce((a, x) => a + x.boxes, 0), oldest: o.map((x) => x.oldest).sort()[0] }; } }
      const pool = r.in_cost + r.extra_cost - r.by_value;
      return { s, r, shared, stShared, stock: st || { g: 0, n: 0, oldest: '', v: 0, hold: 0, boxes: 0 }, y: r.in_g ? r.out_g / r.in_g : null, unitIn: r.in_g ? r.in_cost / r.in_g * 1000 : 0, unitOut: r.out_g ? pool / r.out_g * 1000 : 0 };
    });
    const has = steps.filter((x) => x.y != null);
    const full = steps.length > 0 && has.length === steps.length;
    const yld = has.length ? has.reduce((a, x) => a * x.y!, 1) : null;
    const first = steps[0], last = steps[steps.length - 1];
    const sale = sales.find((x) => x.pid === p.id && x.stage === last?.s.skey);
    return { p, steps, full, yld, rawUnit: first?.unitIn || 0, cogsUnit: last?.unitOut || 0, outG: last?.r.out_g || 0, inG: first?.r.in_g || 0,
      lossCost: steps.reduce((a, x) => a + (x.shared ? 0 : x.r.loss_cost), 0), extraCost: steps.reduce((a, x) => a + (x.shared ? 0 : x.r.extra_cost), 0),
      sale: sale ? { g: sale.g, price: sale.g ? sale.rev / sale.g * 1000 : 0, cost: sale.g ? sale.cost / sale.g * 1000 : 0, rev: sale.rev, cogs: sale.cost } : null };
  });
  return { list, raw: { g: raw.reduce((a, x) => a + x.g, 0), n: raw.reduce((a, x) => a + x.n, 0), v: raw.reduce((a, x) => a + x.v, 0), oldest: raw.map((x) => x.oldest).sort()[0] || '', hold: raw.reduce((a, x) => a + x.hold, 0) } };
}

/** Danh sách việc cần xử lý: cổng kiểm soát chưa đạt, lô bị giữ, hàng tồn lâu. */
export async function alerts(t: any) {
  const out: { level: 'miss' | 'wait'; text: string; href: string }[] = [];
  const tks = await all<any>(`SELECT w.*, p.area_expiry FROM weigh_tickets w JOIN partners p ON p.id=w.partner_id WHERE w.tenant_id=? AND w.void_at IS NULL ORDER BY w.date DESC LIMIT 100`, t.id);
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
