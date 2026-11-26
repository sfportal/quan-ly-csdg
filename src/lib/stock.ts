// Sổ kho: mọi biến động của lô lấy từ một nguồn duy nhất, dùng chung cho tồn kho, sổ chi tiết, tổng hợp và đối soát.
import { all, one } from './db';

/**
 * Biến động của lô (tham số ?1 = tenant):
 * buy nhập mua, made sản xuất ra, use đưa vào công đoạn, ship xuất bán, adj điều chỉnh (kiểm kê, hủy, hao hụt).
 * g là gam có dấu, v là giá trị có dấu theo giá thành của lô.
 */
export const MV = `WITH mv AS (
  SELECT l.id lot, l.date d, CASE WHEN l.ticket_id IS NOT NULL THEN 'buy' ELSE 'made' END k, l.qty_in_g g, l.cost_total v,
         COALESCE(l.ticket_id, l.work_id) doc, l.created_at ts FROM lots l WHERE l.tenant_id=?1
  UNION ALL SELECT x.lot_id, w.date, 'use', -x.qty_g, -x.cost, w.id, w.created_at FROM work_inputs x JOIN works w ON w.id=x.work_id WHERE x.tenant_id=?1
  UNION ALL SELECT ol.lot_id, o.date, 'ship', -ol.qty_g, -ol.cost, o.id, COALESCE(o.shipped_at, o.created_at) FROM order_lines ol JOIN orders o ON o.id=ol.order_id WHERE ol.tenant_id=?1 AND o.status='shipped'
  UNION ALL SELECT a.lot_id, j.date, 'adj', a.delta_g, a.cost, j.id, j.created_at FROM adjust_lines a JOIN adjusts j ON j.id=a.adjust_id WHERE a.tenant_id=?1)`;

export const MVK: Record<string, string> = { buy: 'Nhập mua', made: 'Sản xuất ra', use: 'Đưa vào công đoạn', ship: 'Xuất bán', adj: 'Điều chỉnh, hủy' };

export type Check = { name: string; how: string; n: number; bad: { ref: string; msg: string; href?: string }[] };

