// Chỉ dùng ở máy phát triển: tua nhanh kịch bản vận hành thử đến một thời điểm rồi đối soát.
import type { APIRoute } from 'astro';
export const GET: APIRoute = async ({ url }) => {
  if (!import.meta.env.DEV) return new Response('Not found', { status: 404 });
  const { tick, SIM } = await import('../lib/sim');
  const { all, one } = await import('../lib/db');
  const { reconcile } = await import('../lib/stock');
  const to = Date.parse(url.searchParams.get('to') || '2027-01-02T00:00:00+07:00');
  let n = 0, last: any, maxq = 0, ticks = 0; const mq = +(url.searchParams.get('q') || 1e9);
  for (let i = 0; i < 20000; i++) { last = await tick(to, mq); n += last.ran; ticks++; maxq = Math.max(maxq, last.q || 0); if (last.note === 'busy') { await new Promise((r) => setTimeout(r, 200)); continue; } if (last.note !== 'more' && last.note !== 'setup') break; }
  const t = await one<any>(`SELECT id, sim_day, sim_idx FROM tenants WHERE code=?`, SIM.code);
  const st = await all<any>(`SELECT status, COUNT(*) n FROM sim_log WHERE tenant_id=? GROUP BY status`, t.id);
  const err = await all<any>(`SELECT day, time, key, result FROM sim_log WHERE tenant_id=? AND status='error' ORDER BY day, idx LIMIT 40`, t.id);
  const rec = (await reconcile(t.id)).map((c) => ({ name: c.name, n: c.n, bad: c.bad.slice(0, 3) }));
  return new Response(JSON.stringify({ n, ticks, maxq, last, t, st, err, rec }, null, 1), { headers: { 'content-type': 'application/json' } });
};
