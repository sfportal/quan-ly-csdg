// Quy trình sản xuất tự khai báo: chuỗi bước từ đầu vào đến thành phẩm, dùng chung cho mọi loại trái cây.
import { all, one, batch, uid, now } from './db';

export type Step = { id: string; process_id: string; seq: number; skey: string; name: string; prefix: string; norm: number; extra_label: string; hold_days: number; from: string; last: boolean; pname: string };
export type Proc = { id: string; name: string; in_item_id: string | null; note: string; active: number; steps: Step[] };

export class BadProc extends Error {}

export async function loadProcs(tenantId: string): Promise<Proc[]> {
  const rows = await all<any>(
    `SELECT p.id pid, p.name pname, p.in_item_id, p.note, p.active, s.* FROM processes p LEFT JOIN process_steps s ON s.process_id=p.id
     WHERE p.tenant_id=? ORDER BY p.sort, p.created_at, p.id, s.seq`, tenantId);
  const out: Proc[] = [];
  for (const r of rows) {
    let p = out.find((x) => x.id === r.pid);
    if (!p) out.push(p = { id: r.pid, name: r.pname, in_item_id: r.in_item_id, note: r.note, active: r.active, steps: [] });
    if (r.id) p.steps.push({ id: r.id, process_id: r.pid, seq: r.seq, skey: r.skey, name: r.name, prefix: r.prefix, norm: r.norm, extra_label: r.extra_label, hold_days: r.hold_days, from: '', last: false, pname: r.pname });
  }
  for (const p of out) p.steps.forEach((s, i) => { s.from = i ? p.steps[i - 1].skey : 'receive'; s.last = i === p.steps.length - 1; });
  return out;
}

/** Tên hiển thị của từng công đoạn (khóa ghi ở lots.stage). */
export function stageNames(procs: Proc[]): Record<string, string> {
  const m: Record<string, string> = { receive: 'Nhập' };
  for (const p of procs) for (const s of p.steps) if (!m[s.skey]) m[s.skey] = s.name;
  return m;
}
/** Thứ tự công đoạn: nhập = 0, bước càng về sau số càng lớn. */
export function stageRank(procs: Proc[]): Record<string, number> {
  const m: Record<string, number> = { receive: 0 };
  for (const p of procs) for (const s of p.steps) m[s.skey] = Math.max(m[s.skey] || 0, s.seq);
  return m;
}
export const finalKeys = (procs: Proc[]) => new Set(procs.flatMap((p) => p.steps.filter((s) => s.last).map((s) => s.skey)));
export const allSteps = (procs: Proc[], activeOnly = true) => procs.filter((p) => p.active || !activeOnly).flatMap((p) => p.steps);

/** Tìm bước theo id, hoặc theo khóa công đoạn (ưu tiên bước có đầu vào khớp công đoạn của lô). */
export function findStep(procs: Proc[], q: { step_id?: string; type?: string; fromStage?: string }): Step | null {
  const steps = allSteps(procs, false);
  if (q.step_id) return steps.find((s) => s.id === q.step_id) || null;
  const c = steps.filter((s) => s.skey === q.type);
  return c.find((s) => s.from === q.fromStage) || allSteps(procs).find((s) => s.skey === q.type) || c[0] || null;
}

const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
/** Tiền tố số lệnh từ tên bước: chữ cái đầu của các từ. */
export function prefixOf(name: string): string {
  const w = ascii(name).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  let p = w.length > 1 ? w.slice(0, 3).map((x) => x[0]).join('') : (w[0] || 'CD').slice(0, 2);
  if (['PC', 'DH', 'PL', 'BM', 'CD', 'DG'].includes(p)) p += (w[w.length - 1][1] || 'X');
  return p;
}
const LEGACY: Record<string, string> = { PL: 'work.sort', BM: 'work.peel', CD: 'work.freeze', DG: 'work.pack' };
export const counterOf = (s: Step) => (LEGACY[s.prefix] && ['sort', 'peel', 'freeze', 'pack'].includes(s.skey) ? LEGACY[s.prefix] : 'wp.' + s.prefix);

