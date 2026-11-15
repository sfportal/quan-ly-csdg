import { all, one, run, uid, now } from './db';

const ITER = 100000;
const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(pw: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return new Uint8Array(bits);
}
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(await pbkdf2(pw, salt, ITER))}`;
}
export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [alg, iter, salt, hash] = stored.split('$');
  if (alg !== 'pbkdf2') return false;
  const a = await pbkdf2(pw, unb64(salt), Number(iter));
  const b = unb64(hash);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
async function sha256hex(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return [...h].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const COOKIE = 'sid';
const SESSION_DAYS = 14;

export async function createSession(userId: string, tenantId: string | null = null): Promise<string> {
  const tok = randomToken();
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await run('INSERT INTO sessions(id,user_id,tenant_id,expires_at,created_at) VALUES(?,?,?,?,?)',
    await sha256hex(tok), userId, tenantId, exp, now());
  return tok;
}
export async function loadSession(tok: string) {
  const id = await sha256hex(tok);
  const s = await one<any>(
    `SELECT s.id sid, s.tenant_id, s.expires_at, u.id, u.email, u.name, u.is_sysadmin, u.status
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, id);
  if (!s || s.expires_at < now() || s.status !== 'active') return null;
  return s;
}
export async function setSessionTenant(sid: string, tenantId: string | null) {
  await run('UPDATE sessions SET tenant_id=? WHERE id=?', tenantId, sid);
}
export async function destroySession(sid: string) {
  await run('DELETE FROM sessions WHERE id=?', sid);
}
export function cookieOpts(secure: boolean) {
  return { path: '/', httpOnly: true, secure, sameSite: 'lax' as const, maxAge: SESSION_DAYS * 86400 };
}

/** Tạo liên kết đặt mật khẩu dùng một lần. Trả về token thô để ghép vào đường dẫn. */
export async function createSetPwToken(userId: string, hours = 72): Promise<string> {
  const tok = randomToken();
  await run('INSERT INTO tokens(id,user_id,kind,expires_at) VALUES(?,?,?,?)',
    await sha256hex(tok), userId, 'setpw', new Date(Date.now() + hours * 3600e3).toISOString());
  return tok;
}
export async function findSetPwToken(tok: string) {
  const t = await one<any>(
    `SELECT t.id, t.user_id, u.email, u.name FROM tokens t JOIN users u ON u.id=t.user_id
     WHERE t.id=? AND t.kind='setpw' AND t.used_at IS NULL AND t.expires_at > ?`, await sha256hex(tok), now());
  return t;
}
export async function useSetPwToken(tokenId: string, userId: string, pw: string) {
  await run('UPDATE users SET pass_hash=?, failed_n=0, locked_until=NULL WHERE id=?', await hashPassword(pw), userId);
  await run('UPDATE tokens SET used_at=? WHERE id=?', now(), tokenId);
  await run('DELETE FROM sessions WHERE user_id=?', userId);
}

export async function login(email: string, pw: string): Promise<{ ok: true; user: any } | { ok: false; msg: string }> {
  const bad = { ok: false as const, msg: 'Email hoặc mật khẩu không đúng.' };
  const u = await one<any>('SELECT * FROM users WHERE email=?', email.trim().toLowerCase());
  if (!u) { await pbkdf2(pw, new Uint8Array(16), ITER); return bad; }
  if (u.locked_until && u.locked_until > now())
    return { ok: false, msg: 'Tài khoản tạm khóa 15 phút vì nhập sai nhiều lần.' };
  if (u.status !== 'active') return { ok: false, msg: 'Tài khoản đã bị khóa.' };
  if (!(await verifyPassword(pw, u.pass_hash))) {
    const n = u.failed_n + 1;
    await run('UPDATE users SET failed_n=?, locked_until=? WHERE id=?',
      n >= 5 ? 0 : n, n >= 5 ? new Date(Date.now() + 15 * 60e3).toISOString() : null, u.id);
    return bad;
  }
  if (u.failed_n) await run('UPDATE users SET failed_n=0, locked_until=NULL WHERE id=?', u.id);
  return { ok: true, user: u };
}

export async function ensureUser(email: string, name: string): Promise<{ id: string; isNew: boolean; hasPw: boolean }> {
  email = email.trim().toLowerCase();
  const u = await one<any>('SELECT id, pass_hash FROM users WHERE email=?', email);
  if (u) return { id: u.id, isNew: false, hasPw: !!u.pass_hash };
  const id = uid();
  await run('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)', id, email, name || email.split('@')[0], now());
  return { id, isNew: true, hasPw: false };
}

export async function userTenants(userId: string, isSysadmin: boolean) {
  if (isSysadmin)
    return all<any>(`SELECT t.*, 'owner' role FROM tenants t ORDER BY t.is_demo, t.name`);
  return all<any>(
    `SELECT t.*, m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id
     WHERE m.user_id=? AND m.status='active' AND t.status='active' ORDER BY t.name`, userId);
}
