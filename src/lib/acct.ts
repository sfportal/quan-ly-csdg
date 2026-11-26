// Phân hệ kế toán: các bảng số liệu gốc theo kỳ, dùng chung cho xem trên màn hình và xuất Excel.
// Chỉ lấy chứng từ còn hiệu lực (không lấy chứng từ đã hủy, đơn chưa xuất). Khối lượng tính bằng kg, tiền bằng đồng.
import { all } from './db';
import { MV } from './stock';
import { ADJ } from './domain';
import { SOURCE, CUST, PAY, KIND } from './fmt';
import type { Sheet } from './xlsx';

export type Tab = Sheet & { key: string; label: string; note: string; kpi: [string, number, 'm' | 'k' | 'n'][] };
const K = (g: number) => Math.round(g) / 1000;
const sum = (rows: any[][], i: number) => rows.reduce((a, r) => a + (Number(r[i]) || 0), 0);

export async function acctTabs(t: any, from: string, to: string, SN: Record<string, string>): Promise<Tab[]> {
  const id = t.id;
  // 1. Mua hàng
  const buy = (await all<any>(
    `SELECT w.date, w.code, p.name, p.tax_code, w.source, w.area_code, i.code icode, i.name item, lt.code lot, l.net_g, l.price, l.amount, w.pay_method,
       w.doc_invoice, w.doc_list, w.doc_contract
     FROM weigh_lines l JOIN weigh_tickets w ON w.id=l.ticket_id JOIN partners p ON p.id=w.partner_id JOIN items i ON i.id=l.item_id LEFT JOIN lots lt ON lt.id=l.lot_id
     WHERE l.tenant_id=? AND w.void_at IS NULL AND w.date>=? AND w.date<=? ORDER BY w.date, w.code, l.rowid`, id, from, to))
    .map((r) => [r.date, r.code, r.name, r.tax_code, SOURCE[r.source] || r.source, r.area_code, r.icode, r.item, r.lot, K(r.net_g), r.price, r.amount, PAY[r.pay_method] || r.pay_method,
      [r.doc_invoice && 'hóa đơn', r.doc_list && 'bảng kê', r.doc_contract && (r.source === 'own' ? 'phiếu nội bộ' : 'hợp đồng')].filter(Boolean).join(', ')]);
  // 2. Bán hàng
  const sell = (await all<any>(
    `SELECT o.date, o.code, p.name, p.tax_code, o.type, i.code icode, i.name item, lt.code lot, l.boxes, l.qty_g, l.price, l.amount, l.cost, o.container
     FROM order_lines l JOIN orders o ON o.id=l.order_id JOIN partners p ON p.id=o.customer_id JOIN items i ON i.id=l.item_id JOIN lots lt ON lt.id=l.lot_id
     WHERE l.tenant_id=? AND o.status='shipped' AND o.date>=? AND o.date<=? ORDER BY o.date, o.code, l.rowid`, id, from, to))
    .map((r) => [r.date, r.code, r.name, r.tax_code, CUST[r.type] || r.type, r.icode, r.item, r.lot, r.boxes || '', K(r.qty_g), r.price, r.amount, r.cost, r.amount - r.cost, r.container]);
  // 3. Khoản trừ và chi phí của đơn
  const oc = (await all<any>(
    `SELECT o.date, o.code, p.name, c.kind, c.name cname, c.amount FROM order_costs c JOIN orders o ON o.id=c.order_id JOIN partners p ON p.id=o.customer_id
     WHERE c.tenant_id=? AND o.status='shipped' AND o.date>=? AND o.date<=? ORDER BY o.date, o.code, c.rowid`, id, from, to))
    .map((r) => [r.date, r.code, r.name, r.kind === 'deduct' ? 'Khách trừ trên tiền hàng' : 'Chi phí chuyến hàng', r.cname, r.amount]);
  // 4. Thu, chi
  const pay = (await all<any>(
    `SELECT p.date, p.dir, p.method, p.amount, p.note, COALESCE(w.code, o.code) code, COALESCE(sp.name, cp.name) who, COALESCE(sp.tax_code, cp.tax_code) tax
     FROM payments p LEFT JOIN weigh_tickets w ON p.ref_type='ticket' AND w.id=p.ref_id LEFT JOIN partners sp ON sp.id=w.partner_id
       LEFT JOIN orders o ON p.ref_type='order' AND o.id=p.ref_id LEFT JOIN partners cp ON cp.id=o.customer_id
     WHERE p.tenant_id=? AND p.date>=? AND p.date<=? ORDER BY p.date, p.created_at`, id, from, to))
    .map((r) => [r.date, r.dir === 'in' ? 'Thu của khách' : 'Chi cho người bán', r.code, r.who, r.tax, PAY[r.method] || r.method, r.dir === 'in' ? r.amount : '', r.dir === 'out' ? r.amount : '', r.note]);
  // 5. Sản xuất: xuất lô vào công đoạn, nhập lô từ công đoạn, chi phí thêm
  const wk = (await all<any>(
    `SELECT w.date, w.code, w.step_name, w.type, pr.name pname, 1 ord, 'Xuất vào công đoạn' kind, i.code icode, i.name item, i.kind ik, l.code lot, x.qty_g, x.cost, w.created_at ts
       FROM work_inputs x JOIN works w ON w.id=x.work_id JOIN lots l ON l.id=x.lot_id JOIN items i ON i.id=l.item_id LEFT JOIN processes pr ON pr.id=w.process_id WHERE x.tenant_id=?1 AND w.date>=?2 AND w.date<=?3
     UNION ALL SELECT w.date, w.code, w.step_name, w.type, pr.name, 2, CASE i.kind WHEN 'PP' THEN 'Nhập phụ phẩm thu hồi' ELSE 'Nhập từ công đoạn' END, i.code, i.name, i.kind, l.code, x.qty_g, x.cost, w.created_at
       FROM work_outputs x JOIN works w ON w.id=x.work_id JOIN lots l ON l.id=x.lot_id JOIN items i ON i.id=x.item_id LEFT JOIN processes pr ON pr.id=w.process_id WHERE x.tenant_id=?1 AND w.date>=?2 AND w.date<=?3
     UNION ALL SELECT w.date, w.code, w.step_name, w.type, pr.name, 3, 'Chi phí thêm ở công đoạn', '', '', '', '', 0, w.extra_cost, w.created_at
       FROM works w LEFT JOIN processes pr ON pr.id=w.process_id WHERE w.tenant_id=?1 AND w.void_at IS NULL AND w.extra_cost>0 AND w.date>=?2 AND w.date<=?3
     ORDER BY 1, ts, 2, ord`, id, from, to))
    .map((r) => [r.date, r.code, r.step_name || SN[r.type] || r.type, r.pname || '', r.kind, r.icode, r.item, KIND[r.ik] || '', r.lot, r.qty_g ? K(r.qty_g) : '', r.ord === 1 ? r.cost : '', r.ord === 1 ? '' : r.cost]);
  // 6. Điều chỉnh tồn
  const adj = (await all<any>(
    `SELECT a.date, a.code, a.kind, a.reason, i.code icode, i.name item, l.code lot, x.before_g, x.delta_g, x.cost
     FROM adjust_lines x JOIN adjusts a ON a.id=x.adjust_id JOIN lots l ON l.id=x.lot_id JOIN items i ON i.id=x.item_id
     WHERE x.tenant_id=? AND a.date>=? AND a.date<=? ORDER BY a.date, a.code, x.rowid`, id, from, to))
    .map((r) => [r.date, r.code, ADJ[r.kind] || r.kind, r.reason, r.icode, r.item, r.lot, K(r.before_g), K(r.before_g + r.delta_g), K(r.delta_g), r.cost]);
  // 7. Nhập xuất tồn theo mặt hàng, cả lượng và giá trị
  const KS = ['buy', 'made', 'use', 'ship', 'adj'];
  const nxt = (await all<any>(
    `${MV} SELECT i.code, i.name, i.kind, SUM(CASE WHEN m.d<?2 THEN m.g ELSE 0 END) og, SUM(CASE WHEN m.d<?2 THEN m.v ELSE 0 END) ov,
       ${KS.map((k) => `SUM(CASE WHEN m.d>=?2 AND m.k='${k}' THEN m.g ELSE 0 END) g_${k}, SUM(CASE WHEN m.d>=?2 AND m.k='${k}' THEN m.v ELSE 0 END) v_${k}`).join(', ')}, SUM(m.g) cg, SUM(m.v) cv
     FROM mv m JOIN lots l ON l.id=m.lot JOIN items i ON i.id=l.item_id WHERE m.d<=?3 GROUP BY i.id
     ORDER BY CASE i.kind WHEN 'NL' THEN 0 WHEN 'BTP' THEN 1 WHEN 'TP' THEN 2 ELSE 3 END, i.sort, i.code`, id, from, to))
    .map((r) => [r.code, r.name, KIND[r.kind], K(r.og), Math.round(r.ov), K(r.g_buy + r.g_made), Math.round(r.v_buy + r.v_made), K(-r.g_use - r.g_ship), Math.round(-r.v_use - r.v_ship), K(r.g_adj), Math.round(r.v_adj), K(r.cg), Math.round(r.cv)]);
  // 8. Công nợ theo chứng từ phát sinh trong kỳ, số đã trả tính đến lúc xuất
  const debt = (await all<any>(
    `SELECT 'Phải trả người bán' k, w.date, w.code, p.name, p.tax_code, w.total_amount total, w.paid FROM weigh_tickets w JOIN partners p ON p.id=w.partner_id WHERE w.tenant_id=?1 AND w.void_at IS NULL AND w.source<>'own' AND w.date>=?2 AND w.date<=?3
     UNION ALL SELECT 'Phải thu của khách', o.date, o.code, p.name, p.tax_code, o.revenue-o.deduct, o.paid FROM orders o JOIN partners p ON p.id=o.customer_id WHERE o.tenant_id=?1 AND o.status='shipped' AND o.date>=?2 AND o.date<=?3
     ORDER BY 1 DESC, 2, 3`, id, from, to))
    .map((r) => [r.k, r.date, r.code, r.name, r.tax_code, r.total, r.paid, r.total - r.paid]);
  const pt = debt.filter((r) => r[0] === 'Phải trả người bán'), pth = debt.filter((r) => r[0] !== 'Phải trả người bán');

  return [
    { key: 'mua', label: 'Mua hàng', name: 'Mua hang', note: 'Mỗi dòng là một dòng cân của phiếu cân còn hiệu lực. Dùng để ghi nhập kho nguyên liệu và công nợ phải trả.',
      cols: [{ h: 'Ngày', t: 'd' }, { h: 'Số phiếu cân', w: 12 }, { h: 'Nhà cung cấp', w: 28 }, { h: 'Mã số thuế', w: 14 }, { h: 'Nguồn hàng', w: 20 }, { h: 'Mã vùng trồng', w: 16 }, { h: 'Mã hàng', w: 12 }, { h: 'Tên hàng', w: 30 }, { h: 'Mã lô', w: 12 },
        { h: 'Khối lượng tính tiền (kg)', t: 'k', w: 16 }, { h: 'Đơn giá (đ/kg)', t: 'm', w: 13 }, { h: 'Thành tiền (đ)', t: 'm' }, { h: 'Hình thức thanh toán', w: 16 }, { h: 'Chứng từ đã nhận', w: 22 }],
      rows: buy, total: ['Cộng', '', '', '', '', '', '', '', '', sum(buy, 9), '', sum(buy, 11)], kpi: [['Số dòng', buy.length, 'n'], ['Khối lượng mua (kg)', sum(buy, 9), 'k'], ['Tiền mua hàng (đ)', sum(buy, 11), 'm']] },
    { key: 'ban', label: 'Bán hàng', name: 'Ban hang', note: 'Mỗi dòng là một dòng hàng của đơn đã xuất. Doanh thu theo giá bán, chưa trừ khoản khách trừ; giá vốn là giá thành thật của lô.',
      cols: [{ h: 'Ngày', t: 'd' }, { h: 'Số đơn', w: 12 }, { h: 'Khách hàng', w: 28 }, { h: 'Mã số thuế', w: 14 }, { h: 'Kênh bán', w: 18 }, { h: 'Mã hàng', w: 12 }, { h: 'Tên hàng', w: 30 }, { h: 'Mã lô', w: 12 }, { h: 'Số thùng', t: 'n', w: 9 },
        { h: 'Khối lượng (kg)', t: 'k' }, { h: 'Giá bán (đ/kg)', t: 'm', w: 13 }, { h: 'Doanh thu (đ)', t: 'm' }, { h: 'Giá vốn (đ)', t: 'm' }, { h: 'Lãi gộp dòng (đ)', t: 'm' }, { h: 'Số container', w: 16 }],
      rows: sell, total: ['Cộng', '', '', '', '', '', '', '', sum(sell, 8) || '', sum(sell, 9), '', sum(sell, 11), sum(sell, 12), sum(sell, 13)], kpi: [['Khối lượng bán (kg)', sum(sell, 9), 'k'], ['Doanh thu (đ)', sum(sell, 11), 'm'], ['Giá vốn (đ)', sum(sell, 12), 'm']] },
    { key: 'cpdon', label: 'Khoản trừ, chi phí đơn', name: 'Chi phi don hang', note: 'Khoản khách trừ trên tiền hàng làm giảm doanh thu; chi phí chuyến hàng là chi phí bán hàng của đơn.',
      cols: [{ h: 'Ngày', t: 'd' }, { h: 'Số đơn', w: 12 }, { h: 'Khách hàng', w: 28 }, { h: 'Loại', w: 26 }, { h: 'Tên khoản', w: 30 }, { h: 'Số tiền (đ)', t: 'm' }],
      rows: oc, total: ['Cộng', '', '', '', '', sum(oc, 5)], kpi: [['Khách trừ (đ)', sum(oc.filter((r) => r[3].startsWith('Khách')), 5), 'm'], ['Chi phí chuyến hàng (đ)', sum(oc.filter((r) => !r[3].startsWith('Khách')), 5), 'm']] },
    { key: 'thuchi', label: 'Thu, chi', name: 'Thu chi', note: 'Các khoản thu của khách và chi cho người bán đã ghi trong kỳ. Số âm là khoản ghi hoàn.',
      cols: [{ h: 'Ngày', t: 'd' }, { h: 'Loại', w: 18 }, { h: 'Theo chứng từ', w: 13 }, { h: 'Đối tượng', w: 28 }, { h: 'Mã số thuế', w: 14 }, { h: 'Hình thức', w: 14 }, { h: 'Thu (đ)', t: 'm' }, { h: 'Chi (đ)', t: 'm' }, { h: 'Ghi chú', w: 30 }],
      rows: pay, total: ['Cộng', '', '', '', '', '', sum(pay, 6), sum(pay, 7)], kpi: [['Tổng thu (đ)', sum(pay, 6), 'm'], ['Tổng chi (đ)', sum(pay, 7), 'm'], ['Trong đó tiền mặt (đ)', sum(pay.filter((r) => r[5] === PAY.cash), 6) + sum(pay.filter((r) => r[5] === PAY.cash), 7), 'm']] },
    { key: 'sx', label: 'Sản xuất', name: 'San xuat', note: 'Mỗi lệnh công đoạn gồm các dòng xuất lô vào, nhập lô ra và chi phí thêm. Với từng lệnh: giá trị xuất vào + chi phí thêm = giá trị nhập ra.',
      cols: [{ h: 'Ngày', t: 'd' }, { h: 'Số lệnh', w: 12 }, { h: 'Công đoạn', w: 20 }, { h: 'Quy trình', w: 28 }, { h: 'Loại dòng', w: 24 }, { h: 'Mã hàng', w: 12 }, { h: 'Tên hàng', w: 30 }, { h: 'Loại hàng', w: 16 }, { h: 'Mã lô', w: 12 },
        { h: 'Khối lượng (kg)', t: 'k' }, { h: 'Giá trị xuất vào (đ)', t: 'm', w: 18 }, { h: 'Giá trị nhập ra, chi phí (đ)', t: 'm', w: 22 }],
      rows: wk, total: ['Cộng', '', '', '', '', '', '', '', '', '', sum(wk, 10), sum(wk, 11)], kpi: [['Giá trị xuất vào công đoạn (đ)', sum(wk, 10), 'm'], ['Chi phí thêm (đ)', sum(wk.filter((r) => r[4].startsWith('Chi phí')), 11), 'm'], ['Giá trị nhập từ công đoạn (đ)', sum(wk.filter((r) => !r[4].startsWith('Chi phí')), 11), 'm']] },
    { key: 'dc', label: 'Điều chỉnh, hủy hàng', name: 'Dieu chinh ton', note: 'Phiếu kiểm kê, hủy hàng hư, hao hụt bảo quản. Giá trị âm là phần mất, tính theo giá thành của lô.',
      cols: [{ h: 'Ngày', t: 'd' }, { h: 'Số phiếu', w: 12 }, { h: 'Loại', w: 18 }, { h: 'Lý do', w: 34 }, { h: 'Mã hàng', w: 12 }, { h: 'Tên hàng', w: 30 }, { h: 'Mã lô', w: 12 }, { h: 'Tồn trên sổ (kg)', t: 'k' }, { h: 'Thực tế (kg)', t: 'k' }, { h: 'Chênh lệch (kg)', t: 'k' }, { h: 'Giá trị chênh lệch (đ)', t: 'm', w: 18 }],
      rows: adj, total: ['Cộng', '', '', '', '', '', '', '', '', sum(adj, 9), sum(adj, 10)], kpi: [['Chênh lệch (kg)', sum(adj, 9), 'k'], ['Giá trị chênh lệch (đ)', sum(adj, 10), 'm']] },
    { key: 'nxt', label: 'Nhập, xuất, tồn', name: 'Nhap xuat ton', note: 'Tổng hợp theo mặt hàng, cả khối lượng và giá trị. Tồn cuối = tồn đầu + nhập − xuất ± điều chỉnh. Nhập gồm mua vào và sản xuất ra; xuất gồm đưa vào công đoạn và xuất bán.',
      cols: [{ h: 'Mã hàng', w: 12 }, { h: 'Tên hàng', w: 32 }, { h: 'Loại hàng', w: 16 }, { h: 'Tồn đầu (kg)', t: 'k' }, { h: 'Tồn đầu (đ)', t: 'm' }, { h: 'Nhập (kg)', t: 'k' }, { h: 'Nhập (đ)', t: 'm' }, { h: 'Xuất (kg)', t: 'k' }, { h: 'Xuất (đ)', t: 'm' },
        { h: 'Điều chỉnh (kg)', t: 'k' }, { h: 'Điều chỉnh (đ)', t: 'm' }, { h: 'Tồn cuối (kg)', t: 'k' }, { h: 'Tồn cuối (đ)', t: 'm' }],
      rows: nxt, total: ['Cộng giá trị', '', '', '', sum(nxt, 4), '', sum(nxt, 6), '', sum(nxt, 8), '', sum(nxt, 10), '', sum(nxt, 12)], kpi: [['Giá trị tồn đầu kỳ (đ)', sum(nxt, 4), 'm'], ['Giá trị tồn cuối kỳ (đ)', sum(nxt, 12), 'm']] },
    { key: 'no', label: 'Công nợ', name: 'Cong no', note: 'Theo từng chứng từ phát sinh trong kỳ. Số đã trả, đã thu tính đến lúc xem, gồm cả khoản ghi sau kỳ. Phải thu = doanh thu trừ khoản khách trừ.',
      cols: [{ h: 'Loại', w: 20 }, { h: 'Ngày', t: 'd' }, { h: 'Số chứng từ', w: 13 }, { h: 'Đối tượng', w: 28 }, { h: 'Mã số thuế', w: 14 }, { h: 'Phải trả, phải thu (đ)', t: 'm', w: 20 }, { h: 'Đã trả, đã thu (đ)', t: 'm', w: 18 }, { h: 'Còn lại (đ)', t: 'm' }],
      rows: debt, kpi: [['Còn phải trả người bán (đ)', sum(pt, 7), 'm'], ['Còn phải thu của khách (đ)', sum(pth, 7), 'm']] },
  ];
}