type StepDef = { skey?: string; name: string; prefix?: string; norm?: number; extra_label?: string; hold_days?: number };
/** Quy trình mặc định theo dòng sản phẩm khi tạo doanh nghiệp. */
export function defaultProcs(lines: string, normPeel = 320): { name: string; steps: StepDef[] }[] {
  const out = [];
  if (lines !== 'frozen') out.push({ name: 'Sầu riêng trái tươi đóng thùng', steps: [
    { skey: 'sort', name: 'Phân loại, xử lý', prefix: 'PL', hold_days: 2 }, { skey: 'pack', name: 'Đóng gói', prefix: 'DG', extra_label: 'Bao bì, vật tư', hold_days: 3 }] });
  if (lines !== 'fresh') out.push({ name: 'Sầu riêng bóc múi cấp đông', steps: [
    { skey: 'sort', name: 'Phân loại, xử lý', prefix: 'PL', hold_days: 2 }, { skey: 'peel', name: 'Bóc múi', prefix: 'BM', norm: normPeel, hold_days: 1 },
    { skey: 'freeze', name: 'Cấp đông', prefix: 'CD' }, { skey: 'pack', name: 'Đóng gói', prefix: 'DG', extra_label: 'Bao bì, vật tư' }] });
  return out;
}
export function procStatements(tenantId: string, defs: { name: string; steps: StepDef[] }[], startSort = 1): [string, any[]][] {
  const st: [string, any[]][] = [];
  defs.forEach((d, i) => {
    const pid = uid();
    st.push([`INSERT INTO processes(id,tenant_id,name,sort,created_at) VALUES(?,?,?,?,?)`, [pid, tenantId, d.name, startSort + i, now()]]);
    d.steps.forEach((s, k) => st.push([`INSERT INTO process_steps(id,tenant_id,process_id,seq,skey,name,prefix,norm,extra_label,hold_days) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [uid(), tenantId, pid, k + 1, s.skey || 'k' + uid().slice(-7).toLowerCase(), s.name, s.prefix || prefixOf(s.name), s.norm || 1000, s.extra_label || '', s.hold_days || 0]]));
  });
  return st;
}

/** Mẫu quy trình gợi ý. {T} là tên trái cây. */
export const TEMPLATES: Record<string, { name: string; title: string; steps: { name: string; out: string; norm: number; extra: string; hold: number }[]; box_g: number }> = {
  fresh: { name: 'Trái tươi đóng thùng', title: '{T} trái tươi đóng thùng', box_g: 18000, steps: [
    { name: 'Phân loại, xử lý', out: '{T} đạt sau phân loại', norm: 100, extra: '', hold: 2 },
    { name: 'Đóng thùng', out: '{T} trái tươi, thùng', norm: 100, extra: 'Bao bì, vật tư', hold: 3 }] },
  frozen: { name: 'Tách múi, cấp đông', title: '{T} cấp đông', box_g: 10000, steps: [
    { name: 'Tách múi', out: 'Múi {T} tươi', norm: 32, extra: '', hold: 1 },
    { name: 'Cấp đông', out: 'Múi {T} cấp đông', norm: 100, extra: '', hold: 0 },
    { name: 'Đóng thùng', out: '{T} cấp đông, thùng', norm: 100, extra: 'Bao bì, vật tư', hold: 0 }] },
  fd: { name: 'Sấy thăng hoa', title: '{T} sấy thăng hoa', box_g: 100, steps: [
    { name: 'Tách múi', out: 'Múi {T} tươi', norm: 32, extra: '', hold: 1 },
    { name: 'Phối trộn phụ gia', out: 'Múi {T} đã phối trộn', norm: 100, extra: 'Phụ gia', hold: 1 },
    { name: 'Sấy thăng hoa', out: '{T} sấy thăng hoa rời', norm: 30, extra: 'Điện, vận hành máy sấy', hold: 0 },
    { name: 'Đóng hộp', out: '{T} sấy thăng hoa, hộp', norm: 100, extra: 'Hộp, bao bì', hold: 0 }] },
  dry: { name: 'Sấy dẻo', title: '{T} sấy dẻo', box_g: 500, steps: [
    { name: 'Sơ chế, cắt lát', out: '{T} đã sơ chế', norm: 60, extra: '', hold: 1 },
    { name: 'Sấy dẻo', out: '{T} sấy dẻo rời', norm: 20, extra: 'Điện, vận hành máy sấy', hold: 0 },
    { name: 'Đóng túi', out: '{T} sấy dẻo, túi', norm: 100, extra: 'Túi, bao bì', hold: 0 }] },
  blank: { name: 'Tự khai báo', title: '', box_g: 0, steps: [{ name: '', out: '', norm: 100, extra: '', hold: 0 }] },
};

/** Tạo quy trình mới kèm các mặt hàng đầu ra của từng bước. */
export async function createProcess(t: any, d: {
  name: string; note?: string; in_item_id?: string; new_raw?: { name: string; price: number };
  steps: { name: string; out: string; norm: number; extra_label?: string; hold_days?: number }[]; box_g?: number; price?: number;
}) {
  const name = d.name.trim();
  const steps = d.steps.filter((s) => s.name.trim());
  if (!name) throw new BadProc('Chưa nhập tên quy trình.');
  if (!steps.length) throw new BadProc('Quy trình cần ít nhất một bước.');
  if (await one(`SELECT 1 FROM processes WHERE tenant_id=? AND name=?`, t.id, name)) throw new BadProc('Đã có quy trình trùng tên.');
  const n = ((await one<any>(`SELECT COUNT(*) n FROM processes WHERE tenant_id=?`, t.id))?.n || 0) + 1;
  const pid = uid(), st: [string, any[]][] = [];
  let inItem: string | null = d.in_item_id || null;
  if (!inItem && d.new_raw?.name.trim()) {
    inItem = uid();
    st.push([`INSERT INTO items(id,tenant_id,code,name,kind,stage,box_g,price,sort) VALUES(?,?,?,?,?,?,?,?,?)`, [inItem, t.id, `Q${n}-NL`, d.new_raw.name.trim(), 'NL', 'receive', 0, d.new_raw.price || 0, 100 + n * 10]]);
  }
  if (inItem && d.in_item_id && !(await one(`SELECT 1 FROM items WHERE id=? AND tenant_id=?`, inItem, t.id))) throw new BadProc('Mặt hàng đầu vào không hợp lệ.');
  st.push([`INSERT INTO processes(id,tenant_id,name,in_item_id,note,sort,created_at) VALUES(?,?,?,?,?,?,?)`, [pid, t.id, name, inItem, d.note || '', n, now()]]);
  steps.forEach((s, k) => {
    const last = k === steps.length - 1, skey = 'k' + uid().slice(-7).toLowerCase();
    const norm = Math.max(1, Math.min(3000, Math.round(s.norm || 1000)));
    st.push([`INSERT INTO process_steps(id,tenant_id,process_id,seq,skey,name,prefix,norm,extra_label,hold_days) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [uid(), t.id, pid, k + 1, skey, s.name.trim(), prefixOf(s.name), norm, (s.extra_label || '').trim(), Math.max(0, s.hold_days || 0)]]);
    st.push([`INSERT INTO items(id,tenant_id,code,name,kind,stage,box_g,price,sort) VALUES(?,?,?,?,?,?,?,?,?)`,
      [uid(), t.id, `Q${n}-${last ? 'TP' : 'B' + (k + 1)}`, s.out.trim() || s.name.trim(), last ? 'TP' : 'BTP', skey, last ? d.box_g || 0 : 0, last ? d.price || 0 : 0, 100 + n * 10 + k + 1]]);
  });
  await batch(st);
  return pid;
}
