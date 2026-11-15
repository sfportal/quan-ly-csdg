import { defineMiddleware } from 'astro:middleware';
import { COOKIE, loadSession } from './lib/auth';
import { one } from './lib/db';
import { can } from './lib/perm';
import { loadProcs, stageNames } from './lib/proc';

export const onRequest = defineMiddleware(async (ctx, next) => {
  const L = ctx.locals as App.Locals;
  L.user = null; L.tenant = null; L.role = null; L.sid = null; L.procs = []; L.SN = { receive: 'Nhập' };
  L.can = (p) => can(L.role, p);
  const path = ctx.url.pathname;
  const tok = ctx.cookies.get(COOKIE)?.value;
  if (tok) {
    const s = await loadSession(tok);
    if (s) {
      L.user = { id: s.id, email: s.email, name: s.name, is_sysadmin: s.is_sysadmin };
      L.sid = s.sid;
      if (s.tenant_id && (path.startsWith('/app') || path === '/chon')) {
        const t = await one<any>('SELECT * FROM tenants WHERE id=?', s.tenant_id);
        if (t) {
          if (s.is_sysadmin) { L.tenant = t; L.role = 'owner'; }
          else if (t.status === 'active') {
            const m = await one<any>(`SELECT role FROM memberships WHERE tenant_id=? AND user_id=? AND status='active'`, t.id, s.id);
            if (m) { L.tenant = t; L.role = m.role; }
          }
        }
      }
    }
  }
  const needLogin = path.startsWith('/app') || path.startsWith('/admin') || path === '/chon';
  if (needLogin && !L.user) return ctx.redirect('/dang-nhap');
  if (path.startsWith('/admin') && !L.user?.is_sysadmin) return ctx.redirect('/chon');
  if (path.startsWith('/app') && !L.tenant) return ctx.redirect('/chon');
  if (path.startsWith('/app') && L.tenant) { L.procs = await loadProcs(L.tenant.id); L.SN = stageNames(L.procs); }

  const res = await next();
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'same-origin');
  if (needLogin) res.headers.set('Cache-Control', 'no-store');
  return res;
});
