// Quyền theo vai trò. Mỗi vai trò là một bộ quyền cố định; doanh nghiệp gán vai trò cho từng thành viên.
export const PERMS = {
  catalog: 'Danh mục (đối tác, mặt hàng)',
  proc: 'Khai báo, sửa quy trình sản xuất',
  weigh: 'Lập phiếu cân nhập',
  work: 'Lập lệnh công đoạn',
  order: 'Lập đơn, xuất hàng',
  lab: 'Cập nhật kết quả kiểm nghiệm, chứng từ xuất',
  stock: 'Kiểm kê, điều chỉnh, hủy hàng trong kho',
  void: 'Hủy chứng từ đã lưu của người khác',
  pay: 'Ghi thu, chi',
  money: 'Xem giá, giá thành, lãi lỗ',
  report: 'Xem báo cáo',
  members: 'Quản lý thành viên, cài đặt',
} as const;
export type Perm = keyof typeof PERMS;

export const ROLES: Record<string, { name: string; perms: Perm[]; desc: string; lastOnly?: boolean }> = {
  owner: { name: 'Chủ doanh nghiệp', desc: 'Toàn quyền, quản lý thành viên', perms: Object.keys(PERMS) as Perm[] },
  manager: { name: 'Quản lý cơ sở', desc: 'Toàn bộ nghiệp vụ, không quản lý thành viên', perms: ['catalog', 'proc', 'weigh', 'work', 'order', 'lab', 'stock', 'void', 'pay', 'money', 'report'] },
  purchaser: { name: 'Thu mua', desc: 'Nhà cung cấp, phiếu cân, giá mua; không thấy lãi lỗ', perms: ['catalog', 'weigh', 'money'] },
  weigher: { name: 'Trạm cân', desc: 'Chỉ lập phiếu cân, không thấy giá', perms: ['weigh'] },
  production: { name: 'Tổ trưởng sản xuất', desc: 'Lập lệnh cho mọi bước của quy trình', perms: ['work'] },
  packer: { name: 'Tổ đóng gói', desc: 'Chỉ lập lệnh ở bước cuối (đóng gói) của quy trình', perms: ['work'], lastOnly: true },
  warehouse: { name: 'Thủ kho', desc: 'Lệnh công đoạn, xuất hàng, kiểm kê kho', perms: ['work', 'order', 'stock'] },
  qc: { name: 'Kiểm soát chất lượng', desc: 'Kết quả kiểm nghiệm, giữ lô', perms: ['lab', 'report'] },
  sales: { name: 'Bán hàng', desc: 'Khách hàng, đơn hàng, giá bán; không thấy giá vốn, lãi lỗ', perms: ['catalog', 'order', 'money'] },
  exportdoc: { name: 'Chứng từ xuất khẩu', desc: 'Container, kiểm dịch, kiểm nghiệm; không lập đơn', perms: ['lab'] },
  accountant: { name: 'Kế toán', desc: 'Thu chi, giá thành, báo cáo', perms: ['pay', 'money', 'report'] },
  viewer: { name: 'Chỉ xem', desc: 'Xem số liệu, không sửa', perms: ['report'] },
};

/**
 * Quyền ghép, dùng chung cho thực đơn và trang:
 * fin = thấy giá vốn, giá thành, lãi lỗ, công nợ (phải vừa xem giá vừa xem báo cáo);
 * v.can / v.cd / v.dh = được mở trang phiếu cân / lệnh công đoạn / đơn hàng.
 */
const VIEW: Record<string, Perm[][]> = {
  fin: [['money'], ['report']],
  'v.can': [['weigh', 'report', 'pay']],
  'v.cd': [['work', 'report']],
  'v.dh': [['order', 'lab', 'pay', 'report']],
};
/** Vai trò chỉ được lập lệnh ở bước cuối của quy trình (tổ đóng gói). */
export const lastOnly = (role: string | null) => !!(role && ROLES[role]?.lastOnly);

export function can(role: string | null, perm: string): boolean {
  if (!role) return false;
  const v = VIEW[perm];
  if (v) return v.every((any) => any.some((p) => can(role, p)));
  return !!ROLES[role]?.perms.includes(perm as Perm);
}
