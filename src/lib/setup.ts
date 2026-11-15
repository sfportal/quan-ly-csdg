// Tạo doanh nghiệp mới và danh mục mặc định theo dòng sản phẩm.
import { batch, one, run, uid, now, audit } from './db';
import { ensureUser, createSetPwToken } from './auth';
import { Bad } from './domain';
import { defaultProcs, procStatements } from './proc';

type It = [code: string, name: string, kind: string, stage: string, box_g: number, price: number];
const COMMON: It[] = [
  ['SR-MT', 'Sầu riêng Monthong nguyên trái', 'NL', 'receive', 0, 55000],
  ['SR-RI', 'Sầu riêng Ri6 nguyên trái', 'NL', 'receive', 0, 50000],
  ['SR-XO', 'Sầu riêng hàng xô', 'NL', 'receive', 0, 20000],
  ['TD', 'Trái đạt sau phân loại', 'BTP', 'sort', 0, 0],
  ['TL', 'Trái loại, hàng dạt', 'PP', 'sort', 0, 15000],
];
const FRESH: It[] = [
  ['MT-A', 'Monthong loại A, thùng 18 kg', 'TP', 'pack', 18000, 70000],
  ['MT-B', 'Monthong loại B, thùng 17 kg', 'TP', 'pack', 17000, 55000],
  ['MT-C', 'Monthong loại C, thùng 17 kg', 'TP', 'pack', 17000, 53000],
];
const FROZEN: It[] = [
  ['MUI', 'Múi tươi', 'BTP', 'peel', 0, 0],
  ['MUI-D', 'Múi dạt', 'PP', 'peel', 0, 60000],
  ['MD', 'Múi cấp đông', 'BTP', 'freeze', 0, 0],
  ['TP-MD', 'Múi cấp đông, thùng 10 kg', 'TP', 'pack', 10000, 245000],
];

export function defaultItems(lines: string): It[] {
  return [...COMMON, ...(lines !== 'frozen' ? FRESH : []), ...(lines !== 'fresh' ? FROZEN : [])];
}

export function slug(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
}

export async function createTenant(d: { name: string; lines: string; is_demo?: boolean; packing_code?: string; address?: string; norm_peel?: number; box_cost?: number; code?: string }) {
  if (!d.name.trim()) throw new Bad('Chưa nhập tên doanh nghiệp.');
  if (!['fresh', 'frozen', 'both'].includes(d.lines)) throw new Bad('Dòng sản phẩm không hợp lệ.');
  const id = uid();
  let code = d.code || slug(d.name) || 'dn';
  if (await one('SELECT 1 FROM tenants WHERE code=?', code)) code += '-' + id.slice(-4).toLowerCase();
  const st: [string, any[]][] = [[
    `INSERT INTO tenants(id,code,name,lines,is_demo,packing_code,address,norm_peel,box_cost,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [id, code, d.name.trim(), d.lines, d.is_demo ? 1 : 0, d.packing_code || '', d.address || '', d.norm_peel || 320, d.box_cost || 0, now()],
  ]];
  defaultItems(d.lines).forEach((it, i) =>
    st.push([`INSERT INTO items(id,tenant_id,code,name,kind,stage,box_g,price,sort) VALUES(?,?,?,?,?,?,?,?,?)`, [uid(), id, ...it, i]]));
  st.push(...procStatements(id, defaultProcs(d.lines, d.norm_peel || 320)));
  await batch(st);
  return id;
}

/** Thêm thành viên. Nếu người này chưa có mật khẩu thì trả về token để ghép liên kết đặt mật khẩu. */
export async function addMember(tenantId: string, email: string, name: string, role: string, by: string | null) {
  email = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Bad('Email không hợp lệ.');
  const u = await ensureUser(email, name);
  const m = await one<any>('SELECT id FROM memberships WHERE tenant_id=? AND user_id=?', tenantId, u.id);
  if (m) await run(`UPDATE memberships SET role=?, status='active' WHERE id=?`, role, m.id);
  else await run('INSERT INTO memberships(id,tenant_id,user_id,role,created_at) VALUES(?,?,?,?,?)', uid(), tenantId, u.id, role, now());
  await audit(tenantId, by, 'member.add', email, role);
  return { userId: u.id, token: u.hasPw ? null : await createSetPwToken(u.id) };
}
