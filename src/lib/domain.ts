// Nghiệp vụ lõi: phiếu cân, lệnh công đoạn, đơn hàng, truy xuất, giá thành.
import { all, one, run, batch, uid, now, nextCode } from './db';

export class Bad extends Error {}

const inJson = (ids: string[]) => JSON.stringify([...new Set(ids.filter(Boolean))]);
const IN = `IN (SELECT value FROM json_each(?))`;

/** Chia một số nguyên theo trọng số, phần dư dồn vào phần tử lớn nhất để tổng không lệch. */
export function split(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const out = weights.map((w) => Math.floor((total * w) / sum));
  const rest = total - out.reduce((a, b) => a + b, 0);
  let imax = 0;
  weights.forEach((w, i) => { if (w > weights[imax]) imax = i; });
  out[imax] += rest;
  return out;
}

// ---------- Cổng kiểm soát ----------
export type Gate = { key: string; name: string; state: 'ok' | 'miss' | 'wait'; msg: string };

/** Cổng 1 (mã vùng trồng, người bán) và cổng 2 (chứng từ mua, thanh toán) của một phiếu cân. */
export function ticketGates(tk: any, partner: any): Gate[] {
  const g: Gate[] = [];
  const area = tk.area_code || '';
  const expired = partner?.area_expiry && partner.area_expiry < tk.date;
  g.push({
    key: 'g1', name: 'Mã vùng trồng và người bán',
    state: !area ? 'miss' : expired ? 'miss' : 'ok',
    msg: !area ? 'Chưa có mã số vùng trồng: lô này không được đưa vào đơn xuất khẩu.'
      : expired ? `Mã vùng trồng ${area} hết hạn ngày ${partner.area_expiry}.` : `Mã vùng trồng ${area}.`,
  });
  const need: string[] = [];
  if (tk.source === 'trader' && !tk.doc_invoice) need.push('hóa đơn của người bán');
  if (tk.source === 'linked' && !tk.doc_contract) need.push('hợp đồng liên kết');
  if ((tk.source === 'linked' || tk.source === 'unlinked') && !tk.doc_list) need.push('bảng kê thu mua');
  if (tk.source === 'own' && !tk.doc_contract) need.push('phiếu nhập nội bộ');
  if (tk.pay_method === 'cash' && tk.total_amount >= 5_000_000) need.push('thanh toán không dùng tiền mặt (phiếu từ 5 triệu đồng)');
  g.push({
    key: 'g2', name: 'Chứng từ mua và thanh toán',
    state: need.length ? 'miss' : 'ok',
    msg: need.length ? 'Còn thiếu: ' + need.join(', ') + '.' : 'Đủ chứng từ theo nguồn hàng.',
  });
  return g;
}

