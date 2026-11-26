import { env } from 'cloudflare:workers';

export const DB = () => env.DB as any;

export async function all<T = any>(sql: string, ...p: any[]): Promise<T[]> {
  const r = await DB().prepare(sql).bind(...p).all();
  return (r.results || []) as T[];
}
export async function one<T = any>(sql: string, ...p: any[]): Promise<T | null> {
  return ((await DB().prepare(sql).bind(...p).first()) as T) || null;
}
export async function run(sql: string, ...p: any[]) {
  return DB().prepare(sql).bind(...p).run();
}
/** Chạy nhiều câu lệnh trong một giao dịch. */
export async function batch(stmts: [string, any[]][]) {
  if (!stmts.length) return;
  const d = DB();
  return d.batch(stmts.map(([s, p]) => d.prepare(s).bind(...p)));
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Mã định danh kiểu ULID: sắp xếp được theo thời gian. */
export function uid(): string {
  let t = Date.now(), s = '';
  for (let i = 0; i < 10; i++) { s = B32[t % 32] + s; t = Math.floor(t / 32); }
  const r = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 16; i++) s += B32[r[i] % 32];
  return s;
}
export const now = () => new Date().toISOString();
export const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

export async function nextCode(tenantId: string, key: string, prefix: string): Promise<string> {
  const r = await one<{ n: number }>(
    `INSERT INTO counters(tenant_id,key,n) VALUES(?,?,1)
     ON CONFLICT(tenant_id,key) DO UPDATE SET n=n+1 RETURNING n`, tenantId, key);
  return `${prefix}-${String(r!.n).padStart(4, '0')}`;
}

/** Nhật ký: detail là lý do hoặc ghi chú, old và new là giá trị trước và sau khi đổi. */
export async function audit(tenantId: string | null, userId: string | null, action: string, ref = '', detail = '', old = '', nw = '') {
  await run('INSERT INTO audit(id,tenant_id,user_id,action,ref,detail,old,new,at) VALUES(?,?,?,?,?,?,?,?,?)',
    uid(), tenantId, userId, action, ref, detail, old, nw, now());
}