/** Tự đối soát: tính lại từ chứng từ gốc theo cách độc lập rồi so với số đang lưu. */
export async function reconcile(tenantId: string): Promise<Check[]> {
  const out: Check[] = [];
  const kg = (g: number) => (g / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 3 }) + ' kg';
  const dg = (d: number) => Math.round(d).toLocaleString('vi-VN') + ' đ';
  const cnt = async (sql: string) => (await one<any>(sql, tenantId))?.n || 0;

  const lot = await all<any>(
    `${MV} SELECT l.id, l.code, l.qty_g, s.q FROM lots l JOIN (SELECT lot, SUM(g) q FROM mv GROUP BY lot) s ON s.lot=l.id WHERE l.tenant_id=?1 AND l.qty_g<>s.q LIMIT 50`, tenantId);
  out.push({ name: 'Tồn của từng lô khớp với chứng từ', how: 'Số lúc tạo lô, trừ các lần đưa vào công đoạn, trừ các lần xuất bán, cộng trừ điều chỉnh phải bằng số tồn đang ghi.',
    n: await cnt(`SELECT COUNT(*) n FROM lots WHERE tenant_id=?`),
    bad: lot.map((l) => ({ ref: l.code, msg: `sổ ghi tồn ${kg(l.qty_g)}, tính lại từ chứng từ ra ${kg(l.q)}`, href: `/app/truy-xuat?lot=${l.id}` })) });

  const neg = await all<any>(`SELECT id, code, qty_g FROM lots WHERE tenant_id=? AND qty_g<0 LIMIT 50`, tenantId);
  out.push({ name: 'Không có lô nào tồn âm', how: 'Tồn của mọi lô phải từ 0 trở lên.', n: out[0].n,
    bad: neg.map((l) => ({ ref: l.code, msg: `tồn ${kg(l.qty_g)}`, href: `/app/truy-xuat?lot=${l.id}` })) });

  const tk = await all<any>(
    `SELECT w.id, w.code, w.total_g, w.total_amount, COALESCE(s.g,0) g, COALESCE(s.d,0) d, COALESCE(s.lg,0) lg FROM weigh_tickets w
     LEFT JOIN (SELECT x.ticket_id, SUM(x.net_g) g, SUM(x.amount) d, SUM(l.qty_in_g) lg FROM weigh_lines x LEFT JOIN lots l ON l.id=x.lot_id WHERE x.tenant_id=?1 GROUP BY x.ticket_id) s ON s.ticket_id=w.id
     WHERE w.tenant_id=?1 AND (w.total_g<>COALESCE(s.g,0) OR w.total_amount<>COALESCE(s.d,0) OR COALESCE(s.g,0)<>COALESCE(s.lg,0)) LIMIT 50`, tenantId);
  out.push({ name: 'Phiếu cân khớp với các dòng cân và lô nhập', how: 'Tổng kg và tổng tiền của phiếu phải bằng tổng các dòng; mỗi dòng cân phải có một lô đúng số kg.',
    n: await cnt(`SELECT COUNT(*) n FROM weigh_tickets WHERE tenant_id=? AND void_at IS NULL`),
    bad: tk.map((w) => ({ ref: w.code, msg: `phiếu ghi ${kg(w.total_g)}, ${dg(w.total_amount)}; các dòng cộng lại ${kg(w.g)}, ${dg(w.d)}; lô nhập ${kg(w.lg)}`, href: `/app/can/${w.id}` })) });

  const wk = await all<any>(
    `SELECT w.id, w.code, w.in_g, w.out_g, w.by_g, w.in_cost,
       COALESCE((SELECT SUM(qty_g) FROM work_inputs x WHERE x.work_id=w.id),0) ig, COALESCE((SELECT SUM(cost) FROM work_inputs x WHERE x.work_id=w.id),0) ic,
       COALESCE((SELECT SUM(qty_g) FROM work_outputs x WHERE x.work_id=w.id),0) og, COALESCE((SELECT SUM(qty_in_g) FROM lots l WHERE l.work_id=w.id),0) lg
     FROM works w WHERE w.tenant_id=?1 AND (w.in_g<>ig OR w.out_g+w.by_g<>og OR og<>lg OR w.in_cost<>ic) LIMIT 50`, tenantId);
  out.push({ name: 'Lệnh công đoạn khớp với lô vào, lô ra', how: 'Kg và giá trị đầu vào của lệnh phải bằng tổng các lô đầu vào; kg đầu ra phải bằng tổng các lô được tạo.',
    n: await cnt(`SELECT COUNT(*) n FROM works WHERE tenant_id=? AND void_at IS NULL`),
    bad: wk.map((w) => ({ ref: w.code, msg: `lệnh ghi vào ${kg(w.in_g)}, ra ${kg(w.out_g + w.by_g)}; lô vào cộng lại ${kg(w.ig)}, lô ra ${kg(w.lg)}`, href: `/app/cong-doan/${w.id}` })) });

  const od = await all<any>(
    `SELECT o.id, o.code, o.cogs, o.revenue, COALESCE(s.c,0) c, COALESCE(s.a,0) a FROM orders o
     LEFT JOIN (SELECT order_id, SUM(cost) c, SUM(amount) a FROM order_lines WHERE tenant_id=?1 GROUP BY order_id) s ON s.order_id=o.id
     WHERE o.tenant_id=?1 AND ((o.status='shipped' AND o.cogs<>COALESCE(s.c,0)) OR o.revenue<>COALESCE(s.a,0)) LIMIT 50`, tenantId);
  out.push({ name: 'Đơn hàng khớp với các dòng hàng', how: 'Doanh thu của đơn phải bằng tổng thành tiền các dòng; giá vốn của đơn đã xuất phải bằng tổng giá vốn các dòng.',
    n: await cnt(`SELECT COUNT(*) n FROM orders WHERE tenant_id=?`),
    bad: od.map((o) => ({ ref: o.code, msg: `đơn ghi doanh thu ${dg(o.revenue)}, giá vốn ${dg(o.cogs)}; các dòng cộng lại ${dg(o.a)}, ${dg(o.c)}`, href: `/app/don-hang/${o.id}` })) });

  const pay = await all<any>(
    `SELECT 'Phiếu cân' k, w.id, w.code, w.paid, COALESCE((SELECT SUM(amount) FROM payments p WHERE p.tenant_id=?1 AND p.ref_type='ticket' AND p.ref_id=w.id),0) s, '/app/can/' u FROM weigh_tickets w WHERE w.tenant_id=?1 AND w.paid<>s
     UNION ALL SELECT 'Đơn', o.id, o.code, o.paid, COALESCE((SELECT SUM(amount) FROM payments p WHERE p.tenant_id=?1 AND p.ref_type='order' AND p.ref_id=o.id),0) s, '/app/don-hang/' FROM orders o WHERE o.tenant_id=?1 AND o.paid<>s LIMIT 50`, tenantId);
  out.push({ name: 'Tiền đã thu, đã chi khớp với các khoản ghi', how: 'Số đã trả của phiếu cân và số đã thu của đơn phải bằng tổng các khoản thu chi đã ghi.',
    n: await cnt(`SELECT COUNT(*) n FROM payments WHERE tenant_id=?`),
    bad: pay.map((p) => ({ ref: p.code, msg: `${p.k} ghi ${dg(p.paid)}, các khoản cộng lại ${dg(p.s)}`, href: p.u + p.id })) });

  // Giá trị: sai số làm tròn tối đa 1 đồng cho mỗi biến động
  const val = await all<any>(
    `${MV} SELECT l.id, l.code, l.cost_total*1.0*l.qty_g/l.qty_in_g hand, s.v, s.n FROM lots l JOIN (SELECT lot, SUM(v) v, COUNT(*) n FROM mv GROUP BY lot) s ON s.lot=l.id
     WHERE l.tenant_id=?1 AND ABS(l.cost_total*1.0*l.qty_g/l.qty_in_g - s.v) > s.n + 1 LIMIT 50`, tenantId);
  out.push({ name: 'Giá trị tồn của từng lô khớp với giá vốn đã chuyển đi', how: 'Giá thành của lô, trừ giá trị đã chuyển sang lệnh, đã tính vào giá vốn đơn và đã điều chỉnh, phải bằng giá trị tồn (cho phép lệch do làm tròn, tối đa 1 đồng mỗi lần phát sinh).',
    n: out[0].n, bad: val.map((l) => ({ ref: l.code, msg: `giá trị tồn ${dg(l.hand)}, tính lại từ chứng từ ra ${dg(l.v)}`, href: `/app/truy-xuat?lot=${l.id}` })) });
  return out;
}
