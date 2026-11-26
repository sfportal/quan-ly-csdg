// Lên dây đồng hồ của doanh nghiệp vận hành thử và chạy bù một lượt. Chỉ làm các việc đã đến giờ, nên gọi nhiều lần cũng không sao.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { tick } from '../lib/sim';
export const POST: APIRoute = async ({ locals }) => {
  if (!(locals as App.Locals).user) return new Response('Unauthorized', { status: 401 });
  let armed = false;
  try { armed = await env.SIM.get(env.SIM.idFromName('main')).arm(); } catch (e) { console.error('sim arm', e); }
  return new Response(JSON.stringify({ armed, ...(await tick()) }), { headers: { 'content-type': 'application/json' } });
};
