import { env } from 'cloudflare:workers';
import { AsyncLocalStorage } from 'node:async_hooks';

/** Đồng hồ kịch bản: trong một lượt chạy mô phỏng, giờ hệ thống là giờ đã lên lịch của việc đang làm; q đếm số câu lệnh đã gửi. */
type Sim = { ms: number; q: number };
const als = new AsyncLocalStorage<Sim>();
export const simRun = <T>(fn: () => Promise<T>) => als.run({ ms: Date.now(), q: 0 }, fn);
export const simSet = (ms: number) => { const s = als.getStore(); if (s) s.ms = ms; };
export const simQ = () => als.getStore()?.q || 0;
const tic = () => { const s = als.getStore(); if (s) s.q++; };
const ms = () => als.getStore()?.ms ?? Date.now();

export const DB = () => env.DB as any;

export async function all<T = any>(sql: string, ...p: any[]): Promise<T[]> {
  tic();
  const r = await DB().prepare(sql).bind(...p).all();
  return (r.results || []) as T[];
}
export async function one<T = any>(sql: string, ...p: any[]): Promise<T | null> {
  tic();
  return ((await DB().prepare(sql).bind(...p).first()) as T) || null;
}
export async function run(sql: string, ...p: any[]) {
  tic();
  return DB().prepare(sql).bind(...p).run();
}
/** Chạy nhiều câu lệnh trong một giao dịch. */
export async function batch(stmts: [string, any[]][]) {
  if (!stmts.length) return;
  tic();
  const d = DB();
  return d.batch(stmts.map(([s, p]) => d.prepare(s).bind(...p)));
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Mã định danh kiểu ULID: sắp xếp được theo thời gian. */
export function uid(): string {
  let t = ms(), s = '';
  for (let i = 0; i < 10; i++) { s = B32[t % 32] + s; t = Math.floor(t / 32); }
  const r = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 16; i++) s += B32[r[i] % 32];
  return s;
}
export const now = () => new Date(ms()).toISOString();
export const today = () => new Date(ms() + 7 * 3600e3).toISOString().slice(0, 10);

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
