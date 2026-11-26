// Điểm vào của máy chủ: trang web như cũ, thêm đồng hồ cho doanh nghiệp vận hành thử theo kịch bản.
import handler from '@astrojs/cloudflare/entrypoints/server';
import { DurableObject } from 'cloudflare:workers';
import { tick } from './lib/sim';

/** Tự hẹn giờ đến việc kế tiếp trong lịch; mỗi lần báo thức chạy một lượt rồi hẹn lại. */
export class SimClock extends DurableObject {
  async arm(): Promise<boolean> {
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + 1000);
    return true;
  }
  async alarm() {
    let wait = 60_000;
    try {
      const r = await tick();
      if (r.note === 'done') return;
      if (r.note === 'more' || r.note === 'setup') wait = 3000;
      else if (r.note === 'busy') wait = 30_000;
      else wait = Math.min(6 * 3600e3, Math.max(5000, (r.nextAt ?? Date.now() + 60_000) - Date.now() + 2000));
    } catch (e) { console.error('sim tick', e); }
    await this.ctx.storage.setAlarm(Date.now() + wait);
  }
}

export default { fetch: (handler as any).fetch };
