// Chỉ dùng ở máy phát triển: chạy kịch bản dữ liệu mẫu và trả về ảnh chụp để lưu thành src/data/demo.json.
import type { APIRoute } from 'astro';
export const GET: APIRoute = async () => {
  if (!import.meta.env.DEV) return new Response('Not found', { status: 404 });
  const { buildSnapshot } = await import('../lib/seed');
  return new Response(JSON.stringify(await buildSnapshot()), { headers: { 'content-type': 'application/json' } });
};
