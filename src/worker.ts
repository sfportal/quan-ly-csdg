// Điểm vào của máy chủ: trang web như cũ, thêm lượt chạy định kỳ cho doanh nghiệp vận hành thử theo kịch bản.
import handler from '@astrojs/cloudflare/entrypoints/server';
import { tick } from './lib/sim';

export default {
  fetch: (handler as any).fetch,
  async scheduled(_ev: unknown, _env: unknown, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    ctx.waitUntil(tick().catch((e) => console.error('sim tick', e)));
  },
};
