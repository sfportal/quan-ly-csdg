// Kịch bản tạo dữ liệu mẫu. Chỉ chạy ở máy phát triển để sinh src/data/demo.json; bản chạy thật nạp từ tệp đó.
// Số liệu dựa trên sổ sách thực tế của một cơ sở, đã đổi tên người, biển số, mã vùng trồng.
import { all, one, run, uid, now } from './db';
import { createTenant } from './setup';
import { createTicket, createWork, createOrder, shipOrder, addPayment } from './domain';
import { createProcess, loadProcs, TEMPLATES } from './proc';

const K = 1000;
async function partner(t: any, kind: string, sub: string, name: string, x: any = {}) {
  const id = uid();
  await run(`INSERT INTO partners(id,tenant_id,kind,sub,name,phone,tax_code,area_code,area_expiry,address,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    id, t.id, kind, sub, name, x.phone || '', x.tax || '', x.area || '', x.exp || '', x.addr || '', x.note || '');
  return id;
}
async function ctx(tenantId: string) {
  const t = await one<any>('SELECT * FROM tenants WHERE id=?', tenantId);
  const items = await all<any>('SELECT * FROM items WHERE tenant_id=?', tenantId);
  const I = (code: string) => items.find((i) => i.code === code).id;
  const lot = async (code: string) => (await one<any>('SELECT * FROM lots WHERE tenant_id=? AND code=?', tenantId, code))!;
  return { t, I, lot };
}
async function member(tenantId: string, email: string, name: string, role: string) {
  let u = await one<any>('SELECT id FROM users WHERE email=?', email);
  if (!u) { u = { id: uid() }; await run('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)', u.id, email, name, now()); }
  await run('INSERT INTO memberships(id,tenant_id,user_id,role,created_at) VALUES(?,?,?,?,?)', uid(), tenantId, u.id, role, now());
}

async function seedFresh() {
  const id = await createTenant({ name: 'Cơ sở đóng gói Trái Tươi Mẫu', code: 'mau-trai-tuoi', lines: 'fresh', is_demo: true, packing_code: 'VN-DLPH-900 (mẫu)', address: 'Krông Pắc, Đắk Lắk' });
  const { t, I, lot } = await ctx(id);
  await member(id, 'chu.traituoi@mau.csdg', 'Chủ cơ sở Trái Tươi', 'owner');
  await member(id, 'can.traituoi@mau.csdg', 'Nhân viên trạm cân', 'weigher');
  await member(id, 'ketoan.traituoi@mau.csdg', 'Kế toán', 'accountant');
  const vua = await partner(t, 'supplier', 'trader', 'Vựa Hai Lúa', { tax: '6001xxxxxx', area: 'VN-DLOR-0901', exp: '2027-12-31', addr: 'Krông Pắc, Đắk Lắk', phone: '0900 000 101' });
  const lk = await partner(t, 'supplier', 'linked', 'Vườn liên kết ông Tư', { area: 'VN-DLOR-0902', exp: '2027-06-30', addr: 'Ea Kênh, Đắk Lắk', phone: '0900 000 102' });
  const kb = await partner(t, 'supplier', 'unlinked', 'Vườn chú Bảy', { addr: 'Cư Mgar, Đắk Lắk', note: 'Chưa có mã số vùng trồng' });
  const own = await partner(t, 'supplier', 'own', 'Vườn công ty, lô A', { area: 'VN-DLOR-0900', exp: '2028-03-31', addr: 'Krông Pắc, Đắk Lắk' });
  const xk = await partner(t, 'customer', 'export', 'Công ty XNK Bằng Tường Mẫu', { addr: 'Bằng Tường, Quảng Tây', note: 'Thanh toán chuyển khoản ngoại tệ' });
  const si = await partner(t, 'customer', 'wholesale', 'Chợ đầu mối, sạp 12', { addr: 'Thủ Đức, TP. Hồ Chí Minh' });
  await partner(t, 'customer', 'retail', 'Khách lẻ tại cơ sở');

  // Chuyến container: 980 thùng, 17.008 kg
  await createTicket(t, null, { date: '2026-11-02', partner_id: vua, vehicle: '47C-000.01', doc_invoice: true, lines: [{ item_id: I('SR-MT'), gross_g: 7450 * K, tare_g: 250 * K, price: 52000 }] });
  await createTicket(t, null, { date: '2026-11-02', partner_id: lk, vehicle: '47C-000.02', doc_contract: true, doc_list: true, lines: [{ item_id: I('SR-MT'), gross_g: 6680 * K, tare_g: 230 * K, price: 50000 }] });
  await createTicket(t, null, { date: '2026-11-03', partner_id: own, vehicle: '47C-000.03', doc_contract: true, lines: [{ item_id: I('SR-MT'), gross_g: 4660 * K, tare_g: 160 * K, price: 42000 }] });
  await createWork(t, null, { type: 'sort', date: '2026-11-03', inputs: [{ lot_id: (await lot('PC-0001.1')).id, qty_g: 7200 * K }, { lot_id: (await lot('PC-0002.1')).id, qty_g: 6450 * K }, { lot_id: (await lot('PC-0003.1')).id, qty_g: 4500 * K }],
    outputs: [{ item_id: I('TD'), qty_g: 17180 * K }, { item_id: I('TL'), qty_g: 760 * K }] });
  await createWork(t, null, { type: 'pack', date: '2026-11-04', inputs: [{ lot_id: (await lot('PL-0001.1')).id, qty_g: 17180 * K }],
    outputs: [{ item_id: I('MT-A'), qty_g: 6264 * K, boxes: 348 }, { item_id: I('MT-B'), qty_g: 9724 * K, boxes: 572 }, { item_id: I('MT-C'), qty_g: 1020 * K, boxes: 60 }], note: 'A 3 đai vàng, B 2 đai đỏ, C 2 đai xanh' });
  const o1 = await createOrder(t, null, { date: '2026-11-04', customer_id: xk, container: 'MAUU 900001-0', seal: 'S900001', vehicle: '47H-000.11', lab_cd: 'ok', lab_o: 'ok', lab_ref: 'KN-2026-0911', phyto: 'KDTV-900001',
    lines: [{ lot_id: (await lot('DG-0001.1')).id, qty_g: 6264 * K, boxes: 348, price: 70000 }, { lot_id: (await lot('DG-0001.2')).id, qty_g: 9724 * K, boxes: 572, price: 55000 }, { lot_id: (await lot('DG-0001.3')).id, qty_g: 1020 * K, boxes: 60, price: 53000 }],
    costs: [{ kind: 'deduct', name: 'Bốc xếp', amount: 3_000_000 }, { kind: 'deduct', name: 'Thùng carton 980 x 41.000', amount: 40_180_000 }, { kind: 'deduct', name: 'Thuốc xử lý', amount: 16_000_000 }] });
  await shipOrder(t, null, o1.id);
  await addPayment(t, null, { ref_type: 'order', ref_id: o1.id, date: '2026-11-09', method: 'bank', amount: 968_180_000, note: 'Bán ngoại tệ, ngân hàng báo có' });
  for (const [c, a] of [['PC-0001', 374_400_000], ['PC-0002', 322_500_000]] as const) {
    const tk = await one<any>('SELECT id FROM weigh_tickets WHERE tenant_id=? AND code=?', id, c);
    await addPayment(t, null, { ref_type: 'ticket', ref_id: tk.id, date: '2026-11-05', method: 'bank', amount: a });
  }

  // Chuyến hàng nội địa bán thẳng theo 4 xe: mua 274.246.000, chi phí chuyến 28.573.000, thu 284.045.000, lỗ 18.774.000
  const t4 = await createTicket(t, null, { date: '2026-11-06', partner_id: kb, vehicle: '47C-000.04', pay_method: 'bank', doc_list: true,
    lines: [{ item_id: I('SR-MT'), gross_g: 6334 * K, price: 28500 }, { item_id: I('SR-XO'), gross_g: 4933 * K, price: 19000 }] });
  await addPayment(t, null, { ref_type: 'ticket', ref_id: t4.id, date: '2026-11-06', method: 'bank', amount: 274_246_000 });
  const xe: [string, string, number, number, [string, number][]][] = [
    ['PC-0004.1', '51C-000.21', 2800, 30000, [['Cước xe', 6_000_000], ['Bốc xếp', 1_500_000]]],
    ['PC-0004.1', '51C-000.22', 3534, 28000, [['Cước xe', 6_000_000], ['Bốc xếp', 1_500_000]]],
    ['PC-0004.2', '51C-000.23', 2500, 20000, [['Cước xe', 5_500_000], ['Bốc xếp', 1_300_000]]],
    ['PC-0004.2', '51C-000.24', 2433, 21000, [['Cước xe', 5_500_000], ['Phí chợ, bến bãi', 1_273_000]]],
  ];
  for (const [lc, veh, q, p, costs] of xe) {
    const o = await createOrder(t, null, { date: '2026-11-07', customer_id: si, vehicle: veh, lines: [{ lot_id: (await lot(lc)).id, qty_g: q * K, price: p }],
      costs: costs.map(([name, amount]) => ({ kind: 'trip', name, amount })) });
    await shipOrder(t, null, o.id);
    await addPayment(t, null, { ref_type: 'order', ref_id: o.id, date: '2026-11-08', method: 'bank', amount: q * p });
  }

  // Hàng đang chờ: một container chờ kết quả kiểm nghiệm, một lô chưa có mã vùng trồng, một phiếu chưa xử lý
  await createTicket(t, null, { date: '2026-11-11', partner_id: lk, vehicle: '47C-000.02', doc_contract: true, doc_list: true, lines: [{ item_id: I('SR-MT'), gross_g: 2480 * K, tare_g: 80 * K, price: 51000 }] });
  await createWork(t, null, { type: 'sort', date: '2026-11-11', inputs: [{ lot_id: (await lot('PC-0005.1')).id, qty_g: 2400 * K }], outputs: [{ item_id: I('TD'), qty_g: 2290 * K }, { item_id: I('TL'), qty_g: 85 * K }] });
  await createWork(t, null, { type: 'pack', date: '2026-11-12', inputs: [{ lot_id: (await lot('PL-0002.1')).id, qty_g: 2290 * K }], outputs: [{ item_id: I('MT-A'), qty_g: 1260 * K, boxes: 70 }, { item_id: I('MT-B'), qty_g: 1003 * K, boxes: 59 }] });
  await createOrder(t, null, { date: '2026-11-13', customer_id: xk, container: 'MAUU 900002-5', seal: '', lab_cd: 'wait', lab_o: 'ok',
    lines: [{ lot_id: (await lot('DG-0002.1')).id, qty_g: 1260 * K, boxes: 70, price: 71000 }, { lot_id: (await lot('DG-0002.2')).id, qty_g: 1003 * K, boxes: 59, price: 56000 }],
    costs: [{ kind: 'deduct', name: 'Thùng carton 129 x 41.000', amount: 5_289_000 }] });
  await createTicket(t, null, { date: '2026-11-12', partner_id: kb, vehicle: '47C-000.04', pay_method: 'cash', lines: [{ item_id: I('SR-MT'), gross_g: 930 * K, tare_g: 30 * K, price: 47000 }], note: 'Trả tiền mặt tại vườn, chưa lập bảng kê' });
  await createWork(t, null, { type: 'sort', date: '2026-11-13', inputs: [{ lot_id: (await lot('PC-0006.1')).id, qty_g: 900 * K }], outputs: [{ item_id: I('TD'), qty_g: 852 * K }, { item_id: I('TL'), qty_g: 36 * K }] });
  await createTicket(t, null, { date: '2026-11-14', partner_id: vua, vehicle: '47C-000.01', doc_invoice: true, lines: [{ item_id: I('SR-MT'), gross_g: 3310 * K, tare_g: 110 * K, price: 53000 }] });
  return id;
}

async function seedFrozen() {
  const id = await createTenant({ name: 'Xưởng Múi Đông Mẫu', code: 'mau-cap-dong', lines: 'frozen', is_demo: true, packing_code: 'VN-DLPH-901 (mẫu)', address: 'Cai Lậy, Tiền Giang', norm_peel: 320, box_cost: 12000 });
  const { t, I, lot } = await ctx(id);
  await member(id, 'chu.capdong@mau.csdg', 'Chủ xưởng Múi Đông', 'owner');
  await member(id, 'totruong.capdong@mau.csdg', 'Tổ trưởng sản xuất', 'production');
  await member(id, 'qc.capdong@mau.csdg', 'Nhân viên QC', 'qc');
  const vua = await partner(t, 'supplier', 'trader', 'Vựa Ba Tâm', { tax: '1200xxxxxx', area: 'VN-TGOR-0911', exp: '2027-12-31', addr: 'Cai Lậy, Tiền Giang' });
  const lk = await partner(t, 'supplier', 'linked', 'Tổ hợp tác Ngũ Hiệp', { area: 'VN-TGOR-0912', exp: '2027-09-30', addr: 'Ngũ Hiệp, Tiền Giang' });
  const own = await partner(t, 'supplier', 'own', 'Vườn công ty', { area: 'VN-TGOR-0910', exp: '2028-01-31' });
  const xk = await partner(t, 'customer', 'export', 'Công ty Thực phẩm Quảng Châu Mẫu', { addr: 'Quảng Châu, Trung Quốc' });
  const si = await partner(t, 'customer', 'wholesale', 'Chuỗi cửa hàng trái cây Mẫu', { addr: 'TP. Hồ Chí Minh', tax: '0300xxxxxx' });
  const le = await partner(t, 'customer', 'retail', 'Khách lẻ, bán online');
  await createTicket(t, null, { date: '2026-10-26', partner_id: vua, vehicle: '63C-000.31', doc_invoice: true, lines: [{ item_id: I('SR-RI'), gross_g: 5170 * K, tare_g: 170 * K, price: 52000 }] });
  await createTicket(t, null, { date: '2026-10-26', partner_id: lk, vehicle: '63C-000.32', doc_contract: true, doc_list: true, lines: [{ item_id: I('SR-RI'), gross_g: 4340 * K, tare_g: 140 * K, price: 50000 }] });
  await createTicket(t, null, { date: '2026-10-27', partner_id: own, doc_contract: true, lines: [{ item_id: I('SR-RI'), gross_g: 2800 * K, price: 42000 }] });
  await createWork(t, null, { type: 'sort', date: '2026-10-27', inputs: [{ lot_id: (await lot('PC-0001.1')).id, qty_g: 5000 * K }, { lot_id: (await lot('PC-0002.1')).id, qty_g: 4200 * K }, { lot_id: (await lot('PC-0003.1')).id, qty_g: 2800 * K }],
    outputs: [{ item_id: I('TD'), qty_g: 11520 * K }, { item_id: I('TL'), qty_g: 300 * K }] });
  const td = (await lot('PL-0001.1')).id;
  await createWork(t, null, { type: 'peel', date: '2026-10-28', inputs: [{ lot_id: td, qty_g: 6000 * K }], outputs: [{ item_id: I('MUI'), qty_g: 1890 * K }], note: 'Mẻ 1' });
  await createWork(t, null, { type: 'peel', date: '2026-10-29', inputs: [{ lot_id: td, qty_g: 5520 * K }], outputs: [{ item_id: I('MUI'), qty_g: 1700 * K }, { item_id: I('MUI-D'), qty_g: 40 * K }], note: 'Mẻ 2, trái chín không đều' });
  await createWork(t, null, { type: 'freeze', date: '2026-10-28', inputs: [{ lot_id: (await lot('BM-0001.1')).id, qty_g: 1890 * K }], outputs: [{ item_id: I('MD'), qty_g: 1850 * K }] });
  await createWork(t, null, { type: 'freeze', date: '2026-10-29', inputs: [{ lot_id: (await lot('BM-0002.1')).id, qty_g: 1700 * K }], outputs: [{ item_id: I('MD'), qty_g: 1662 * K }] });
  await createWork(t, null, { type: 'pack', date: '2026-10-30', extra_cost: 350 * 12000, inputs: [{ lot_id: (await lot('CD-0001.1')).id, qty_g: 1850 * K }, { lot_id: (await lot('CD-0002.1')).id, qty_g: 1662 * K }],
    outputs: [{ item_id: I('TP-MD'), qty_g: 3500 * K, boxes: 350 }] });
  const tp = (await lot('DG-0001.1')).id;
  const o1 = await createOrder(t, null, { date: '2026-11-03', customer_id: xk, container: 'MAUU 900101-3', seal: 'S900101', lab_cd: 'ok', lab_o: 'ok', lab_ref: 'KN-2026-1004', phyto: 'KDTV-900101',
    lines: [{ lot_id: tp, qty_g: 2500 * K, boxes: 250, price: 245000 }], costs: [{ kind: 'trip', name: 'Cước container lạnh ra cửa khẩu', amount: 38_000_000 }, { kind: 'trip', name: 'Phí kiểm nghiệm, kiểm dịch', amount: 6_500_000 }] });
  await shipOrder(t, null, o1.id);
  await addPayment(t, null, { ref_type: 'order', ref_id: o1.id, date: '2026-11-10', method: 'bank', amount: 400_000_000, note: 'Đợt 1' });
  const o2 = await createOrder(t, null, { date: '2026-11-05', customer_id: si, vehicle: '63H-000.41', lines: [{ lot_id: tp, qty_g: 600 * K, boxes: 60, price: 230000 }], costs: [{ kind: 'trip', name: 'Cước xe lạnh', amount: 3_200_000 }] });
  await shipOrder(t, null, o2.id);
  await addPayment(t, null, { ref_type: 'order', ref_id: o2.id, date: '2026-11-06', method: 'bank', amount: 138_000_000 });
  const o3 = await createOrder(t, null, { date: '2026-11-08', customer_id: le, lines: [{ lot_id: tp, qty_g: 50 * K, boxes: 5, price: 265000 }] });
  await shipOrder(t, null, o3.id);
  await addPayment(t, null, { ref_type: 'order', ref_id: o3.id, date: '2026-11-08', method: 'cash', amount: 13_250_000 });
  // Mẻ đang làm dở
  await createTicket(t, null, { date: '2026-11-12', partner_id: lk, vehicle: '63C-000.32', doc_contract: true, doc_list: true, lines: [{ item_id: I('SR-RI'), gross_g: 3720 * K, tare_g: 120 * K, price: 51000 }] });
  await createWork(t, null, { type: 'sort', date: '2026-11-12', inputs: [{ lot_id: (await lot('PC-0004.1')).id, qty_g: 3600 * K }], outputs: [{ item_id: I('TD'), qty_g: 3450 * K }, { item_id: I('TL'), qty_g: 95 * K }] });
  await createWork(t, null, { type: 'peel', date: '2026-11-13', inputs: [{ lot_id: (await lot('PL-0002.1')).id, qty_g: 3450 * K }], outputs: [{ item_id: I('MUI'), qty_g: 1082 * K }], note: 'Mẻ 3' });
  await createWork(t, null, { type: 'freeze', date: '2026-11-13', inputs: [{ lot_id: (await lot('BM-0003.1')).id, qty_g: 1082 * K }], outputs: [{ item_id: I('MD'), qty_g: 1060 * K }] });
  await createTicket(t, null, { date: '2026-11-14', partner_id: vua, vehicle: '63C-000.31', doc_invoice: true, lines: [{ item_id: I('SR-RI'), gross_g: 2890 * K, tare_g: 90 * K, price: 53000 }] });
  for (const tk of await all<any>(`SELECT id, total_amount FROM weigh_tickets WHERE tenant_id=? AND source<>'own' AND paid=0 AND date<'2026-11-10'`, id))
    await addPayment(t, null, { ref_type: 'ticket', ref_id: tk.id, date: '2026-11-08', method: 'bank', amount: tk.total_amount });
  return id;
}

async function seedBoth() {
  const id = await createTenant({ name: 'Công ty Nông Sản Tổng Hợp Mẫu', code: 'mau-tong-hop', lines: 'both', is_demo: true, packing_code: 'VN-DLPH-902 (mẫu)', address: 'Bảo Lộc, Lâm Đồng', norm_peel: 320, box_cost: 12000 });
  const { t, I, lot } = await ctx(id);
  await member(id, 'chu.tonghop@mau.csdg', 'Giám đốc Nông Sản Tổng Hợp', 'owner');
  await member(id, 'banhang.tonghop@mau.csdg', 'Nhân viên bán hàng', 'sales');
  await member(id, 'kho.tonghop@mau.csdg', 'Thủ kho', 'warehouse');
  const vua = await partner(t, 'supplier', 'trader', 'Vựa Sáu Hùng', { tax: '5800xxxxxx', area: 'VN-LDOR-0921', exp: '2027-12-31', addr: 'Bảo Lộc, Lâm Đồng' });
  const own = await partner(t, 'supplier', 'own', 'Trang trại công ty', { area: 'VN-LDOR-0920', exp: '2028-05-31', addr: 'Đạ Huoai, Lâm Đồng' });
  const kl = await partner(t, 'supplier', 'unlinked', 'Vườn cô Năm', { addr: 'Đạ Tẻh, Lâm Đồng', note: 'Chưa có mã số vùng trồng' });
  const xk = await partner(t, 'customer', 'export', 'Công ty Thương mại Nam Ninh Mẫu', { addr: 'Nam Ninh, Quảng Tây' });
  const si = await partner(t, 'customer', 'wholesale', 'Đại lý trái cây Miền Đông', { addr: 'Biên Hòa, Đồng Nai' });
  const le = await partner(t, 'customer', 'retail', 'Khách lẻ');
  await createTicket(t, null, { date: '2026-11-01', partner_id: vua, vehicle: '49C-000.51', doc_invoice: true, lines: [{ item_id: I('SR-MT'), gross_g: 8260 * K, tare_g: 260 * K, price: 55000 }] });
  await createTicket(t, null, { date: '2026-11-01', partner_id: own, doc_contract: true, lines: [{ item_id: I('SR-MT'), gross_g: 3000 * K, price: 45000 }] });
  await createWork(t, null, { type: 'sort', date: '2026-11-02', inputs: [{ lot_id: (await lot('PC-0001.1')).id, qty_g: 8000 * K }, { lot_id: (await lot('PC-0002.1')).id, qty_g: 3000 * K }],
    outputs: [{ item_id: I('TD'), qty_g: 10300 * K }, { item_id: I('TL'), qty_g: 520 * K }] });
  const td = (await lot('PL-0001.1')).id;
  await createWork(t, null, { type: 'pack', date: '2026-11-03', inputs: [{ lot_id: td, qty_g: 6000 * K }], outputs: [{ item_id: I('MT-A'), qty_g: 3960 * K, boxes: 220 }, { item_id: I('MT-B'), qty_g: 1972 * K, boxes: 116 }], extra_cost: 336 * 12000 });
  await createWork(t, null, { type: 'peel', date: '2026-11-03', inputs: [{ lot_id: td, qty_g: 4300 * K }], outputs: [{ item_id: I('MUI'), qty_g: 1350 * K }], note: 'Trái cỡ nhỏ, không đủ chuẩn đóng thùng' });
  await createWork(t, null, { type: 'freeze', date: '2026-11-03', inputs: [{ lot_id: (await lot('BM-0001.1')).id, qty_g: 1350 * K }], outputs: [{ item_id: I('MD'), qty_g: 1322 * K }] });
  await createWork(t, null, { type: 'pack', date: '2026-11-04', inputs: [{ lot_id: (await lot('CD-0001.1')).id, qty_g: 1322 * K }], outputs: [{ item_id: I('TP-MD'), qty_g: 1320 * K, boxes: 132 }], extra_cost: 132 * 12000 });
  const o1 = await createOrder(t, null, { date: '2026-11-04', customer_id: xk, container: 'MAUU 900201-7', seal: 'S900201', lab_cd: 'ok', lab_o: 'ok', lab_ref: 'KN-2026-1102', phyto: 'KDTV-900201',
    lines: [{ lot_id: (await lot('DG-0001.1')).id, qty_g: 3960 * K, boxes: 220, price: 69000 }, { lot_id: (await lot('DG-0001.2')).id, qty_g: 1972 * K, boxes: 116, price: 56000 }],
    costs: [{ kind: 'deduct', name: 'Bốc xếp', amount: 1_500_000 }, { kind: 'trip', name: 'Cước xe ra cửa khẩu', amount: 22_000_000 }] });
  await shipOrder(t, null, o1.id);
  await addPayment(t, null, { ref_type: 'order', ref_id: o1.id, date: '2026-11-10', method: 'bank', amount: 382_172_000 });
  const o2 = await createOrder(t, null, { date: '2026-11-06', customer_id: si, vehicle: '60H-000.61', lines: [{ lot_id: (await lot('DG-0002.1')).id, qty_g: 800 * K, boxes: 80, price: 235000 }], costs: [{ kind: 'trip', name: 'Cước xe lạnh', amount: 2_800_000 }] });
  await shipOrder(t, null, o2.id);
  await addPayment(t, null, { ref_type: 'order', ref_id: o2.id, date: '2026-11-07', method: 'bank', amount: 100_000_000 });
  await createOrder(t, null, { date: '2026-11-13', customer_id: le, lines: [{ lot_id: (await lot('DG-0002.1')).id, qty_g: 100 * K, boxes: 10, price: 260000 }], note: 'Chờ khách xác nhận ngày giao' });
  await createTicket(t, null, { date: '2026-11-12', partner_id: kl, vehicle: '49C-000.52', pay_method: 'bank', doc_list: true, lines: [{ item_id: I('SR-MT'), gross_g: 1850 * K, tare_g: 50 * K, price: 46000 }] });
  await createWork(t, null, { type: 'sort', date: '2026-11-13', inputs: [{ lot_id: (await lot('PC-0003.1')).id, qty_g: 1800 * K }], outputs: [{ item_id: I('TD'), qty_g: 1710 * K }, { item_id: I('TL'), qty_g: 70 * K }] });
  await run(`UPDATE lots SET status='hold' WHERE tenant_id=? AND code='PL-0002.1'`, id);
  // Quy trình mở rộng: sầu riêng Ri6 sấy thăng hoa, khai báo từ mẫu
  const fd = TEMPLATES.fd, T = (x: string) => x.replace('{T}', x.startsWith('{T}') ? 'Sầu riêng' : 'sầu riêng');
  const pid = await createProcess(t, { name: 'Sầu riêng sấy thăng hoa', note: 'Dùng trái Ri6, hộp 100 g', in_item_id: I('SR-RI'), box_g: 100, price: 1_900_000,
    steps: fd.steps.map((x) => ({ name: x.name, out: T(x.out), norm: x.norm * 10, extra_label: x.extra, hold_days: x.hold })) });
  const P = (await loadProcs(id)).find((p) => p.id === pid)!;
  const out = async (k: number) => (await one<any>(`SELECT id FROM items WHERE tenant_id=? AND stage=?`, id, P.steps[k].skey))!.id;
  await createTicket(t, null, { date: '2026-11-09', partner_id: vua, vehicle: '49C-000.53', doc_invoice: true, lines: [{ item_id: I('SR-RI'), gross_g: 1020 * K, tare_g: 20 * K, price: 48000 }] });
  await createWork(t, null, { step_id: P.steps[0].id, date: '2026-11-10', inputs: [{ lot_id: (await lot('PC-0004.1')).id, qty_g: 1000 * K }], outputs: [{ item_id: await out(0), qty_g: 310 * K }] });
  await createWork(t, null, { step_id: P.steps[1].id, date: '2026-11-10', extra_cost: 1_500_000, inputs: [{ lot_id: (await lot('TM-0001.1')).id, qty_g: 310 * K }], outputs: [{ item_id: await out(1), qty_g: 308 * K }] });
  await createWork(t, null, { step_id: P.steps[2].id, date: '2026-11-11', extra_cost: 6_000_000, inputs: [{ lot_id: (await lot('PTP-0001.1')).id, qty_g: 308 * K }], outputs: [{ item_id: await out(2), qty_g: 90 * K }], note: 'Mẻ sấy 36 giờ' });
  await createWork(t, null, { step_id: P.steps[3].id, date: '2026-11-12', extra_cost: 890 * 3500, inputs: [{ lot_id: (await lot('STH-0001.1')).id, qty_g: 90 * K }], outputs: [{ item_id: await out(3), qty_g: 89 * K, boxes: 890 }] });
  const o4 = await createOrder(t, null, { date: '2026-11-13', customer_id: si, vehicle: '60H-000.61', lines: [{ lot_id: (await lot('DHO-0001.1')).id, qty_g: 50 * K, boxes: 500, price: 1_900_000 }], costs: [{ kind: 'trip', name: 'Cước giao hàng', amount: 600_000 }] });
  await shipOrder(t, null, o4.id);
  await addPayment(t, null, { ref_type: 'order', ref_id: o4.id, date: '2026-11-13', method: 'bank', amount: 95_000_000 });
  for (const tk of await all<any>(`SELECT id, total_amount FROM weigh_tickets WHERE tenant_id=? AND source<>'own' AND paid=0 AND date<'2026-11-10'`, id))
    await addPayment(t, null, { ref_type: 'ticket', ref_id: tk.id, date: '2026-11-08', method: 'bank', amount: tk.total_amount });
  return id;
}

const TABLES = ['processes', 'process_steps', 'partners', 'items', 'lots', 'lot_links', 'weigh_tickets', 'weigh_lines', 'works', 'work_inputs', 'work_outputs', 'orders', 'order_lines', 'order_costs', 'payments', 'counters', 'memberships'];

/** Xóa dữ liệu mẫu cũ, chạy kịch bản, trả về ảnh chụp dữ liệu để lưu thành src/data/demo.json. */
export async function buildSnapshot() {
  const old = await all<any>('SELECT id FROM tenants WHERE is_demo=1');
  for (const o of old) {
    for (const tb of [...TABLES, 'adjusts', 'adjust_lines', 'audit']) await run(`DELETE FROM ${tb} WHERE tenant_id=?`, o.id);
    await run('DELETE FROM tenants WHERE id=?', o.id);
  }
  await run(`DELETE FROM users WHERE email LIKE '%@mau.csdg'`);
  const ids = [await seedFresh(), await seedFrozen(), await seedBoth()];
  const j = JSON.stringify(ids);
  const snap: any = { tenants: await all(`SELECT * FROM tenants WHERE id IN (SELECT value FROM json_each(?)) ORDER BY rowid`, j), users: await all(`SELECT id,email,name FROM users WHERE email LIKE '%@mau.csdg' ORDER BY rowid`), tables: {} };
  for (const tb of TABLES) snap.tables[tb] = await all(`SELECT * FROM ${tb} WHERE tenant_id IN (SELECT value FROM json_each(?)) ORDER BY rowid`, j);
  return snap;
}
