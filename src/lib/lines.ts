import { WORK } from './domain';
/** Các công đoạn và nguồn đầu vào hợp lệ theo dòng sản phẩm của doanh nghiệp. */
export function workTypes(lines: string) {
  const fresh = lines !== 'frozen', frozen = lines !== 'fresh';
  const out: Record<string, { name: string; hint: string; from: string[] }> = {};
  out.sort = { ...WORK.sort };
  if (frozen) { out.peel = { ...WORK.peel }; out.freeze = { ...WORK.freeze }; }
  out.pack = { ...WORK.pack, from: [...(fresh ? ['sort'] : []), ...(frozen ? ['freeze'] : [])] };
  return out;
}
