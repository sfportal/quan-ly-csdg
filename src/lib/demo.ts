// Nạp lại ba doanh nghiệp mẫu từ ảnh chụp dữ liệu.
import snap from '../data/demo.json';
import { DB, now, today } from './db';
import { hashPassword } from './auth';

const lit = (v: any) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

function inserts(table: string, rows: any[]): string[] {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const out: string[] = [];
  let cur: string[] = [], size = 0;
  const flush = () => { if (cur.length) out.push(`INSERT INTO ${table}(${cols.join(',')}) VALUES ${cur.join(',')}`); cur = []; size = 0; };
  for (const r of rows) {
    const v = `(${cols.map((c) => lit(r[c])).join(',')})`;
    if (size + v.length > 60000) flush();
    cur.push(v); size += v.length;
  }
  flush();
  return out;
}

export const demoInfo = () => ({
  tenants: (snap as any).tenants.map((t: any) => ({ id: t.id, name: t.name, lines: t.lines })),
  users: (snap as any).users as { id: string; email: string; name: string }[],
});

/** Dời mọi ngày chứng từ để ngày mới nhất của dữ liệu mẫu trùng với hôm nay. */
function shifted(src: any) {
  const s = JSON.parse(JSON.stringify(src));
  // Dời riêng từng doanh nghiệp để ngày phát sinh gần nhất của mỗi doanh nghiệp đều là hôm nay
  const max: Record<string, string> = {};
  for (const tb of ['weigh_tickets', 'works', 'orders', 'payments']) for (const r of s.tables[tb] || []) if (r.date > (max[r.tenant_id] || '')) max[r.tenant_id] = r.date;
  const T = Date.parse(today());
  for (const tb of Object.keys(s.tables)) for (const r of s.tables[tb]) {
    if (typeof r.date !== 'string' || !r.date || !max[r.tenant_id]) continue;
    const days = Math.round((T - Date.parse(max[r.tenant_id])) / 864e5);
    if (days) r.date = new Date(Date.parse(r.date.slice(0, 10)) + days * 864e5).toISOString().slice(0, 10);
  }
  return s;
}

export async function resetDemo(password: string) {
  const s = shifted(snap), db = DB();
  const uids = s.users.map((u: any) => u.id), uj = JSON.stringify(uids);
  // Xóa mọi doanh nghiệp mẫu đang có (kể cả bản cũ khác mã định danh) rồi nạp lại từ ảnh chụp
  const DEMO = `(SELECT id FROM tenants WHERE is_demo=1)`;
  const del = [...new Set([...Object.keys(s.tables), 'adjusts', 'adjust_lines', 'audit'])].map((tb) => db.prepare(`DELETE FROM ${tb} WHERE tenant_id IN ${DEMO}`));
  del.push(db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@mau.csdg')`));
  del.push(db.prepare(`DELETE FROM users WHERE email LIKE '%@mau.csdg' AND id NOT IN (SELECT value FROM json_each(?))`).bind(uj));
  del.push(db.prepare(`DELETE FROM tenants WHERE is_demo=1`));
  await db.batch(del);
  const hash = password ? await hashPassword(password) : null;
  const ins: any[] = [];
  for (const u of s.users)
    ins.push(db.prepare(`INSERT INTO users(id,email,name,pass_hash,created_at) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, status='active', failed_n=0, locked_until=NULL, pass_hash=COALESCE(excluded.pass_hash, users.pass_hash)`)
      .bind(u.id, u.email, u.name, hash, now()));
  for (const q of inserts('tenants', s.tenants)) ins.push(db.prepare(q));
  for (const tb of Object.keys(s.tables)) for (const q of inserts(tb, s.tables[tb])) ins.push(db.prepare(q));
  await db.batch(ins);
}
