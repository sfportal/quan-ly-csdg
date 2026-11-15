const nf0 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

/** gam -> chuỗi kg */
export const kg = (g: number | null | undefined) => nf1.format((g || 0) / 1000);
export const tan = (g: number) => nf2.format((g || 0) / 1e6);
export const dong = (d: number | null | undefined) => nf0.format(Math.round(d || 0));
export const minus = (d: number | null | undefined) => (Math.round(d || 0) ? '−' + dong(d) : '0');
export const pct = (a: number, b: number, digits = 1) =>
  b ? (a / b * 100).toFixed(digits).replace('.', ',') + '%' : '—';
/** đơn giá đ/kg từ tổng tiền và gam */
export const perKg = (cost: number, g: number) => (g > 0 ? Math.round(cost * 1000 / g) : 0);
export const dmy = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
/** Đọc số người dùng gõ: chấp nhận 1.234,5 hoặc 1234.5 */
export function num(v: any): number {
  if (v == null) return 0;
  let s = String(v).trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
export const toG = (v: any) => Math.round(num(v) * 1000);
export const toD = (v: any) => Math.round(num(v));

export const SOURCE: Record<string, string> = {
  trader: 'Thương lái, vựa', linked: 'Vườn liên kết', unlinked: 'Vườn không liên kết', own: 'Vườn công ty',
};
export const CUST: Record<string, string> = { retail: 'Đơn lẻ trong nước', wholesale: 'Đơn sỉ trong nước', export: 'Xuất khẩu' };
export const KIND: Record<string, string> = { NL: 'Nguyên liệu', BTP: 'Bán thành phẩm', TP: 'Thành phẩm', PP: 'Phụ phẩm' };
export const STAGE: Record<string, string> = {
  receive: 'Nhập', sort: 'Phân loại, xử lý', peel: 'Bóc múi', freeze: 'Cấp đông', pack: 'Đóng gói',
};
export const LINES: Record<string, string> = { fresh: 'Trái tươi', frozen: 'Bóc múi, cấp đông', both: 'Trái tươi và cấp đông' };
export const LAB: Record<string, string> = { na: 'Không yêu cầu', wait: 'Đang chờ', ok: 'Đạt', fail: 'Không đạt' };
export const PAY: Record<string, string> = { bank: 'Chuyển khoản', cash: 'Tiền mặt', internal: 'Nội bộ' };
