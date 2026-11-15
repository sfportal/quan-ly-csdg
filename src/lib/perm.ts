// Quyền theo vai trò. Mỗi vai trò là một bộ quyền cố định; doanh nghiệp gán vai trò cho từng thành viên.
export const PERMS = {
  catalog: 'Danh mục (đối tác, mặt hàng)',
  weigh: 'Lập phiếu cân nhập',
  work: 'Lập lệnh công đoạn',
  order: 'Lập đơn, xuất hàng',
  lab: 'Cập nhật kết quả kiểm nghiệm, chứng từ xuất',
  pay: 'Ghi thu, chi',
  money: 'Xem giá, giá thành, lãi lỗ',
  report: 'Xem báo cáo',
  members: 'Quản lý thành viên, cài đặt',
} as const;
export type Perm = keyof typeof PERMS;

export const ROLES: Record<string, { name: string; perms: Perm[]; desc: string }> = {
  owner: { name: 'Chủ doanh nghiệp', desc: 'Toàn quyền, quản lý thành viên', perms: Object.keys(PERMS) as Perm[] },
  manager: { name: 'Quản lý cơ sở', desc: 'Toàn bộ nghiệp vụ, không quản lý thành viên', perms: ['catalog', 'weigh', 'work', 'order', 'lab', 'pay', 'money', 'report'] },
  purchaser: { name: 'Thu mua', desc: 'Nhà cung cấp, phiếu cân, xem giá mua', perms: ['catalog', 'weigh', 'money'] },
  weigher: { name: 'Trạm cân', desc: 'Chỉ lập phiếu cân, không thấy giá', perms: ['weigh'] },
  production: { name: 'Tổ trưởng sản xuất', desc: 'Phân loại, bóc múi, cấp đông', perms: ['work'] },
  packer: { name: 'Tổ đóng gói', desc: 'Lệnh đóng gói', perms: ['work'] },
  warehouse: { name: 'Thủ kho', desc: 'Lệnh công đoạn và xuất hàng', perms: ['work', 'order'] },
  qc: { name: 'Kiểm soát chất lượng', desc: 'Kết quả kiểm nghiệm, giữ lô', perms: ['lab', 'report'] },
  sales: { name: 'Bán hàng', desc: 'Khách hàng, đơn hàng, giá bán', perms: ['catalog', 'order', 'money'] },
  exportdoc: { name: 'Chứng từ xuất khẩu', desc: 'Container, kiểm dịch, kiểm nghiệm', perms: ['order', 'lab'] },
  accountant: { name: 'Kế toán', desc: 'Thu chi, giá thành, báo cáo', perms: ['pay', 'money', 'report'] },
  viewer: { name: 'Chỉ xem', desc: 'Xem số liệu, không sửa', perms: ['report'] },
};

export function can(role: string | null, perm: string): boolean {
  if (!role) return false;
  return !!ROLES[role]?.perms.includes(perm as Perm);
}
