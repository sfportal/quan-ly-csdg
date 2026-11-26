// Chạy bù một lượt cho doanh nghiệp vận hành thử (ngoài lượt tự động mỗi phút). Chỉ làm các việc đã đến giờ, nên gọi nhiều lần cũng không sao.
import type { APIRoute } from 'astro';
import { tick } from '../lib/sim';
export const POST: APIRoute = async ({ locals }) => {
  if (!(locals as App.Locals).user) return new Response('Unauthorized', { status: 401 });
  return new Response(JSON.stringify(await tick()), { headers: { 'content-type': 'application/json' } });
};
