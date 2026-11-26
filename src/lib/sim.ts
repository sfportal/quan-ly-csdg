// Vận hành thử theo kịch bản: một doanh nghiệp mô phỏng tự làm việc hằng ngày qua đúng các hàm nghiệp vụ mà người dùng thật bấm.
// Mọi tên đối tác, mã vùng trồng, biển số, giá và tỷ lệ ở đây là giả định để chạy thử, không phải số liệu thật.
import { all, one, run, batch, uid, simRun, simSet, simQ } from './db';
import { createTenant } from './setup';
import { createProcess, TEMPLATES } from './proc';
import { createTicket, createWork, createOrder, shipOrder, addPayment, voidTicket, createAdjust } from './domain';
import { reconcile } from './stock';

export const SIM = { code: 'sau-rieng-ngon', name: 'Công ty CP TMDV Sầu Riêng Ngon', from: '2026-11-23', until: '2027-01-01' };

const K = 1000;
const addD = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const dow = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
const dayN = (d: string) => Math.round((Date.parse(d) - Date.parse(SIM.from)) / 864e5);
const vnMs = (d: string, hm: string) => Date.parse(`${d}T${hm}:00+07:00`);
const kgs = (g: number) => (g / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' kg';
const dg = (d: number) => Math.round(d).toLocaleString('vi-VN') + ' đ';
const sum = (a: any[], f: (x: any) => number) => a.reduce((s, x) => s + f(x), 0);
const rk = (g: number) => Math.round(g / 1000) * 1000;

/** Số ngẫu nhiên có hạt giống: cùng ngày, cùng việc thì luôn ra cùng một số. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const u = (r: () => number, a: number, b: number) => a + (b - a) * r();

/** Giá trong ngày (giả định): neo theo mặt bằng giá miền Tây giữa tháng 11/2026, nhích dần về cuối năm. */
export function prices(d: string) {
  const r = rng('gia' + d), n = dayN(d), r5 = (v: number) => Math.round(v / 500) * 500, r1 = (v: number) => Math.round(v / 1000) * 1000;
  const mt = r5(86000 + 150 * n + (r() - 0.5) * 3000), ri = r5(55000 + 100 * n + (r() - 0.5) * 2400), xo = r5(32000 + 50 * n + (r() - 0.5) * 1600);
  return { mt, ri, xo, A: r1(mt * 1.32), B: r1(mt * 1.16), C: r1(mt * 0.9), fzx: 245000, fzd: 205000, fdc: 1650000, fdr: 1950000 };
}

export const STAFF: [role: string, email: string, name: string][] = [
  ['owner', 'giamdoc@sauriengngon.test', 'Trần Minh Ngon, Giám đốc'],
  ['manager', 'quanly@sauriengngon.test', 'Lê Thị Thu Hà, Quản lý cơ sở'],
  ['purchaser', 'thumua@sauriengngon.test', 'Phạm Văn Tài, Thu mua'],
  ['weigher', 'tramcan@sauriengngon.test', 'Nguyễn Thị Kim Loan, Trạm cân'],
  ['production', 'sanxuat@sauriengngon.test', 'Võ Văn Bền, Tổ trưởng sản xuất'],
  ['packer', 'donggoi@sauriengngon.test', 'Huỳnh Thị Mai, Tổ trưởng đóng gói'],
  ['warehouse', 'thukho@sauriengngon.test', 'Đặng Văn Phúc, Thủ kho'],
  ['qc', 'qc@sauriengngon.test', 'Bùi Thị Ngọc Ánh, Kiểm soát chất lượng'],
  ['sales', 'banhang@sauriengngon.test', 'Trương Quốc Việt, Bán hàng'],
  ['exportdoc', 'chungtu@sauriengngon.test', 'Lý Thị Hồng, Chứng từ xuất khẩu'],
  ['accountant', 'ketoan@sauriengngon.test', 'Đỗ Thị Thanh Tâm, Kế toán'],
];

const MP = 'Đối tác mô phỏng';
type Sup = { name: string; sub: string; veh: string; adj: number; x: any };
const SUP: Record<string, Sup> = {
  tt: { name: 'Vựa Tư Thành', sub: 'trader', veh: '63C-901.12', adj: 1000, x: { tax: '1201xxxxxx', area: 'VN-TGOR-9101', exp: '2027-12-31', addr: 'Cai Lậy, Đồng Tháp (Tiền Giang cũ)', phone: '0900 000 911' } },
  hn: { name: 'Vựa Hai Nhân', sub: 'trader', veh: '71C-902.34', adj: 500, x: { tax: '1300xxxxxx', area: 'VN-BTOR-9102', exp: '2027-10-31', addr: 'Chợ Lách, Vĩnh Long (Bến Tre cũ)', phone: '0900 000 912' } },
  ml: { name: 'Tổ hợp tác sầu riêng Mỹ Lợi', sub: 'linked', veh: '63C-903.56', adj: 0, x: { area: 'VN-TGOR-9103', exp: '2027-09-30', addr: 'Cái Bè, Đồng Tháp (Tiền Giang cũ)', phone: '0900 000 913' } },
  sd: { name: 'Vườn liên kết chú Sáu Đực', sub: 'linked', veh: '65C-904.78', adj: 0, x: { area: 'VN-CTOR-9104', exp: '2027-08-31', addr: 'Phong Điền, Cần Thơ', phone: '0900 000 914' } },
  bh: { name: 'Vườn cô Ba Hường', sub: 'unlinked', veh: '83C-905.90', adj: 0, x: { addr: 'Kế Sách, Cần Thơ (Sóc Trăng cũ)', phone: '0900 000 915', note: 'Chưa có mã số vùng trồng' } },
  ct: { name: 'Vườn công ty tại Cai Lậy', sub: 'own', veh: '63C-900.01', adj: 0, x: { area: 'VN-TGOR-9100', exp: '2028-03-31', addr: 'Cai Lậy, Đồng Tháp (Tiền Giang cũ)' } },
};
const CUS: Record<string, { name: string; sub: string; due: number; x: any }> = {
  bt: { name: 'Công ty XNK Trái cây Bằng Tường (mô phỏng)', sub: 'export', due: 7, x: { addr: 'Bằng Tường, Quảng Tây, Trung Quốc', note: 'Trái tươi, thanh toán chuyển khoản ngoại tệ' } },
  hk: { name: 'Công ty Thương mại Hà Khẩu (mô phỏng)', sub: 'export', due: 7, x: { addr: 'Hà Khẩu, Vân Nam, Trung Quốc', note: 'Trái tươi' } },
  qc: { name: 'Công ty Thực phẩm đông lạnh Quảng Châu (mô phỏng)', sub: 'export', due: 10, x: { addr: 'Quảng Châu, Trung Quốc', note: 'Múi cấp đông' } },
  td: { name: 'Vựa trái cây chợ đầu mối Thủ Đức, sạp B12 (mô phỏng)', sub: 'wholesale', due: 1, x: { addr: 'Thủ Đức, TP. Hồ Chí Minh' } },
  vx: { name: 'Chuỗi cửa hàng trái cây Vườn Xanh (mô phỏng)', sub: 'wholesale', due: 7, x: { addr: 'TP. Hồ Chí Minh', tax: '0300xxxxxx', note: 'Công nợ 7 ngày' } },
  uh: { name: 'Cơ sở kem bánh Út Hiền (mô phỏng)', sub: 'wholesale', due: 0, x: { addr: 'Cai Lậy, Đồng Tháp (Tiền Giang cũ)', note: 'Mua trái dạt, múi dạt' } },
  kl: { name: 'Khách lẻ, bán online', sub: 'retail', due: 0, x: {} },
};
const PF = 'Sầu riêng trái tươi đóng thùng', PZ = 'Sầu riêng bóc múi cấp đông', PD = 'Sầu riêng sấy thăng hoa';

// ---------- Khai báo ban đầu ----------
async function setup() {
  simSet(vnMs(SIM.from, '05:00'));
  const id = await createTenant({ name: SIM.name, code: SIM.code, lines: 'both', packing_code: 'VN-TGPH-9100 (giả định)', address: 'Cai Lậy, Đồng Tháp (địa chỉ giả định)', norm_peel: 320, box_cost: 12000 });
  const at = new Date(vnMs(SIM.from, '05:00')).toISOString();
  const st: [string, any[]][] = [[`UPDATE tenants SET sim_from=?, sim_until=?, sim_day=?, sim_idx=0 WHERE id=?`, [SIM.from, SIM.until, SIM.from, id]]];
  for (const [role, email, name] of STAFF) {
    st.push([`INSERT OR IGNORE INTO users(id,email,name,created_at) VALUES(?,?,?,?)`, [uid(), email, name, at]]);
    st.push([`INSERT INTO memberships(id,tenant_id,user_id,role,created_at) SELECT ?,?,id,?,? FROM users WHERE email=?`, [uid(), id, role, at, email]]);
  }
  const P = `INSERT INTO partners(id,tenant_id,kind,sub,name,phone,tax_code,area_code,area_expiry,address,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)`;
  for (const s of Object.values(SUP)) st.push([P, [uid(), id, 'supplier', s.sub, s.name, s.x.phone || '', s.x.tax || '', s.x.area || '', s.x.exp || '', s.x.addr || '', [s.x.note, MP].filter(Boolean).join('. ')]]);
  for (const c of Object.values(CUS)) st.push([P, [uid(), id, 'customer', c.sub, c.name, '', c.x.tax || '', '', '', c.x.addr || '', [c.x.note, MP].filter(Boolean).join('. ')]]);
  const p = prices(SIM.from);
  for (const [code, v] of Object.entries({ 'SR-MT': p.mt, 'SR-RI': p.ri, 'SR-XO': p.xo, 'MT-A': p.A, 'MT-B': p.B, 'MT-C': p.C, 'TP-MD': p.fzx }))
    st.push([`UPDATE items SET price=? WHERE tenant_id=? AND code=?`, [v, id, code]]);
  st.push([`INSERT INTO audit(id,tenant_id,user_id,action,ref,detail,at) VALUES(?,?,NULL,'tenant.create',?,?,?)`, [uid(), id, SIM.name, 'Doanh nghiệp vận hành thử theo kịch bản, dữ liệu mô phỏng', at]]);
  st.push([LOG, [uid(), id, SIM.from, -1, '05:00', 'setup', 'Khai báo doanh nghiệp: danh mục, ba quy trình, 13 đối tác, 11 tài khoản nhân viên', 'owner', 'ok', 'Trái tươi đóng thùng, múi cấp đông, sấy thăng hoa', new Date().toISOString()]]);
  await batch(st);
  const ri = await one<any>(`SELECT id FROM items WHERE tenant_id=? AND code='SR-RI'`, id);
  const T = (x: string) => x.replace('{T}', x.startsWith('{T}') ? 'Sầu riêng' : 'sầu riêng');
  await createProcess({ id }, { name: PD, note: 'Dùng trái Ri6, hộp 100 g', in_item_id: ri.id, box_g: 100, price: p.fdc,
    steps: TEMPLATES.fd.steps.map((x) => ({ name: x.name, out: T(x.out), norm: x.norm * 10, extra_label: x.extra, hold_days: x.hold })) });
}
const LOG = `INSERT INTO sim_log(id,tenant_id,day,idx,time,key,title,role,status,result,ran_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`;

// ---------- Ngữ cảnh một lượt chạy ----------
type Res = { st: 'ok' | 'skip' | 'more'; msg: string };
const ok = (msg: string): Res => ({ st: 'ok', msg }), skip = (msg: string): Res => ({ st: 'skip', msg }), more = (msg: string): Res => ({ st: 'more', msg });
type Ctx = { t: any; day: string; U: Record<string, string>; I: (code: string) => any; P: (name: string) => any; S: (proc: string, seq: number) => string; room: (n: number) => boolean; r: () => number; pr: ReturnType<typeof prices> };
export type Act = { time: string; key: string; role: string; title: string; run: (c: Ctx) => Promise<Res> };

async function loadCtx(t: any, maxQ: number): Promise<Ctx> {
  const mem = await all<any>(`SELECT role, user_id FROM memberships WHERE tenant_id=? AND status='active'`, t.id);
  const items = await all<any>(`SELECT * FROM items WHERE tenant_id=?`, t.id);
  const partners = await all<any>(`SELECT * FROM partners WHERE tenant_id=?`, t.id);
  const steps = await all<any>(`SELECT s.id, s.seq, p.name FROM process_steps s JOIN processes p ON p.id=s.process_id WHERE s.tenant_id=?`, t.id);
  const need = <T,>(v: T | undefined, what: string): T => { if (!v) throw new Error('Thiếu khai báo: ' + what); return v; };
  return {
    t, day: '', U: Object.fromEntries(mem.map((m) => [m.role, m.user_id])),
    I: (code) => need(items.find((i) => i.code === code), 'mặt hàng ' + code),
    P: (name) => need(partners.find((p) => p.name === name), 'đối tác ' + name),
    S: (proc, seq) => need(steps.find((s) => s.name === proc && s.seq === seq), 'bước ' + seq + ' của ' + proc).id,
    room: (n) => simQ() + n <= maxQ - 3, r: Math.random, pr: prices(SIM.from),
  };
}

const LOTS = `SELECT l.*, i.code icode, i.box_g, i.price iprice FROM lots l JOIN items i ON i.id=l.item_id WHERE l.tenant_id=?1 AND l.qty_g>0 AND l.status='ok'`;
const SRC = (code: string) => ` AND EXISTS (SELECT 1 FROM lot_links k JOIN lots s ON s.id=k.from_lot JOIN items si ON si.id=s.item_id WHERE k.to_lot=l.id AND si.code='${code}')`;
const FREE = ` AND NOT EXISTS (SELECT 1 FROM order_lines ol JOIN orders o ON o.id=ol.order_id WHERE ol.lot_id=l.id AND o.status='draft')`;
const ORD = ` ORDER BY l.date, l.code`;
const full = (lots: any[]) => lots.map((l) => ({ lot_id: l.id, qty_g: l.qty_g }));
/** Lấy lần lượt từ lô cũ nhất cho đủ số gam cần. */
function take(lots: any[], need: number) {
  const out: { lot_id: string; qty_g: number }[] = [];
  for (const l of lots) { if (need <= 0) break; const q = Math.min(l.qty_g, need); out.push({ lot_id: l.id, qty_g: q }); need -= q; }
  return out;
}

// ---------- Các việc ----------
function ticket(time: string, sk: string, lines: [code: string, kg: number][], extra: { key?: string; title?: string } = {}): Act {
  const s = SUP[sk];
  const names: Record<string, string> = { 'SR-MT': 'Monthong', 'SR-RI': 'Ri6', 'SR-XO': 'hàng xô' };
  return {
    time, key: extra.key || 'can.' + sk, role: 'weigher',
    title: extra.title || `Cân nhập xe ${s.name}: ${lines.map(([c, kg]) => `${names[c]} khoảng ${(kg / 1000).toLocaleString('vi-VN')} tấn`).join(', ')}`,
    run: async (c) => {
      const base: Record<string, number> = { 'SR-MT': c.pr.mt, 'SR-RI': c.pr.ri, 'SR-XO': c.pr.xo };
      const L = lines.map(([code, kg]) => {
        const tare = Math.round(kg * u(c.r, 0.025, 0.035)), ded = c.r() < 0.4 ? Math.round(kg * 0.005) : 0;
        const price = s.sub === 'own' ? Math.round((base[code] * 0.7) / 500) * 500 : base[code] + s.adj;
        return { item_id: c.I(code).id, gross_g: (kg + tare + ded) * K, tare_g: tare * K, deduct_g: ded * K, price };
      });
      const r = await createTicket(c.t, c.U.weigher, {
        date: c.day, partner_id: c.P(s.name).id, vehicle: s.veh, pay_method: 'bank',
        doc_invoice: s.sub === 'trader' && c.r() > 0.3, doc_contract: s.sub === 'linked' || s.sub === 'own', doc_list: (s.sub === 'linked' && c.r() > 0.25) || (s.sub === 'unlinked' && c.r() > 0.4),
        lines: L, note: s.sub === 'own' ? 'Nhập nội bộ theo giá chuyển giao' : '',
      });
      const net = sum(L, (l) => l.gross_g - l.tare_g - l.deduct_g), amt = sum(L, (l) => Math.round(((l.gross_g - l.tare_g - l.deduct_g) * l.price) / 1000));
      return ok(`${r.code}: tịnh ${kgs(net)}, ${dg(amt)}`);
    },
  };
}
const voidWrong = (time: string, sk: string): Act => ({
  time, key: 'can.huy', role: 'weigher', title: `Phát hiện nhập nhầm số cân, hủy phiếu vừa lập của ${SUP[sk].name} kèm lý do`,
  run: async (c) => {
    const tk = await one<any>(`SELECT id, code FROM weigh_tickets WHERE tenant_id=? AND partner_id=? AND date=? AND void_at IS NULL ORDER BY created_at DESC LIMIT 1`, c.t.id, c.P(SUP[sk].name).id, c.day);
    if (!tk) return skip('Không có phiếu nào để hủy.');
    await voidTicket(c.t, c.U.weigher, tk.id, 'Nhập nhầm số cân cả bì (dư một chữ số), lập lại phiếu đúng');
    return ok(`Đã hủy ${tk.code}, phiếu vẫn nằm trong danh sách với lý do hủy`);
  },
});

const priceUp = (time: string): Act => ({
  time, key: 'gia', role: 'purchaser', title: 'Cập nhật giá mua tham chiếu và giá bán trái tươi trong ngày',
  run: async (c) => {
    const want: Record<string, number> = { 'SR-MT': c.pr.mt, 'SR-RI': c.pr.ri, 'SR-XO': c.pr.xo, 'MT-A': c.pr.A, 'MT-B': c.pr.B, 'MT-C': c.pr.C };
    const st: [string, any[]][] = [], at = new Date(vnMs(c.day, time)).toISOString();
    for (const [code, v] of Object.entries(want)) {
      const it = c.I(code);
      if (it.price === v) continue;
      st.push([`UPDATE items SET price=? WHERE id=? AND tenant_id=?`, [v, it.id, c.t.id]]);
      st.push([`INSERT INTO audit(id,tenant_id,user_id,action,ref,detail,old,new,at) VALUES(?,?,?,?,?,?,?,?,?)`, [uid(), c.t.id, c.U[code.startsWith('SR') ? 'purchaser' : 'sales'], 'item.update', code, '', `giá ${dg(it.price)}/kg`, `giá ${dg(v)}/kg`, at]]);
      it.price = v;
    }
    if (!st.length) return skip('Giá không đổi so với hôm qua.');
    await batch(st);
    return ok(`Monthong ${dg(c.pr.mt)}/kg, Ri6 ${dg(c.pr.ri)}/kg, hàng xô ${dg(c.pr.xo)}/kg`);
  },
});

function sortAct(time: string, v: 'MT' | 'RI' | 'XO'): Act {
  const nm = { MT: 'Monthong có mã vùng trồng', RI: 'Ri6 có mã vùng trồng', XO: 'hàng xô chưa có mã vùng trồng' }[v];
  return {
    time, key: 'pl.' + v, role: 'production', title: `Phân loại ${nm}`,
    run: async (c) => {
      const lots = await all<any>(LOTS + ` AND l.stage='receive' AND i.code=?2 AND l.date<=?3` + ORD, c.t.id, 'SR-' + v, c.day);
      if (!lots.length) return skip('Không có nguyên liệu chờ phân loại.');
      const g = sum(lots, (l) => l.qty_g), f = v === 'XO' ? [0.84, 0.87, 0.09, 0.115] : [0.935, 0.952, 0.03, 0.042];
      const td = rk(g * u(c.r, f[0], f[1])), tl = rk(g * u(c.r, f[2], f[3]));
      const w = await createWork(c.t, c.U.production, { step_id: c.S(v === 'MT' ? PF : PZ, 1), date: c.day, note: nm[0].toUpperCase() + nm.slice(1), inputs: full(lots), outputs: [{ item_id: c.I('TD').id, qty_g: td }, { item_id: c.I('TL').id, qty_g: tl }] });
      return ok(`${w.code}: vào ${kgs(g)}, trái đạt ${kgs(td)}, trái dạt ${kgs(tl)}`);
    },
  };
}

const packFresh = (time: string): Act => ({
  time, key: 'dg.tuoi', role: 'packer', title: 'Đóng thùng Monthong trái tươi loại A, B, C',
  run: async (c) => {
    const lots = await all<any>(LOTS + ` AND i.code='TD'` + SRC('SR-MT') + ORD, c.t.id);
    if (!lots.length) return skip('Không có trái đạt chờ đóng thùng.');
    const g = sum(lots, (l) => l.qty_g) * u(c.r, 0.985, 0.995), a = u(c.r, 0.43, 0.49), b = u(c.r, 0.37, 0.43);
    const o = ([['MT-A', a], ['MT-B', b], ['MT-C', 1 - a - b]] as [string, number][]).map(([code, sh]) => { const it = c.I(code), boxes = Math.floor((g * sh) / it.box_g); return { item_id: it.id, qty_g: boxes * it.box_g, boxes }; }).filter((x) => x.boxes > 0);
    if (!o.length) return skip('Chưa đủ hàng cho một thùng.');
    const n = sum(o, (x) => x.boxes);
    const w = await createWork(c.t, c.U.packer, { step_id: c.S(PF, 2), date: c.day, note: 'A 3 đai vàng, B 2 đai đỏ, C 2 đai xanh', extra_cost: n * 41000, inputs: full(lots), outputs: o });
    return ok(`${w.code}: ${o.map((x, i) => `${'ABC'[i]} ${x.boxes} thùng`).join(', ')}`);
  },
});

function peel(time: string, area: boolean): Act {
  return {
    time, key: 'bm.' + (area ? 'ma' : 'xo'), role: 'production', title: `Bóc múi ${area ? 'Ri6 có mã vùng trồng' : 'hàng xô'}`,
    run: async (c) => {
      const lots = await all<any>(LOTS + ` AND i.code='TD'` + SRC(area ? 'SR-RI' : 'SR-XO') + ORD, c.t.id);
      if (!lots.length) return skip('Không có trái đạt chờ bóc múi.');
      const g = sum(lots, (l) => l.qty_g), mui = rk(g * (area ? u(c.r, 0.312, 0.328) : u(c.r, 0.28, 0.305))), dat = rk(g * u(c.r, 0.006, 0.01));
      const w = await createWork(c.t, c.U.production, { step_id: c.S(PZ, 2), date: c.day, note: area ? 'Ri6' : 'Hàng xô, bán nội địa', inputs: full(lots), outputs: [{ item_id: c.I('MUI').id, qty_g: mui }, { item_id: c.I('MUI-D').id, qty_g: dat }] });
      return ok(`${w.code}: vào ${kgs(g)}, múi ${kgs(mui)} (${((mui / g) * 100).toFixed(1)}%), múi dạt ${kgs(dat)}`);
    },
  };
}
const AREA = (area: boolean) => (area ? ` AND l.area_code<>''` : ` AND l.area_code=''`);
function freeze(time: string, area: boolean): Act {
  return {
    time, key: 'cd.' + (area ? 'ma' : 'xo'), role: 'production', title: `Cấp đông múi ${area ? 'có mã vùng trồng' : 'hàng xô'}`,
    run: async (c) => {
      const lots = await all<any>(LOTS + ` AND i.code='MUI'` + AREA(area) + ORD, c.t.id);
      if (!lots.length) return skip('Không có múi tươi chờ cấp đông.');
      const g = sum(lots, (l) => l.qty_g), md = Math.round((g * u(c.r, 0.976, 0.986)) / 100) * 100;
      const w = await createWork(c.t, c.U.production, { step_id: c.S(PZ, 3), date: c.day, inputs: full(lots), outputs: [{ item_id: c.I('MD').id, qty_g: md }] });
      return ok(`${w.code}: vào ${kgs(g)}, ra ${kgs(md)}`);
    },
  };
}
function packFrozen(time: string, area: boolean): Act {
  return {
    time, key: 'dg.dong.' + (area ? 'ma' : 'xo'), role: 'packer', title: `Đóng thùng 10 kg múi cấp đông ${area ? 'có mã vùng trồng' : 'hàng xô'} của mẻ hôm trước`,
    run: async (c) => {
      const lots = await all<any>(LOTS + ` AND i.code='MD' AND l.date<?2` + AREA(area) + ORD, c.t.id, c.day);
      const g = sum(lots, (l) => l.qty_g), boxes = Math.floor((g * 0.999) / 10000);
      if (boxes < 1) return skip('Chưa có múi đã đông đủ một thùng.');
      const need = Math.min(g, boxes * 10000 + Math.round((boxes * 10000 * 0.0005) / 100) * 100);
      const w = await createWork(c.t, c.U.packer, { step_id: c.S(PZ, 4), date: c.day, extra_cost: boxes * 12000, inputs: take(lots, need), outputs: [{ item_id: c.I('TP-MD').id, qty_g: boxes * 10000, boxes }] });
      return ok(`${w.code}: ${boxes} thùng, ${kgs(boxes * 10000)}`);
    },
  };
}

// Sấy thăng hoa: bốn bước của quy trình tự khai báo
function fd(time: string, step: 1 | 2 | 3 | 4): Act {
  const T = ['Tách múi Ri6 cho mẻ sấy thăng hoa', 'Phối trộn phụ gia mẻ sấy thăng hoa', 'Ra mẻ sấy thăng hoa sau 36 giờ', 'Đóng hộp 100 g sầu riêng sấy thăng hoa'][step - 1];
  return {
    time, key: 'sth.' + step, role: step === 4 ? 'packer' : 'production', title: T,
    run: async (c) => {
      const O = (k: number) => c.I(k === 4 ? 'Q3-TP' : 'Q3-B' + k);
      let lots: any[], inputs: { lot_id: string; qty_g: number }[];
      if (step === 1) {
        lots = await all<any>(LOTS + ` AND l.stage='receive' AND i.code='SR-RI' AND l.area_code<>''` + ORD, c.t.id);
        const want = rk(u(c.r, 500, 650) * K), have = sum(lots, (l) => l.qty_g);
        if (have < 300 * K) return skip('Chưa đủ Ri6 cho một mẻ sấy (cần từ 300 kg).');
        inputs = take(lots, Math.min(want, have));
      } else {
        lots = await all<any>(LOTS + ` AND i.code=?2` + (step === 3 ? ` AND l.date<=?3` : ` AND ?3<>''`) + ORD, c.t.id, O(step - 1).code, step === 3 ? addD(c.day, -2) : c.day);
        if (!lots.length) return skip('Chưa có mẻ nào đến bước này.');
        inputs = full(lots);
      }
      const g = sum(inputs, (i) => i.qty_g);
      const rate = [u(c.r, 0.315, 0.33), u(c.r, 0.985, 0.995), u(c.r, 0.29, 0.31), 0.995][step - 1];
      let q = Math.round((g * rate) / 100) * 100, boxes = 0;
      if (step === 4) { boxes = Math.floor(q / 100); q = boxes * 100; }
      if (q <= 0) return skip('Sản lượng quá nhỏ.');
      const extra = [0, Math.round((g / K) * 7500), 6_000_000, boxes * 3500][step - 1];
      const w = await createWork(c.t, c.U[step === 4 ? 'packer' : 'production'], { step_id: c.S(PD, step), date: c.day, extra_cost: extra, note: step === 3 ? 'Mẻ sấy 36 giờ' : '', inputs, outputs: [{ item_id: O(step).id, qty_g: q, boxes }] });
      return ok(`${w.code}: vào ${kgs(g)}, ra ${step === 4 ? boxes + ' hộp' : kgs(q)}`);
    },
  };
}
function qc(time: string, hold: boolean): Act {
  return {
    time, key: hold ? 'qc.giu' : 'qc.tha', role: 'qc', title: hold ? 'Giữ lô sấy thăng hoa vừa đóng hộp, chờ kết quả kiểm vi sinh' : 'Bỏ giữ các lô đã có kết quả kiểm vi sinh đạt',
    run: async (c) => {
      const lots = hold ? await all<any>(LOTS + ` AND i.code='Q3-TP' AND l.date=?2`, c.t.id, c.day)
        : await all<any>(`SELECT l.id, l.code FROM lots l WHERE l.tenant_id=? AND l.status='hold' AND l.date<?`, c.t.id, c.day);
      if (!lots.length) return skip(hold ? 'Hôm nay không có lô mới.' : 'Không có lô nào đang giữ.');
      const st: [string, any[]][] = [], at = new Date(vnMs(c.day, time)).toISOString();
      for (const l of lots) {
        st.push([`UPDATE lots SET status=? WHERE id=? AND tenant_id=?`, [hold ? 'hold' : 'ok', l.id, c.t.id]]);
        st.push([`INSERT INTO audit(id,tenant_id,user_id,action,ref,detail,old,new,at) VALUES(?,?,?,?,?,?,?,?,?)`, [uid(), c.t.id, c.U.qc, hold ? 'lot.hold' : 'lot.ok', l.code, hold ? 'Chờ kết quả kiểm vi sinh mẻ sấy' : 'Kết quả kiểm vi sinh đạt', hold ? 'Dùng được' : 'Đang giữ', hold ? 'Đang giữ' : 'Dùng được', at]]);
      }
      await batch(st);
      return ok(`${hold ? 'Giữ' : 'Bỏ giữ'} lô ${lots.map((l) => l.code).join(', ')}`);
    },
  };
}

// Bán hàng
type OL = { lot_id: string; qty_g: number; boxes?: number; price: number };
/** Chọn thùng từ lô cũ nhất, tối đa cap thùng. */
function pickBoxes(lots: any[], cap: number, price: (l: any) => number): OL[] {
  const out: OL[] = [];
  for (const l of lots) { if (cap <= 0) break; const b = Math.min(Math.floor(l.qty_g / l.box_g), cap); if (b > 0) { out.push({ lot_id: l.id, qty_g: b * l.box_g, boxes: b, price: price(l) }); cap -= b; } }
  return out;
}
const sale = (time: string, key: string, title: string, run: Act['run']): Act => ({ time, key, role: 'sales', title, run });
/** Chọn thùng từ lô cũ nhất cho đến khi đủ số gam của chuyến. */
function pickWeight(lots: any[], target: number, price: (l: any) => number): OL[] {
  const out: OL[] = [];
  for (const l of lots) { const b = Math.min(Math.floor(l.qty_g / l.box_g), Math.floor(target / l.box_g)); if (b > 0) { out.push({ lot_id: l.id, qty_g: b * l.box_g, boxes: b, price: price(l) }); target -= b * l.box_g; } }
  return out;
}
// Một container trái tươi chở khoảng 18 tấn, dao động 10% (16,2 đến 19,8 tấn)
const orderFresh = (time: string) => sale(time, 'dh.tuoi', 'Lập đơn xuất khẩu trái tươi khi đủ hàng cho một container khoảng 18 tấn', async (c) => {
  const lots = await all<any>(LOTS + ` AND i.code IN ('MT-A','MT-B') AND l.area_code<>''` + FREE + ORD, c.t.id);
  const have = sum(lots, (l) => Math.floor(l.qty_g / l.box_g) * l.box_g);
  if (have < 16200 * K) return skip(`Mới có ${kgs(have)} loại A và B, chưa đủ 16,2 tấn cho một container.`);
  const L = pickWeight(lots, Math.round(u(c.r, 16200, 19800)) * K, (l) => (l.icode === 'MT-A' ? c.pr.A : c.pr.B)), cu = CUS[dayN(c.day) % 2 ? 'hk' : 'bt'];
  const o = await createOrder(c.t, c.U.sales, { date: c.day, customer_id: c.P(cu.name).id, note: 'Đã gửi mẫu kiểm nghiệm, chờ kết quả', lines: L,
    costs: [{ kind: 'deduct', name: 'Bốc xếp', amount: 3_000_000 }, { kind: 'trip', name: 'Cước container lạnh ra cửa khẩu', amount: 38_000_000 }, { kind: 'trip', name: 'Phí kiểm nghiệm, kiểm dịch', amount: 6_500_000 }] });
  return ok(`${o.code}: ${sum(L, (l) => l.boxes!)} thùng, ${kgs(sum(L, (l) => l.qty_g))}, cho ${cu.name}`);
});
const orderC = (time: string) => sale(time, 'dh.c', 'Bán Monthong loại C cho chợ đầu mối', async (c) => {
  const lots = await all<any>(LOTS + ` AND i.code='MT-C'` + FREE + ORD, c.t.id);
  const L = pickBoxes(lots, 9999, () => c.pr.C), n = sum(L, (l) => l.boxes!);
  if (n < 40) return skip(`Mới có ${n} thùng loại C, gom thêm.`);
  const o = await createOrder(c.t, c.U.sales, { date: c.day, customer_id: c.P(CUS.td.name).id, vehicle: '51C-906.21', lines: L, costs: [{ kind: 'trip', name: 'Cước xe đi TP. Hồ Chí Minh', amount: 2_500_000 }] });
  return ok(`${o.code}: ${n} thùng loại C`);
});
const orderBy = (time: string) => sale(time, 'dh.pp', 'Bán trái dạt, múi dạt cho cơ sở kem bánh', async (c) => {
  const lots = await all<any>(LOTS + ` AND i.code IN ('TL','MUI-D')` + FREE + ORD, c.t.id);
  if (!lots.length) return skip('Không có phụ phẩm tồn.');
  const o = await createOrder(c.t, c.U.sales, { date: c.day, customer_id: c.P(CUS.uh.name).id, note: 'Khách tự đến lấy', lines: lots.map((l) => ({ lot_id: l.id, qty_g: l.qty_g, price: l.iprice })) });
  return ok(`${o.code}: ${kgs(sum(lots, (l) => l.qty_g))} phụ phẩm`);
});
// Một container lạnh 40 feet múi cấp đông: khoảng 25 tấn, dao động 4% (giả định)
const orderFzX = (time: string) => sale(time, 'dh.dong.xk', 'Lập đơn xuất khẩu múi cấp đông khi đủ một container 40 feet khoảng 25 tấn', async (c) => {
  const lots = await all<any>(LOTS + ` AND i.code='TP-MD' AND l.area_code<>''` + FREE + ORD, c.t.id);
  const n = sum(lots, (l) => Math.floor(l.qty_g / l.box_g)), want = Math.round(u(c.r, 2400, 2600));
  if (n < want) return skip(`Mới có ${n} thùng múi đông có mã vùng trồng, chuyến này cần ${want} thùng.`);
  const L = pickBoxes(lots, want, () => c.pr.fzx);
  const o = await createOrder(c.t, c.U.sales, { date: c.day, customer_id: c.P(CUS.qc.name).id, note: 'Container lạnh 40 feet, giữ âm 18 độ, đã gửi mẫu kiểm nghiệm', lines: L,
    costs: [{ kind: 'trip', name: 'Cước container lạnh 40 feet ra cảng', amount: 55_000_000 }, { kind: 'trip', name: 'Phí kiểm nghiệm, kiểm dịch', amount: 6_500_000 }] });
  return ok(`${o.code}: ${want} thùng, ${kgs(want * 10000)}`);
});
const orderFzD = (time: string) => sale(time, 'dh.dong.nd', 'Bán múi cấp đông hàng nội địa cho chuỗi cửa hàng', async (c) => {
  const lots = await all<any>(LOTS + ` AND i.code='TP-MD' AND l.area_code=''` + FREE + ORD, c.t.id);
  const L = pickBoxes(lots, Math.round(u(c.r, 10, 15)) * 10, () => c.pr.fzd), n = sum(L, (l) => l.boxes!);
  if (n < 20) return skip(`Mới có ${n} thùng, gom thêm.`);
  const o = await createOrder(c.t, c.U.sales, { date: c.day, customer_id: c.P(CUS.vx.name).id, vehicle: '51H-907.43', lines: L, costs: [{ kind: 'trip', name: 'Cước xe lạnh', amount: 3_200_000 }] });
  return ok(`${o.code}: ${n} thùng, ${kgs(n * 10000)}`);
});
// Hàng sấy: chuỗi cửa hàng lấy chẵn thùng 40 hộp, bán lẻ gom đơn online trong ngày
const orderFd = (time: string, chain: boolean) => sale(time, chain ? 'dh.sth.chuoi' : 'dh.sth.le', chain ? 'Bán sầu riêng sấy thăng hoa cho chuỗi cửa hàng, chẵn thùng 40 hộp' : 'Gom đơn bán lẻ sầu riêng sấy thăng hoa trong ngày', async (c) => {
  const lots = await all<any>(LOTS + ` AND i.code='Q3-TP'` + FREE + ORD, c.t.id);
  const have = sum(lots, (l) => Math.floor(l.qty_g / l.box_g));
  const want = chain ? Math.min(Math.round(u(c.r, 9, 12)), Math.floor(have / 40)) * 40 : Math.round(u(c.r, 15, 40));
  const L = pickBoxes(lots, want, () => (chain ? c.pr.fdc : c.pr.fdr)), n = sum(L, (l) => l.boxes || 0);
  if (n < 1) return skip(chain ? 'Chưa đủ một thùng 40 hộp dùng được (lô mới còn đang giữ chờ kiểm).' : 'Chưa có hộp nào dùng được (lô mới còn đang giữ chờ kiểm).');
  const o = await createOrder(c.t, c.U.sales, { date: c.day, customer_id: c.P(CUS[chain ? 'vx' : 'kl'].name).id, lines: L, costs: [{ kind: 'trip', name: chain ? 'Cước giao hàng' : 'Phí giao hàng, sàn online', amount: chain ? 600_000 : n * 6000 }] });
  return ok(chain ? `${o.code}: ${n / 40} thùng, ${n} hộp` : `${o.code}: ${n} hộp`);
});

const exportDocs = (time: string): Act => ({
  time, key: 'ct.xk', role: 'exportdoc', title: 'Nhập kết quả kiểm nghiệm, kiểm dịch, số container và seal cho đơn xuất khẩu đang chờ',
  run: async (c) => {
    const os = await all<any>(`SELECT id, code FROM orders WHERE tenant_id=? AND status='draft' AND type='export' AND lab_cd='wait' AND date<?`, c.t.id, c.day);
    if (!os.length) return skip('Không có đơn xuất khẩu nào chờ hồ sơ.');
    const st: [string, any[]][] = [], at = new Date(vnMs(c.day, time)).toISOString(), md = c.day.slice(2, 4) + c.day.slice(5, 7) + c.day.slice(8, 10);
    for (const o of os) {
      const n = o.code.slice(-4);
      st.push([`UPDATE orders SET lab_cd='ok', lab_o='ok', lab_ref=?, phyto=?, container=?, seal=?, vehicle=? WHERE id=? AND tenant_id=?`, [`KN-${md}-${n}`, `KDTV-9${md.slice(2)}${n.slice(-2)}`, `SRNU 90${n}-${(+n * 7) % 10}`, `S90${n}`, '63H-908.' + n.slice(-2), o.id, c.t.id]]);
      st.push([`INSERT INTO audit(id,tenant_id,user_id,action,ref,detail,old,new,at) VALUES(?,?,?,?,?,?,?,?,?)`, [uid(), c.t.id, c.U.exportdoc, 'order.docs', o.code, 'Kết quả Cadimi và vàng O đạt, đã có kiểm dịch, container, seal', 'Chờ kết quả', 'Đạt', at]]);
    }
    await batch(st);
    return ok(`Đủ hồ sơ cho ${os.map((o) => o.code).join(', ')}`);
  },
});
function ship(time: string, exp: boolean): Act {
  return {
    time, key: exp ? 'xuat.xk' : 'xuat.nd', role: 'warehouse', title: exp ? 'Xuất kho container xuất khẩu đã đủ hồ sơ' : 'Xuất kho các đơn nội địa trong ngày',
    run: async (c) => {
      const os = await all<any>(`SELECT id, code FROM orders WHERE tenant_id=? AND status='draft' AND ${exp ? `type='export' AND lab_cd='ok' AND lab_o='ok'` : `type<>'export'`} ORDER BY created_at`, c.t.id);
      if (!os.length) return skip('Không có đơn nào chờ xuất.');
      const done: string[] = [];
      for (const o of os) { if (!c.room(8)) return more('Còn đơn chờ xuất'); await shipOrder(c.t, c.U.warehouse, o.id); done.push(o.code); }
      return ok(`Đã xuất ${done.join(', ')}`);
    },
  };
}

const paySup = (time: string): Act => ({
  time, key: 'chi', role: 'accountant', title: 'Chuyển khoản trả tiền mua hàng đến hạn cho nhà cung cấp',
  run: async (c) => {
    const tk = await all<any>(`SELECT w.id, w.code, w.date, w.source, w.total_amount-w.paid due FROM weigh_tickets w WHERE w.tenant_id=? AND w.void_at IS NULL AND w.source<>'own' AND w.total_amount>w.paid AND w.date<=? ORDER BY w.date, w.code`, c.t.id, c.day);
    const todo = tk.filter((w) => w.source === 'unlinked' || w.date <= addD(c.day, -2));
    if (!todo.length) return skip('Không có phiếu nào đến hạn trả.');
    for (const w of todo) { if (!c.room(3)) return more('Còn phiếu chờ trả'); await addPayment(c.t, c.U.accountant, { ref_type: 'ticket', ref_id: w.id, date: c.day, method: 'bank', amount: w.due, note: w.source === 'unlinked' ? 'Trả trong ngày cho nhà vườn' : 'Trả sau 2 ngày theo thỏa thuận' }); }
    return ok(`Trả ${todo.length} phiếu, ${dg(sum(todo, (w) => w.due))}`);
  },
});
const collect = (time: string): Act => ({
  time, key: 'thu', role: 'accountant', title: 'Ghi tiền khách trả theo sao kê ngân hàng và quỹ',
  run: async (c) => {
    const os = await all<any>(`SELECT o.id, o.code, o.date, o.type, o.revenue-o.deduct-o.paid due, p.name FROM orders o JOIN partners p ON p.id=o.customer_id WHERE o.tenant_id=? AND o.status='shipped' AND o.revenue-o.deduct-o.paid>0 ORDER BY o.date, o.code`, c.t.id);
    const term = (name: string) => Object.values(CUS).find((x) => x.name === name)?.due ?? 0;
    const todo = os.filter((o) => addD(o.date, term(o.name)) <= c.day);
    if (!todo.length) return skip('Chưa có khoản nào đến hạn thu.');
    for (const o of todo) {
      if (!c.room(3)) return more('Còn khoản chờ ghi thu');
      await addPayment(c.t, c.U.accountant, { ref_type: 'order', ref_id: o.id, date: c.day, method: o.type === 'retail' || o.due < 20_000_000 ? 'cash' : 'bank', amount: o.due, note: o.type === 'export' ? 'Bán ngoại tệ, ngân hàng báo có' : '' });
    }
    return ok(`Thu ${todo.length} đơn, ${dg(sum(todo, (o) => o.due))}`);
  },
});
const fixDocs = (time: string): Act => ({
  time, key: 'ct.mua', role: 'accountant', title: 'Bổ sung hóa đơn, bảng kê thu mua còn thiếu của các phiếu cân hôm trước',
  run: async (c) => {
    const tk = await all<any>(`SELECT id, code, source FROM weigh_tickets WHERE tenant_id=? AND void_at IS NULL AND date<? AND ((source='trader' AND doc_invoice=0) OR (source IN ('linked','unlinked') AND doc_list=0))`, c.t.id, c.day);
    if (!tk.length) return skip('Các phiếu đã đủ chứng từ.');
    const st: [string, any[]][] = [], at = new Date(vnMs(c.day, time)).toISOString();
    for (const w of tk) {
      st.push([w.source === 'trader' ? `UPDATE weigh_tickets SET doc_invoice=1 WHERE id=? AND tenant_id=?` : `UPDATE weigh_tickets SET doc_list=1 WHERE id=? AND tenant_id=?`, [w.id, c.t.id]]);
      st.push([`INSERT INTO audit(id,tenant_id,user_id,action,ref,detail,old,new,at) VALUES(?,?,?,?,?,?,?,?,?)`, [uid(), c.t.id, c.U.accountant, 'ticket.docs', w.code, '', 'Thiếu ' + (w.source === 'trader' ? 'hóa đơn' : 'bảng kê thu mua'), 'Đã đủ', at]]);
    }
    await batch(st);
    return ok(`Bổ sung chứng từ cho ${tk.map((w) => w.code).join(', ')}`);
  },
});

function count(time: string, scrap: boolean): Act {
  return {
    time, key: scrap ? 'kk.huy' : 'kk', role: 'warehouse', title: scrap ? 'Hủy một thùng múi đông rách bao bì, lập phiếu hủy hàng' : 'Kiểm kê kho lạnh cuối tuần, ghi chênh lệch so với sổ',
    run: async (c) => {
      const lots = await all<any>(LOTS + ` AND i.code=?2` + FREE + ` ORDER BY l.qty_g DESC LIMIT 2`, c.t.id, scrap ? 'TP-MD' : 'MD');
      const lines = (scrap ? lots.slice(0, 1).filter((l) => l.qty_g >= 20000).map((l) => ({ lot_id: l.id, actual_g: l.qty_g - 10000 }))
        : lots.map((l) => ({ lot_id: l.id, actual_g: l.qty_g - Math.round((l.qty_g * u(c.r, 0.001, 0.003)) / 100) * 100 }))).filter((x, i) => x.actual_g !== lots[i].qty_g);
      if (!lines.length) return skip('Số thực tế khớp với sổ.');
      const a = await createAdjust(c.t, c.U.warehouse, { date: c.day, kind: scrap ? 'scrap' : 'count', reason: scrap ? 'Một thùng rách bao bì khi xếp kho lạnh, hủy' : 'Kiểm kê cuối tuần: cân lại múi đông thấp hơn sổ, hao hụt bảo quản', lines });
      return ok(`${a.code}: ${lines.length} lô lệch`);
    },
  };
}
const recon = (time: string): Act => ({
  time, key: 'doisoat', role: 'manager', title: 'Chạy đối soát số liệu cuối ngày',
  run: async (c) => {
    const ch = await reconcile(c.t.id), bad = ch.filter((x) => x.bad.length);
    if (bad.length) throw new Error(`Lệch ở: ${bad.map((b) => `${b.name} (${b.bad[0].ref}: ${b.bad[0].msg})`).join('; ')}`);
    return ok(`${ch.length}/${ch.length} phép kiểm khớp`);
  },
});
const lock = (time: string, to: string): Act => ({
  time, key: 'khoaso', role: 'owner', title: `Khóa sổ đến hết ngày ${to.slice(8, 10)}/${to.slice(5, 7)}/${to.slice(0, 4)}`,
  run: async (c) => {
    const open = await one<any>(`SELECT COUNT(*) n FROM orders WHERE tenant_id=? AND status='draft' AND date<=?`, c.t.id, to);
    if (open?.n) return skip(`Còn ${open.n} đơn của tháng trước chưa xuất, chưa khóa sổ.`);
    await batch([[`UPDATE tenants SET lock_date=? WHERE id=?`, [to, c.t.id]],
      [`INSERT INTO audit(id,tenant_id,user_id,action,ref,detail,old,new,at) VALUES(?,?,?,?,?,?,?,?,?)`, [uid(), c.t.id, c.U.owner, 'tenant.settings', 'Khóa sổ đến ngày', '', c.t.lock_date || 'trống', `${to.slice(8, 10)}/${to.slice(5, 7)}/${to.slice(0, 4)}`, new Date(vnMs(c.day, time)).toISOString()]]]);
    c.t.lock_date = to;
    return ok('Chứng từ của tháng trước không lập mới, không hủy được nữa');
  },
});
const wrap = (time: string): Act => ({
  time, key: 'tongket', role: 'owner', title: 'Tổng kết đợt vận hành thử',
  run: async (c) => {
    const s = await one<any>(`SELECT (SELECT COUNT(*) FROM weigh_tickets WHERE tenant_id=?1 AND void_at IS NULL) a, (SELECT COUNT(*) FROM works WHERE tenant_id=?1 AND void_at IS NULL) b, (SELECT COUNT(*) FROM orders WHERE tenant_id=?1 AND status='shipped') d`, c.t.id);
    return ok(`${s.a} phiếu cân, ${s.b} lệnh công đoạn, ${s.d} đơn đã xuất`);
  },
});

// ---------- Lịch làm việc của một ngày ----------
/** Việc của một ngày, xếp theo giờ Việt Nam. Chỉ phụ thuộc vào ngày, nên xem trước được lịch đến hết kịch bản. */
export function planDay(day: string): Act[] {
  const w = dow(day), r = rng('lich' + day), A: Act[] = [];
  const t = (n: number, a: number, b: number) => Math.round(u(r, a, b) * 10) * 100; // kg, làm tròn 100
  const j = (hm: string) => { const m = +hm.slice(0, 2) * 60 + +hm.slice(3) + Math.round(u(r, -4, 4)); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const light = w === 0 || day === '2027-01-01';
  A.push(exportDocs('08:40'), ship('10:40', true));
  if (!light) {
    A.push(priceUp('05:50'));
    A.push(ticket(j('06:25'), 'tt', [['SR-MT', t(0, 8, 9.5)]]));
    A.push(ticket(j('06:55'), 'hn', [['SR-MT', t(0, 4.5, 5.5)], ['SR-RI', t(0, 2, 3)]]));
    {
      const kg = t(0, 5.5, 7);
      if (w === 3) A.push(ticket('07:22', 'ml', [['SR-MT', kg * 10]], { key: 'can.nham', title: `Cân nhập xe ${SUP.ml.name}: gõ nhầm số cân, dư một chữ số` }), voidWrong('07:27', 'ml'));
      A.push(ticket(w === 3 ? '07:33' : j('07:30'), 'ml', [['SR-MT', kg]]));
    }
    A.push(ticket(j('08:05'), 'sd', [['SR-RI', t(0, 3.5, 4.5)]]));
    if (w !== 4) A.push(ticket(j('08:45'), 'bh', [['SR-XO', t(0, 1.0, 1.8)]]));
    if ([2, 4, 6].includes(w)) A.push(ticket(j('09:15'), 'ct', [['SR-MT', t(0, 2, 3)]]));
    if (w === 3 || w === 6) A.push(fd('08:00', 3), fd('08:50', 4), qc('09:10', true));
    A.push(qc('09:50', false));
    A.push(sortAct('09:40', 'MT'));
    if (w === 1 || w === 4) A.push(fd('10:00', 1));
    A.push(sortAct('10:10', 'RI'), sortAct('10:30', 'XO'), packFresh('11:00'));
    if (w === 1 || w === 4) A.push(fd('11:20', 2));
    A.push(peel('11:30', true), peel('11:45', false));
    A.push(orderFresh('13:00'), orderC('13:15'));
    if ([2, 4, 6].includes(w)) A.push(orderBy('13:30'));
    A.push(orderFzX('13:40'));
    if (w === 2 || w === 5) A.push(orderFzD('13:45'));
    if (w === 1 || w === 4) A.push(orderFd('13:50', true));
    if (w !== 1 && w !== 4) A.push(orderFd('13:50', false));
    A.push(freeze('14:30', true), freeze('14:45', false), packFrozen('15:00', true), packFrozen('15:20', false));
    A.push(ship('16:00', false), paySup('16:40'), collect('16:55'), fixDocs('17:05'));
    if (w === 6) A.push(count('17:15', false));
    if (w === 6 && Math.floor(dayN(day) / 7) % 2 === 1) A.push(count('17:22', true));
    if (day.slice(8) === '02') A.push(lock('08:10', addD(day.slice(0, 8) + '01', -1)));
  }
  A.push(recon('17:30'));
  if (day === SIM.until) A.push(wrap('17:45'));
  return A.map((a, i) => ({ a, i })).sort((x, y) => (x.a.time < y.a.time ? -1 : x.a.time > y.a.time ? 1 : x.i - y.i)).map((x) => x.a);
}

// ---------- Bộ chạy ----------
/** Giờ thật (ms) của việc kế tiếp, tính từ vị trí đang chạy. */
function nextAt(day: string, idx: number): number {
  for (let i = 0; i < 4 && day <= SIM.until; i++, day = addD(day, 1), idx = 0) { const p = planDay(day); if (idx < p.length) return vnMs(day, p[idx].time); }
  return vnMs(day, '06:00');
}
/**
 * Một lượt chạy: làm các việc đã đến giờ mà chưa làm, theo đúng thứ tự, mỗi việc ghi giờ theo lịch.
 * Giới hạn số câu lệnh mỗi lượt để nằm trong hạn mức của máy chủ; việc còn lại để lượt sau.
 */
export async function tick(realMs = Date.now(), maxQ = 40): Promise<{ ran: number; note: string; day?: string; idx?: number; q?: number; nextAt?: number }> {
  return simRun(async () => {
    const t = await one<any>(`SELECT * FROM tenants WHERE code=?`, SIM.code);
    if (!t) { await setup(); return { ran: 0, note: 'setup' }; }
    if (!t.sim_until || t.sim_day > t.sim_until) return { ran: 0, note: 'done' };
    const real = new Date(realMs).toISOString();
    { // Chưa có việc nào đến giờ thì dừng ngay, không ghi gì
      const vn = new Date(realMs + 7 * 3600e3).toISOString(), p0 = planDay(t.sim_day);
      if (t.sim_day > vn.slice(0, 10) || (t.sim_day === vn.slice(0, 10) && (t.sim_idx >= p0.length || p0[t.sim_idx].time > vn.slice(11, 16))))
        return { ran: 0, note: 'wait', q: simQ(), nextAt: nextAt(t.sim_day, t.sim_idx) };
    }
    const lease = await run(`UPDATE tenants SET sim_busy=? WHERE id=? AND sim_busy<?`, real, t.id, new Date(realMs - 120e3).toISOString());
    if (!lease?.meta?.changes) return { ran: 0, note: 'busy' };
    let day: string = t.sim_day, idx: number = t.sim_idx, ran = 0, note = 'wait';
    try {
      const vn = new Date(realMs + 7 * 3600e3).toISOString(), today = vn.slice(0, 10), hm = vn.slice(11, 16);
      const c = await loadCtx(t, maxQ);
      for (;;) {
        if (day > t.sim_until) { note = 'done'; break; }
        const plan = planDay(day);
        if (idx >= plan.length) {
          if (day >= today) break;
          day = addD(day, 1); idx = 0;
          await run(`UPDATE tenants SET sim_day=?, sim_idx=0 WHERE id=?`, day, t.id);
          continue;
        }
        const a = plan[idx];
        if (day > today || (day === today && a.time > hm)) break;
        if (ran && simQ() > 14) { note = 'more'; break; }
        simSet(vnMs(day, a.time)); c.day = day; c.r = rng(day + a.key + idx); c.pr = prices(day);
        let res: { st: string; msg: string };
        try { res = await a.run(c); } catch (e: any) { res = { st: 'error', msg: String(e?.message || e).slice(0, 500) }; }
        if (res.st === 'more') { note = 'more'; break; }
        await batch([[LOG, [uid(), t.id, day, idx, a.time, a.key, a.title, a.role, res.st, res.msg, real]], [`UPDATE tenants SET sim_day=?, sim_idx=? WHERE id=?`, [day, idx + 1, t.id]]]);
        idx++; ran++;
      }
    } finally {
      await run(`UPDATE tenants SET sim_busy='' WHERE id=?`, t.id);
    }
    return { ran, note, day, idx, q: simQ(), nextAt: nextAt(day, idx) };
  });
}
