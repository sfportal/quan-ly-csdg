// Nghiệp vụ lõi: phiếu cân, lệnh công đoạn, đơn hàng, truy xuất, giá thành.
import { all, one, run, batch, uid, now, today, nextCode } from './db';
import { loadProcs, findStep, counterOf } from './proc';

export class Bad extends Error {}

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const kgs = (g: number) => (g / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' kg';
const dg = (d: number) => Math.round(d).toLocaleString('vi-VN') + ' đ';
/** Khóa sổ: chứng từ có ngày đến hết ngày khóa thì không lập mới, không hủy được. */
export function checkLock(t: any, date: string) {
  if (t.lock_date && date <= t.lock_date) throw new Bad(`Sổ đã khóa đến hết ngày ${dmy(t.lock_date)}. Chứng từ ngày ${dmy(date)} không lập hay hủy được; chủ doanh nghiệp mở khóa ở trang Thành viên, cài đặt.`);
  if (date > today()) throw new Bad('Ngày chứng từ không được sau hôm nay.');
}
/** Người lập được hủy chứng từ của chính mình trong ngày lập; quyền "void" hủy được mọi chứng từ. */
export function mayVoid(L: { can: (p: string) => boolean; user: any }, doc: { created_by?: string | null; created_at?: string | null }) {
  if (L.can('void')) return true;
  const d = doc.created_at ? new Date(Date.parse(doc.created_at) + 7 * 3600e3).toISOString().slice(0, 10) : '';
  return !!doc.created_by && doc.created_by === L.user?.id && d === today();
}
const AUD = `INSERT INTO audit(id,tenant_id,user_id,action,ref,detail,old,new,at) VALUES(?,?,?,?,?,?,?,?,?)`;
const needReason = (r: string) => { const x = (r || '').trim(); if (x.length < 5) throw new Bad('Cần ghi lý do, ít nhất 5 ký tự.'); return x.slice(0, 300); };

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
  checkLock(t, d.date);
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
export async function createWork(t: any, userId: string | null, d: {
  type?: string; step_id?: string; date: string; note?: string; extra_cost?: number; norm?: number;
  inputs: { lot_id: string; qty_g: number }[];
  outputs: { item_id: string; qty_g: number; boxes?: number }[];
}) {
  const inputs = d.inputs.filter((i) => i.lot_id && i.qty_g > 0);
  const outputs = d.outputs.filter((o) => o.item_id && o.qty_g > 0);
  if (!inputs.length) throw new Bad('Chưa chọn lô đầu vào.');
  if (!outputs.length) throw new Bad('Chưa nhập sản lượng đầu ra.');
  if (new Set(inputs.map((i) => i.lot_id)).size !== inputs.length) throw new Bad('Một lô đầu vào bị chọn hai lần.');
  checkLock(t, d.date);

  const lots = await all<any>(`SELECT * FROM lots WHERE tenant_id=? AND id ${IN}`, t.id, inJson(inputs.map((i) => i.lot_id)));
  const items = await all<any>(`SELECT * FROM items WHERE tenant_id=? AND id ${IN}`, t.id, inJson(outputs.map((o) => o.item_id)));
  const first = lots.find((x) => x.id === inputs[0].lot_id);
  const W = findStep(await loadProcs(t.id), { step_id: d.step_id, type: d.type, fromStage: first?.stage });
  if (!W) throw new Bad('Bước công đoạn không hợp lệ.');
  const type = W.skey;
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
  const norm = Math.max(1, Math.min(3000, Math.round(d.norm || W.norm || 1000)));
  const expected = Math.round((in_g * norm) / 1000);
  if (out_g + by_g > Math.max(in_g, expected)) throw new Bad(`Đầu ra ${(out_g + by_g) / 1000} kg lớn hơn đầu vào ${in_g / 1000} kg.`);
  const extra = Math.max(0, d.extra_cost || 0);
  const by_value = by.reduce((a, o) => a + Math.round((o.qty_g * o.item.price) / 1000), 0);
  const unit = expected ? in_cost / expected : 0; // đồng trên gam ở mức sản lượng định mức
  const loss_g = Math.max(0, expected - out_g - by_g);
  const loss_cost = Math.round(loss_g * unit) + Math.max(0, Math.round(by_g * unit) - by_value);
  const pool = Math.max(0, in_cost + extra - by_value);
  const w = main.map((o) => o.qty_g);
  const cMain = split(pool, w), cLoss = split(in_loss + loss_cost, w), cExtra = split(in_extra + extra, w);

  const id = uid(), code = await nextCode(t.id, counterOf(W), W.prefix), at = now();
  const areas = [...new Set(ins.map((i) => i.lot.area_code).filter(Boolean))].join(', ');
  const partners = [...new Set(ins.map((i) => i.lot.partner_id).filter(Boolean))];
  const noArea = ins.some((i) => !i.lot.area_code);
  const st: [string, any[]][] = [[
    `INSERT INTO works(id,tenant_id,code,type,process_id,step_name,date,norm,in_g,out_g,by_g,loss_g,in_cost,extra_cost,by_value,loss_cost,note,created_by,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, t.id, code, type, W.process_id, W.name, d.date, norm, in_g, out_g, by_g, loss_g, in_cost, extra, by_value, loss_cost, d.note || '', userId, at],
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
      [lotId, t.id, `${code}.${n}`, o.item_id, type, d.date, o.qty_g, o.qty_g, o.boxes, c, Math.min(cl, c), Math.min(ce, c), id,
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
  st.push([`INSERT INTO audit(id,tenant_id,user_id,action,ref,detail,at) VALUES(?,?,?,?,?,?,?)`, [uid(), t.id, userId, 'work.' + type, code, '', at]]);
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
  checkLock(t, o.date);
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
  if (!d.amount) throw new Bad('Số tiền phải khác 0.');
  const tbl = d.ref_type === 'order' ? 'orders' : 'weigh_tickets';
  const r = await one<any>(`SELECT id, code, paid FROM ${tbl} WHERE id=? AND tenant_id=?`, d.ref_id, t.id);
  if (!r) throw new Bad('Không tìm thấy chứng từ.');
  // Số âm là hoàn tiền: sửa một khoản ghi nhầm mà không xóa dòng cũ
  if (d.amount < 0 && r.paid + d.amount < 0) throw new Bad(`Hoàn tiền không được lớn hơn số đã ghi (${dg(r.paid)}).`);
  if (d.amount < 0 && !(d.note || '').trim()) throw new Bad('Ghi hoàn tiền cần có ghi chú lý do.');
  await batch([
    [`INSERT INTO payments(id,tenant_id,dir,ref_type,ref_id,date,method,amount,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [uid(), t.id, d.ref_type === 'order' ? 'in' : 'out', d.ref_type, d.ref_id, d.date, d.method === 'cash' ? 'cash' : 'bank', d.amount, d.note || '', now()]],
    [`UPDATE ${tbl} SET paid = paid + ? WHERE id=? AND tenant_id=?`, [d.amount, d.ref_id, t.id]],
    [AUD, [uid(), t.id, userId, d.amount < 0 ? 'pay.refund' : 'pay.add', r.code, d.note || '', dg(r.paid), dg(r.paid + d.amount), now()]],
  ]);
}

/** Lãi gộp của đơn: doanh thu, trừ khoản khách trừ, trừ giá vốn, trừ chi phí chuyến. Chưa gồm tiền công và thuế. */
export function orderProfit(o: any) {
  const net = o.revenue - o.deduct;
  const cogs = o.status === 'shipped' ? o.cogs
    : (o.lines || []).reduce((a: number, l: any) => a + Math.round((l.lot_cost * l.qty_g) / l.lot_in), 0);
  return { net, cogs, profit: net - cogs - o.trip_cost };
}

// ---------- Hủy chứng từ, điều chỉnh tồn ----------
/** Các lô này đã phát sinh gì sau khi tạo chưa: dùng ở lệnh, nằm trong đơn, bị điều chỉnh. */
async function lotsTouched(tenantId: string, lots: any[]): Promise<string[]> {
  if (!lots.length) return [];
  const j = inJson(lots.map((l) => l.id));
  const used = await all<any>(
    `SELECT x.lot_id, 'lệnh '||w.code doc FROM work_inputs x JOIN works w ON w.id=x.work_id WHERE x.tenant_id=?1 AND x.lot_id ${IN.replace('?', '?2')}
     UNION ALL SELECT ol.lot_id, 'đơn '||o.code FROM order_lines ol JOIN orders o ON o.id=ol.order_id WHERE ol.tenant_id=?1 AND ol.lot_id ${IN.replace('?', '?2')}
     UNION ALL SELECT a.lot_id, 'phiếu điều chỉnh '||j.code FROM adjust_lines a JOIN adjusts j ON j.id=a.adjust_id WHERE a.tenant_id=?1 AND a.lot_id ${IN.replace('?', '?2')}`, tenantId, j);
  return used.map((u) => `lô ${lots.find((l) => l.id === u.lot_id)?.code} đã có ở ${u.doc}`);
}

export async function voidTicket(t: any, userId: string | null, id: string, reason: string) {
  const why = needReason(reason);
  const tk = await one<any>(`SELECT * FROM weigh_tickets WHERE id=? AND tenant_id=?`, id, t.id);
  if (!tk) throw new Bad('Không tìm thấy phiếu cân.');
  if (tk.void_at) throw new Bad('Phiếu này đã hủy rồi.');
  checkLock(t, tk.date);
  if (tk.paid > 0) throw new Bad(`Phiếu đã ghi chi ${dg(tk.paid)}. Ghi một khoản hoàn tiền (số âm) cho đủ trước khi hủy phiếu.`);
  const lots = await all<any>(`SELECT * FROM lots WHERE ticket_id=? AND tenant_id=?`, id, t.id);
  const touched = await lotsTouched(t.id, lots);
  if (touched.length) throw new Bad(`Chưa hủy được vì ${touched.join('; ')}. Hủy các chứng từ đó trước, theo thứ tự ngược lại.`);
  const lines = await all<any>(`SELECT l.gross_g, l.tare_g, l.deduct_g, l.net_g, l.price, l.amount, i.name item, lt.code lot_code FROM weigh_lines l JOIN items i ON i.id=l.item_id LEFT JOIN lots lt ON lt.id=l.lot_id WHERE l.ticket_id=? AND l.tenant_id=? ORDER BY l.rowid`, id, t.id);
  const snap = JSON.stringify({ total_g: tk.total_g, total_amount: tk.total_amount, lines });
  const at = now();
  await batch([
    [`DELETE FROM lots WHERE ticket_id=? AND tenant_id=?`, [id, t.id]],
    [`DELETE FROM weigh_lines WHERE ticket_id=? AND tenant_id=?`, [id, t.id]],
    [`UPDATE weigh_tickets SET total_g=0, total_amount=0, void_at=?, void_by=?, void_reason=?, void_snap=? WHERE id=? AND tenant_id=?`, [at, userId, why, snap, id, t.id]],
    [AUD, [uid(), t.id, userId, 'ticket.void', tk.code, why, `${kgs(tk.total_g)}, ${dg(tk.total_amount)}`, 'Đã hủy', at]],
  ]);
}

export async function voidWork(t: any, userId: string | null, id: string, reason: string) {
  const why = needReason(reason);
  const w = await one<any>(`SELECT * FROM works WHERE id=? AND tenant_id=?`, id, t.id);
  if (!w) throw new Bad('Không tìm thấy lệnh.');
  if (w.void_at) throw new Bad('Lệnh này đã hủy rồi.');
  checkLock(t, w.date);
  const lots = await all<any>(`SELECT * FROM lots WHERE work_id=? AND tenant_id=?`, id, t.id);
  const touched = await lotsTouched(t.id, lots);
  if (touched.length) throw new Bad(`Chưa hủy được vì ${touched.join('; ')}. Hủy các chứng từ đó trước, theo thứ tự ngược lại.`);
  const ins = await all<any>(`SELECT x.lot_id, x.qty_g, x.cost, l.code, i.name item FROM work_inputs x JOIN lots l ON l.id=x.lot_id JOIN items i ON i.id=l.item_id WHERE x.work_id=? AND x.tenant_id=? ORDER BY x.rowid`, id, t.id);
  const outs = await all<any>(`SELECT x.qty_g, x.boxes, x.cost, l.code, i.name item, i.kind FROM work_outputs x JOIN lots l ON l.id=x.lot_id JOIN items i ON i.id=x.item_id WHERE x.work_id=? AND x.tenant_id=? ORDER BY x.rowid`, id, t.id);
  const H = ['in_g', 'out_g', 'by_g', 'loss_g', 'in_cost', 'extra_cost', 'by_value', 'loss_cost'];
  const snap = JSON.stringify({ ...Object.fromEntries(H.map((k) => [k, w[k]])), ins: ins.map(({ lot_id, ...r }) => r), outs });
  const at = now();
  const st: [string, any[]][] = ins.map((i) => [`UPDATE lots SET qty_g = qty_g + ? WHERE id=? AND tenant_id=?`, [i.qty_g, i.lot_id, t.id]]);
  for (const tb of ['work_inputs', 'work_outputs', 'lot_links', 'lots']) st.push([`DELETE FROM ${tb} WHERE work_id=? AND tenant_id=?`, [id, t.id]]);
  st.push([`UPDATE works SET ${H.map((k) => k + '=0').join(', ')}, void_at=?, void_by=?, void_reason=?, void_snap=? WHERE id=? AND tenant_id=?`, [at, userId, why, snap, id, t.id]]);
  st.push([AUD, [uid(), t.id, userId, 'work.void', w.code, why, `vào ${kgs(w.in_g)}, ra ${kgs(w.out_g + w.by_g)}`, 'Đã hủy, trả tồn về lô đầu vào', at]]);
  await batch(st);
}

/** Hủy xuất: trả hàng về các lô, đơn quay lại trạng thái chờ xuất để sửa hoặc xóa. */
export async function unshipOrder(t: any, userId: string | null, id: string, reason: string) {
  const why = needReason(reason);
  const o = await getOrder(t.id, id);
  if (!o) throw new Bad('Không tìm thấy đơn hàng.');
  if (o.status !== 'shipped') throw new Bad('Đơn này chưa xuất.');
  checkLock(t, o.date);
  if (o.paid > 0) throw new Bad(`Đơn đã ghi thu ${dg(o.paid)}. Ghi một khoản hoàn tiền (số âm) cho đủ trước khi hủy xuất.`);
  const at = now();
  const st: [string, any[]][] = [];
  for (const l of o.lines) {
    st.push([`UPDATE lots SET qty_g = qty_g + ?, boxes = boxes + ? WHERE id=? AND tenant_id=?`, [l.qty_g, l.boxes, l.lot_id, t.id]]);
    st.push([`UPDATE order_lines SET cost=0 WHERE id=? AND tenant_id=?`, [l.id, t.id]]);
  }
  st.push([`UPDATE orders SET status='draft', cogs=0, shipped_at=NULL WHERE id=? AND tenant_id=?`, [id, t.id]]);
  st.push([AUD, [uid(), t.id, userId, 'order.unship', o.code, why, 'Đã xuất', 'Chờ xuất, đã trả tồn về các lô', at]]);
  await batch(st);
}

export const ADJ: Record<string, string> = { count: 'Kiểm kê', scrap: 'Hủy hàng hư', loss: 'Hao hụt bảo quản' };

/** Phiếu điều chỉnh tồn: mỗi dòng là số thực tế đếm, cân được của một lô; hệ thống tự tính chênh lệch. */
export async function createAdjust(t: any, userId: string | null, d: { date: string; kind: string; reason: string; lines: { lot_id: string; actual_g: number }[] }) {
  if (!ADJ[d.kind]) throw new Bad('Chưa chọn loại phiếu.');
  const why = needReason(d.reason);
  checkLock(t, d.date);
  const want = d.lines.filter((l) => l.lot_id && l.actual_g >= 0);
  const lots = await all<any>(`SELECT * FROM lots WHERE tenant_id=? AND id ${IN}`, t.id, inJson(want.map((l) => l.lot_id)));
  const rows = want.map((l) => { const lot = lots.find((x) => x.id === l.lot_id); return lot ? { lot, delta: l.actual_g - lot.qty_g } : null; }).filter((r): r is { lot: any; delta: number } => !!r && r.delta !== 0);
  if (!rows.length) throw new Bad('Chưa có lô nào lệch so với sổ: nhập số thực tế khác số trên sổ ở ít nhất một lô.');
  for (const r of rows) {
    if (d.kind !== 'count' && r.delta > 0) throw new Bad(`Lô ${r.lot.code}: phiếu ${ADJ[d.kind].toLowerCase()} chỉ ghi giảm. Tồn tăng thì dùng phiếu kiểm kê.`);
    if (r.lot.date > d.date) throw new Bad(`Lô ${r.lot.code} tạo ngày ${dmy(r.lot.date)}, sau ngày của phiếu.`);
  }
  const id = uid(), code = await nextCode(t.id, 'adjust', 'DC'), at = now();
  const cost = (r: { lot: any; delta: number }) => Math.round((r.lot.cost_total * r.delta) / r.lot.qty_in_g);
  const tg = rows.reduce((a, r) => a + r.delta, 0), tc = rows.reduce((a, r) => a + cost(r), 0);
  const st: [string, any[]][] = [[`INSERT INTO adjusts(id,tenant_id,code,date,kind,reason,total_g,total_cost,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, [id, t.id, code, d.date, d.kind, why, tg, tc, userId, at]]];
  for (const r of rows) {
    st.push([`UPDATE lots SET qty_g = qty_g + ? WHERE id=? AND tenant_id=?`, [r.delta, r.lot.id, t.id]]);
    st.push([`INSERT INTO adjust_lines(id,tenant_id,adjust_id,lot_id,item_id,before_g,delta_g,cost) VALUES(?,?,?,?,?,?,?,?)`, [uid(), t.id, id, r.lot.id, r.lot.item_id, r.lot.qty_g, r.delta, cost(r)]]);
    st.push([AUD, [uid(), t.id, userId, 'adjust.' + d.kind, `${code} · lô ${r.lot.code}`, why, kgs(r.lot.qty_g), kgs(r.lot.qty_g + r.delta), at]]);
  }
  await batch(st);
  return { id, code };
}

export async function voidAdjust(t: any, userId: string | null, id: string, reason: string) {
  const why = needReason(reason);
  const a = await one<any>(`SELECT * FROM adjusts WHERE id=? AND tenant_id=?`, id, t.id);
  if (!a) throw new Bad('Không tìm thấy phiếu.');
  if (a.void_at) throw new Bad('Phiếu này đã hủy rồi.');
  checkLock(t, a.date);
  const lines = await all<any>(`SELECT x.*, l.code, l.qty_g now_g, i.name item FROM adjust_lines x JOIN lots l ON l.id=x.lot_id JOIN items i ON i.id=x.item_id WHERE x.adjust_id=? AND x.tenant_id=? ORDER BY x.rowid`, id, t.id);
  const short = lines.filter((l) => l.now_g - l.delta_g < 0);
  if (short.length) throw new Bad(`Chưa hủy được: lô ${short.map((l) => l.code).join(', ')} đã dùng mất phần được ghi tăng.`);
  const at = now();
  const st: [string, any[]][] = lines.map((l) => [`UPDATE lots SET qty_g = qty_g - ? WHERE id=? AND tenant_id=?`, [l.delta_g, l.lot_id, t.id]]);
  st.push([`DELETE FROM adjust_lines WHERE adjust_id=? AND tenant_id=?`, [id, t.id]]);
  st.push([`UPDATE adjusts SET total_g=0, total_cost=0, void_at=?, void_by=?, void_reason=?, void_snap=? WHERE id=? AND tenant_id=?`,
    [at, userId, why, JSON.stringify({ total_g: a.total_g, total_cost: a.total_cost, lines: lines.map((l) => ({ code: l.code, item: l.item, before_g: l.before_g, delta_g: l.delta_g, cost: l.cost })) }), id, t.id]]);
  st.push([AUD, [uid(), t.id, userId, 'adjust.void', a.code, why, `chênh lệch ${kgs(a.total_g)}`, 'Đã hủy, trả tồn như trước phiếu', at]]);
  await batch(st);
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
  // Độ sâu của lô trong chuỗi (lô nhập = 0); xử lý từ lô sâu nhất ngược về gốc
  const depth = new Map<string, number>();
  const dep = (id: string, guard = 0): number => {
    if (depth.has(id)) return depth.get(id)!;
    const ins = guard > 50 ? [] : tr.links.filter((k) => k.to_lot === id);
    const v = ins.length ? 1 + Math.max(...ins.map((k) => dep(k.from_lot, guard + 1))) : 0;
    depth.set(id, v); return v;
  };
  const order = [...tr.lots].filter((l) => tr.upSet.has(l.id)).sort((a, b) => dep(b.id) - dep(a.id));
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