// ---------- Phiếu cân nhập ----------
export async function createTicket(t: any, userId: string | null, d: {
  date: string; partner_id: string; vehicle?: string; pay_method?: string;
  doc_invoice?: boolean; doc_list?: boolean; doc_contract?: boolean; note?: string;
  lines: { item_id: string; gross_g: number; tare_g?: number; deduct_g?: number; price?: number }[];
}) {
  const p = await one<any>(`SELECT * FROM partners WHERE id=? AND tenant_id=? AND kind='supplier'`, d.partner_id, t.id);
  if (!p) throw new Bad('Chưa chọn nhà cung cấp.');
  const lines = d.lines.map((l) => {
    const net = l.gross_g - (l.tare_g || 0) - (l.deduct_g || 0);
    return { ...l, tare_g: l.tare_g || 0, deduct_g: l.deduct_g || 0, net_g: net, price: l.price || 0, amount: Math.round((net * (l.price || 0)) / 1000) };
  }).filter((l) => l.gross_g > 0);
  if (!lines.length) throw new Bad('Phiếu cân chưa có dòng hàng nào.');
  if (lines.some((l) => l.net_g <= 0)) throw new Bad('Khối lượng tịnh phải lớn hơn 0.');
  const items = await all<any>(`SELECT id FROM items WHERE tenant_id=? AND kind='NL'`, t.id);
  if (lines.some((l) => !items.find((i) => i.id === l.item_id))) throw new Bad('Mặt hàng nhập không hợp lệ.');

  const id = uid(), code = await nextCode(t.id, 'ticket', 'PC'), at = now();
  const total_g = lines.reduce((a, l) => a + l.net_g, 0);
  const total_amount = lines.reduce((a, l) => a + l.amount, 0);
  const pay = p.sub === 'own' ? 'internal' : d.pay_method || 'bank';
  const st: [string, any[]][] = [[
    `INSERT INTO weigh_tickets(id,tenant_id,code,date,partner_id,source,vehicle,area_code,pay_method,doc_invoice,doc_list,doc_contract,total_g,total_amount,note,created_by,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, t.id, code, d.date, p.id, p.sub, d.vehicle || '', p.area_code, pay, d.doc_invoice ? 1 : 0, d.doc_list ? 1 : 0, d.doc_contract ? 1 : 0, total_g, total_amount, d.note || '', userId, at],
  ]];
  lines.forEach((l, i) => {
    const lotId = uid();
    st.push([`INSERT INTO lots(id,tenant_id,code,item_id,stage,date,qty_in_g,qty_g,cost_total,ticket_id,partner_id,area_code,created_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [lotId, t.id, `${code}.${i + 1}`, l.item_id, 'receive', d.date, l.net_g, l.net_g, l.amount, id, p.id, p.area_code, at]]);
    st.push([`INSERT INTO weigh_lines(id,tenant_id,ticket_id,item_id,gross_g,tare_g,deduct_g,net_g,price,amount,lot_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [uid(), t.id, id, l.item_id, l.gross_g, l.tare_g, l.deduct_g, l.net_g, l.price, l.amount, lotId]]);
  });
  st.push([`INSERT INTO audit(id,tenant_id,user_id,action,ref,detail,at) VALUES(?,?,?,?,?,?,?)`, [uid(), t.id, userId, 'ticket.create', code, '', at]]);
  await batch(st);
  return { id, code };
}

// ---------- Lệnh công đoạn ----------
export const WORK: Record<string, { name: string; prefix: string; from: string[]; hint: string }> = {
  sort: { name: 'Phân loại, xử lý', prefix: 'PL', from: ['receive'], hint: 'Chỉ nhập kg đạt và kg không đạt. Hao hụt tự nhiên hệ thống tự tính.' },
  peel: { name: 'Bóc múi', prefix: 'BM', from: ['sort', 'receive'], hint: 'Nhập kg múi thu được. Vỏ, hạt là định mức, không tính là hao hụt.' },
  freeze: { name: 'Cấp đông', prefix: 'CD', from: ['peel'], hint: 'Nhập kg múi sau cấp đông.' },
  pack: { name: 'Đóng gói', prefix: 'DG', from: ['sort', 'freeze'], hint: 'Nhập số thùng theo từng loại. Kg tự tính theo quy cách, sửa được.' },
};

export async function createWork(t: any, userId: string | null, d: {
  type: string; date: string; note?: string; extra_cost?: number; norm?: number;
  inputs: { lot_id: string; qty_g: number }[];
  outputs: { item_id: string; qty_g: number; boxes?: number }[];
}) {
  const W = WORK[d.type];
  if (!W) throw new Bad('Loại công đoạn không hợp lệ.');
  const inputs = d.inputs.filter((i) => i.lot_id && i.qty_g > 0);
  const outputs = d.outputs.filter((o) => o.item_id && o.qty_g > 0);
  if (!inputs.length) throw new Bad('Chưa chọn lô đầu vào.');
  if (!outputs.length) throw new Bad('Chưa nhập sản lượng đầu ra.');
  if (new Set(inputs.map((i) => i.lot_id)).size !== inputs.length) throw new Bad('Một lô đầu vào bị chọn hai lần.');

  const lots = await all<any>(`SELECT * FROM lots WHERE tenant_id=? AND id ${IN}`, t.id, inJson(inputs.map((i) => i.lot_id)));
  const items = await all<any>(`SELECT * FROM items WHERE tenant_id=? AND id ${IN}`, t.id, inJson(outputs.map((o) => o.item_id)));
  let in_g = 0, in_cost = 0, in_loss = 0, in_extra = 0;
  const ins = inputs.map((i) => {
    const l = lots.find((x) => x.id === i.lot_id);
    if (!l) throw new Bad('Không tìm thấy lô đầu vào.');
    if (l.status !== 'ok') throw new Bad(`Lô ${l.code} đang bị giữ, không dùng được.`);
    if (i.qty_g > l.qty_g) throw new Bad(`Lô ${l.code} chỉ còn ${l.qty_g / 1000} kg.`);
    const f = (v: number) => Math.round((v * i.qty_g) / l.qty_in_g);
    const r = { ...i, lot: l, cost: f(l.cost_total), loss: f(l.cost_loss), extra: f(l.cost_extra) };
    in_g += i.qty_g; in_cost += r.cost; in_loss += r.loss; in_extra += r.extra;
    return r;
  });
  const outs = outputs.map((o) => {
    const it = items.find((x) => x.id === o.item_id);
    if (!it) throw new Bad('Mặt hàng đầu ra không hợp lệ.');
    return { ...o, boxes: o.boxes || 0, item: it, by: it.kind === 'PP' };
  });
  const main = outs.filter((o) => !o.by), by = outs.filter((o) => o.by);
  if (!main.length) throw new Bad('Cần ít nhất một dòng sản phẩm chính.');
  const out_g = main.reduce((a, o) => a + o.qty_g, 0), by_g = by.reduce((a, o) => a + o.qty_g, 0);
  if (out_g + by_g > in_g) throw new Bad(`Đầu ra ${(out_g + by_g) / 1000} kg lớn hơn đầu vào ${in_g / 1000} kg.`);

  const norm = d.type === 'peel' ? Math.max(1, Math.min(1000, d.norm || t.norm_peel)) : 1000;
  const expected = Math.round((in_g * norm) / 1000);
  const extra = Math.max(0, d.extra_cost || 0);
  const by_value = by.reduce((a, o) => a + Math.round((o.qty_g * o.item.price) / 1000), 0);
  const unit = expected ? in_cost / expected : 0; // đồng trên gam ở mức sản lượng định mức
  const loss_g = Math.max(0, expected - out_g - by_g);
  const loss_cost = Math.round(loss_g * unit) + Math.max(0, Math.round(by_g * unit) - by_value);
  const pool = Math.max(0, in_cost + extra - by_value);
  const w = main.map((o) => o.qty_g);
  const cMain = split(pool, w), cLoss = split(in_loss + loss_cost, w), cExtra = split(in_extra + extra, w);

  const id = uid(), code = await nextCode(t.id, 'work.' + d.type, W.prefix), at = now();
  const areas = [...new Set(ins.map((i) => i.lot.area_code).filter(Boolean))].join(', ');
  const partners = [...new Set(ins.map((i) => i.lot.partner_id).filter(Boolean))];
  const noArea = ins.some((i) => !i.lot.area_code);
  const st: [string, any[]][] = [[
    `INSERT INTO works(id,tenant_id,code,type,date,norm,in_g,out_g,by_g,loss_g,in_cost,extra_cost,by_value,loss_cost,note,created_by,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, t.id, code, d.type, d.date, norm, in_g, out_g, by_g, loss_g, in_cost, extra, by_value, loss_cost, d.note || '', userId, at],
  ]];
  for (const i of ins) {
    st.push([`UPDATE lots SET qty_g = qty_g - ? WHERE id=? AND tenant_id=?`, [i.qty_g, i.lot_id, t.id]]);
    st.push([`INSERT INTO work_inputs(id,tenant_id,work_id,lot_id,qty_g,cost) VALUES(?,?,?,?,?,?)`, [uid(), t.id, id, i.lot_id, i.qty_g, i.cost]]);
  }
  let n = 0, mi = 0;
  const allOut = out_g + by_g;
  for (const o of outs) {
    n++;
    const lotId = uid();
    const c = o.by ? Math.round((o.qty_g * o.item.price) / 1000) : cMain[mi];
    const cl = o.by ? 0 : cLoss[mi], ce = o.by ? 0 : cExtra[mi];
    if (!o.by) mi++;
    st.push([`INSERT INTO lots(id,tenant_id,code,item_id,stage,date,qty_in_g,qty_g,boxes,cost_total,cost_loss,cost_extra,work_id,partner_id,area_code,created_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [lotId, t.id, `${code}.${n}`, o.item_id, d.type, d.date, o.qty_g, o.qty_g, o.boxes, c, Math.min(cl, c), Math.min(ce, c), id,
        partners.length === 1 ? partners[0] : null, noArea ? '' : areas, at]]);
    st.push([`INSERT INTO work_outputs(id,tenant_id,work_id,lot_id,item_id,qty_g,boxes,cost) VALUES(?,?,?,?,?,?,?,?)`,
      [uid(), t.id, id, lotId, o.item_id, o.qty_g, o.boxes, c]]);
    const share = split(o.qty_g, ins.map((i) => i.qty_g));
    ins.forEach((i, k) => {
      const q = Math.round((i.qty_g * o.qty_g) / allOut);
      if (q > 0 || share[k] > 0)
        st.push([`INSERT INTO lot_links(id,tenant_id,from_lot,to_lot,work_id,qty_g) VALUES(?,?,?,?,?,?)`, [uid(), t.id, i.lot_id, lotId, id, q]]);
    });
  }
  st.push([`INSERT INTO audit(id,tenant_id,user_id,action,ref,detail,at) VALUES(?,?,?,?,?,?,?)`, [uid(), t.id, userId, 'work.' + d.type, code, '', at]]);
  await batch(st);
  return { id, code, loss_g, loss_cost };
}

// ---------- Đơn hàng ----------
export async function createOrder(t: any, userId: string | null, d: {
  date: string; customer_id: string; vehicle?: string; container?: string; seal?: string; note?: string;
  lab_cd?: string; lab_o?: string; lab_ref?: string; phyto?: string;
  lines: { lot_id: string; qty_g: number; boxes?: number; price: number }[];
  costs?: { kind: string; name: string; amount: number }[];
}) {
  const c = await one<any>(`SELECT * FROM partners WHERE id=? AND tenant_id=? AND kind='customer'`, d.customer_id, t.id);
  if (!c) throw new Bad('Chưa chọn khách hàng.');
  const lines = d.lines.filter((l) => l.lot_id && l.qty_g > 0);
  if (!lines.length) throw new Bad('Đơn hàng chưa có dòng hàng nào.');
  const lots = await all<any>(`SELECT * FROM lots WHERE tenant_id=? AND id ${IN}`, t.id, inJson(lines.map((l) => l.lot_id)));
  const id = uid(), code = await nextCode(t.id, 'order', 'DH'), at = now();
  const exp = c.sub === 'export';
  let revenue = 0;
  const st: [string, any[]][] = [];
  for (const l of lines) {
    const lot = lots.find((x) => x.id === l.lot_id);
    if (!lot) throw new Bad('Không tìm thấy lô hàng.');
    const amount = Math.round((l.qty_g * l.price) / 1000);
    revenue += amount;
    st.push([`INSERT INTO order_lines(id,tenant_id,order_id,lot_id,item_id,qty_g,boxes,price,amount) VALUES(?,?,?,?,?,?,?,?,?)`,
      [uid(), t.id, id, lot.id, lot.item_id, l.qty_g, l.boxes || 0, l.price, amount]]);
  }
  let deduct = 0, trip = 0;
  for (const k of (d.costs || []).filter((k) => k.name && k.amount > 0)) {
    if (k.kind === 'deduct') deduct += k.amount; else trip += k.amount;
    st.push([`INSERT INTO order_costs(id,tenant_id,order_id,kind,name,amount) VALUES(?,?,?,?,?,?)`,
      [uid(), t.id, id, k.kind === 'deduct' ? 'deduct' : 'trip', k.name, k.amount]]);
  }
  st.unshift([`INSERT INTO orders(id,tenant_id,code,date,customer_id,type,vehicle,container,seal,lab_cd,lab_o,lab_ref,phyto,revenue,deduct,trip_cost,note,created_by,created_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, t.id, code, d.date, c.id, c.sub, d.vehicle || '', d.container || '', d.seal || '',
      d.lab_cd || (exp ? 'wait' : 'na'), d.lab_o || (exp ? 'wait' : 'na'), d.lab_ref || '', d.phyto || '', revenue, deduct, trip, d.note || '', userId, at]]);
  st.push([`INSERT INTO audit(id,tenant_id,user_id,action,ref,detail,at) VALUES(?,?,?,?,?,?,?)`, [uid(), t.id, userId, 'order.create', code, '', at]]);
  await batch(st);
  return { id, code };
}

export async function getOrder(tenantId: string, id: string) {
  const o = await one<any>(
    `SELECT o.*, p.name customer, p.sub csub FROM orders o JOIN partners p ON p.id=o.customer_id WHERE o.id=? AND o.tenant_id=?`, id, tenantId);
  if (!o) return null;
  o.lines = await all<any>(
    `SELECT ol.*, l.code lot_code, l.qty_g lot_qty, l.qty_in_g lot_in, l.cost_total lot_cost, l.area_code, l.status lot_status, i.name item, i.box_g
     FROM order_lines ol JOIN lots l ON l.id=ol.lot_id JOIN items i ON i.id=ol.item_id
     WHERE ol.order_id=? AND ol.tenant_id=? ORDER BY ol.rowid`, id, tenantId);
  o.costs = await all<any>(`SELECT * FROM order_costs WHERE order_id=? AND tenant_id=? ORDER BY rowid`, id, tenantId);
  o.payments = await all<any>(`SELECT * FROM payments WHERE ref_type='order' AND ref_id=? AND tenant_id=? ORDER BY date`, id, tenantId);
  return o;
}

/** Cổng 4 (kiểm nghiệm, hồ sơ xuất khẩu) và cổng 5 (thực xuất so với tồn) của một đơn. */
export function orderGates(t: any, o: any): Gate[] {
  const g: Gate[] = [];
  if (o.type === 'export') {
    const st = (v: string): Gate['state'] => (v === 'ok' ? 'ok' : v === 'wait' ? 'wait' : 'miss');
    g.push({ key: 'g4a', name: 'Kiểm nghiệm Cadimi', state: st(o.lab_cd), msg: o.lab_cd === 'ok' ? 'Đạt' + (o.lab_ref ? `, phiếu ${o.lab_ref}` : '') : o.lab_cd === 'wait' ? 'Đang chờ kết quả.' : 'Chưa có kết quả đạt.' });
    g.push({ key: 'g4b', name: 'Kiểm nghiệm vàng O', state: st(o.lab_o), msg: o.lab_o === 'ok' ? 'Đạt' : o.lab_o === 'wait' ? 'Đang chờ kết quả.' : 'Chưa có kết quả đạt.' });
    const noArea = o.lines.filter((l: any) => !l.area_code).map((l: any) => l.lot_code);
    g.push({ key: 'g1', name: 'Mã vùng trồng của các lô', state: noArea.length ? 'miss' : 'ok', msg: noArea.length ? `Lô ${noArea.join(', ')} có nguyên liệu chưa có mã vùng trồng.` : 'Tất cả lô đều có mã vùng trồng.' });
    g.push({ key: 'gp', name: 'Mã cơ sở đóng gói', state: t.packing_code ? 'ok' : 'miss', msg: t.packing_code ? t.packing_code : 'Doanh nghiệp chưa khai báo mã số cơ sở đóng gói.' });
    g.push({ key: 'gc', name: 'Số container, seal', state: o.container && o.seal ? 'ok' : 'miss', msg: o.container && o.seal ? `${o.container}, seal ${o.seal}` : 'Chưa nhập số container hoặc số seal.' });
  }
  if (o.status === 'draft') {
    const short = o.lines.filter((l: any) => l.qty_g > l.lot_qty).map((l: any) => l.lot_code);
    const hold = o.lines.filter((l: any) => l.lot_status !== 'ok').map((l: any) => l.lot_code);
    g.push({ key: 'g5', name: 'Thực xuất so với tồn kho', state: short.length || hold.length ? 'miss' : 'ok',
      msg: hold.length ? `Lô ${hold.join(', ')} đang bị giữ.` : short.length ? `Lô ${short.join(', ')} không đủ tồn.` : 'Đủ hàng để xuất.' });
  } else {
    g.push({ key: 'g5', name: 'Thực xuất so với yêu cầu', state: 'ok', msg: 'Đã xuất đủ theo đơn.' });
  }
  return g;
}

export async function shipOrder(t: any, userId: string | null, id: string) {
  const o = await getOrder(t.id, id);
  if (!o) throw new Bad('Không tìm thấy đơn hàng.');
  if (o.status !== 'draft') throw new Bad('Đơn này đã xuất rồi.');
  const blocks = orderGates(t, o).filter((g) => g.state !== 'ok');
  if (blocks.length) throw new Bad('Chưa xuất được: ' + blocks.map((b) => `${b.name}: ${b.msg}`).join(' '));
  const st: [string, any[]][] = [];
  let cogs = 0;
  for (const l of o.lines) {
    const cost = Math.round((l.lot_cost * l.qty_g) / l.lot_in);
    cogs += cost;
    st.push([`UPDATE lots SET qty_g = qty_g - ?, boxes = MAX(0, boxes - ?) WHERE id=? AND tenant_id=?`, [l.qty_g, l.boxes, l.lot_id, t.id]]);
    st.push([`UPDATE order_lines SET cost=? WHERE id=? AND tenant_id=?`, [cost, l.id, t.id]]);
  }
  st.push([`UPDATE orders SET status='shipped', cogs=?, shipped_at=? WHERE id=? AND tenant_id=?`, [cogs, now(), id, t.id]]);
  st.push([`INSERT INTO audit(id,tenant_id,user_id,action,ref,detail,at) VALUES(?,?,?,?,?,?,?)`, [uid(), t.id, userId, 'order.ship', o.code, '', now()]]);
  await batch(st);
}

export async function addPayment(t: any, userId: string | null, d: { ref_type: 'order' | 'ticket'; ref_id: string; date: string; method: string; amount: number; note?: string }) {
  if (d.amount <= 0) throw new Bad('Số tiền phải lớn hơn 0.');
  const tbl = d.ref_type === 'order' ? 'orders' : 'weigh_tickets';
  const r = await one<any>(`SELECT id FROM ${tbl} WHERE id=? AND tenant_id=?`, d.ref_id, t.id);
  if (!r) throw new Bad('Không tìm thấy chứng từ.');
  await batch([
    [`INSERT INTO payments(id,tenant_id,dir,ref_type,ref_id,date,method,amount,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [uid(), t.id, d.ref_type === 'order' ? 'in' : 'out', d.ref_type, d.ref_id, d.date, d.method === 'cash' ? 'cash' : 'bank', d.amount, d.note || '', now()]],
    [`UPDATE ${tbl} SET paid = paid + ? WHERE id=? AND tenant_id=?`, [d.amount, d.ref_id, t.id]],
  ]);
}

/** Lãi gộp của đơn: doanh thu, trừ khoản khách trừ, trừ giá vốn, trừ chi phí chuyến. Chưa gồm tiền công và thuế. */
export function orderProfit(o: any) {
  const net = o.revenue - o.deduct;
  const cogs = o.status === 'shipped' ? o.cogs
    : (o.lines || []).reduce((a: number, l: any) => a + Math.round((l.lot_cost * l.qty_g) / l.lot_in), 0);
  return { net, cogs, profit: net - cogs - o.trip_cost };
}

// ---------- Truy xuất ----------
export async function trace(tenantId: string, lotId: string) {
  const ids = (await all<any>(
    `WITH RECURSIVE up(id) AS (SELECT ?1 UNION SELECT k.from_lot FROM lot_links k JOIN up ON k.to_lot=up.id WHERE k.tenant_id=?2),
                    dn(id) AS (SELECT ?1 UNION SELECT k.to_lot FROM lot_links k JOIN dn ON k.from_lot=dn.id WHERE k.tenant_id=?2)
     SELECT id, 'up' dir FROM up UNION SELECT id, 'dn' dir FROM dn`, lotId, tenantId));
  const upSet = new Set(ids.filter((x) => x.dir === 'up').map((x) => x.id));
  const j = inJson(ids.map((x) => x.id));
  const lots = await all<any>(
    `SELECT l.*, i.name item, i.kind, i.code item_code, i.box_g FROM lots l JOIN items i ON i.id=l.item_id
     WHERE l.tenant_id=? AND l.id ${IN} ORDER BY l.created_at, l.code`, tenantId, j);
  if (!lots.find((l) => l.id === lotId)) return null;
  const links = await all<any>(`SELECT * FROM lot_links WHERE tenant_id=? AND from_lot ${IN} AND to_lot ${IN}`, tenantId, j, j);
  const tickets = await all<any>(
    `SELECT w.*, p.name partner, p.sub, p.tax_code, p.area_expiry, p.address FROM weigh_tickets w JOIN partners p ON p.id=w.partner_id
     WHERE w.tenant_id=? AND w.id ${IN}`, tenantId, inJson(lots.map((l) => l.ticket_id)));
  const works = await all<any>(`SELECT * FROM works WHERE tenant_id=? AND id ${IN} ORDER BY created_at`, tenantId, inJson(lots.map((l) => l.work_id)));
  const olines = await all<any>(
    `SELECT ol.*, o.code, o.date, o.type, o.status, o.container, o.seal, o.lab_cd, o.lab_o, o.lab_ref, o.phyto, o.vehicle, p.name customer
     FROM order_lines ol JOIN orders o ON o.id=ol.order_id JOIN partners p ON p.id=o.customer_id
     WHERE ol.tenant_id=? AND ol.lot_id ${IN}`, tenantId, j);
  return { lot: lots.find((l) => l.id === lotId), lots, links, tickets, works, olines, upSet };
}

/** Tỷ trọng nguyên liệu của một lô theo từng lô nhập gốc, lan truyền ngược theo kg. */
export function originShares(tr: NonNullable<Awaited<ReturnType<typeof trace>>>) {
  const share = new Map<string, number>([[tr.lot.id, 1]]);
  const rank: any = { receive: 0, sort: 1, peel: 2, freeze: 3, pack: 4 };
  const order = [...tr.lots].filter((l) => tr.upSet.has(l.id)).sort((a, b) => rank[b.stage] - rank[a.stage]);
  const res = new Map<string, number>();
  for (const l of order) {
    const s = share.get(l.id) || 0;
    if (!s) continue;
    const ins = tr.links.filter((k) => k.to_lot === l.id);
    if (!ins.length) { res.set(l.id, (res.get(l.id) || 0) + s); continue; }
    const tot = ins.reduce((a, k) => a + k.qty_g, 0) || 1;
    for (const k of ins) share.set(k.from_lot, (share.get(k.from_lot) || 0) + (s * k.qty_g) / tot);
  }
  return res;
}
