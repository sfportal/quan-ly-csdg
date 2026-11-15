# Quản lý cơ sở đóng gói nông sản

Hệ thống quản lý cơ sở đóng gói, trước mắt cho sầu riêng trái tươi và bóc múi cấp đông: thu mua, nhập, phân loại, chế biến theo lô mẻ, đóng gói, xuất hàng, truy xuất nguồn gốc, giá thành và hao hụt.

## Công nghệ

- Astro (chạy phía máy chủ) trên Cloudflare Workers
- Cơ sở dữ liệu Cloudflare D1 (một cơ sở dữ liệu, mọi bảng nghiệp vụ có `tenant_id`)
- Mật khẩu băm PBKDF2-SHA-256, phiên đăng nhập lưu trong D1, cookie HttpOnly

## Cấu trúc

| Đường dẫn | Nội dung |
| --- | --- |
| `migrations/` | Lược đồ D1 |
| `src/lib/domain.ts` | Nghiệp vụ lõi: phiếu cân, lệnh công đoạn, đơn hàng, cổng kiểm soát, truy xuất, giá thành |
| `src/lib/auth.ts`, `perm.ts` | Đăng nhập, phiên, vai trò và quyền |
| `src/lib/setup.ts` | Tạo doanh nghiệp, danh mục mặc định, thêm thành viên |
| `src/lib/seed.ts`, `demo.ts`, `src/data/demo.json` | Kịch bản và ảnh chụp dữ liệu của ba doanh nghiệp mẫu |
| `src/pages/admin` | Quản trị toàn hệ thống |
| `src/pages/app` | Màn hình của doanh nghiệp |
| `src/pages/huong-dan.astro` | Hướng dẫn sử dụng |
| `src/pages/q` | Trang truy xuất công khai theo mã QR |

## Chạy ở máy

```bash
npm install
npm run db:local      # tạo lược đồ D1 cục bộ
npm run dev
```

Tạo lại ảnh chụp dữ liệu mẫu sau khi sửa `src/lib/seed.ts` (chỉ chạy được ở chế độ phát triển):

```bash
curl http://localhost:4321/dev-snapshot > src/data/demo.json
```

## Triển khai

1. Tạo D1 và ghi `database_id` vào `wrangler.jsonc`, sau đó `npm run db:remote`.
2. `npm run deploy`, hoặc nối kho mã với Cloudflare Workers Builds: lệnh dựng `npm run build`, lệnh triển khai `npx wrangler deploy`.
3. Tài khoản quản trị hệ thống đầu tiên được tạo trực tiếp trong D1 (bảng `users`, `is_sysadmin = 1`) kèm một dòng trong `tokens` để đặt mật khẩu. Không lưu email hay mật khẩu trong kho mã.
4. Đăng nhập, vào Quản trị hệ thống, bấm "Nạp lại dữ liệu mẫu" để tạo ba doanh nghiệp mẫu.

## Phạm vi của phiên bản này

Đã có: hai cấp quản lý, 12 vai trò, 4 nguồn hàng, lệnh công đoạn (phân loại, bóc múi, cấp đông, đóng gói), đơn lẻ, sỉ, xuất khẩu, 5 cổng kiểm soát, thu chi, truy xuất lô, giá thành và hao hụt, ba doanh nghiệp mẫu, hướng dẫn sử dụng.

Chưa có: nhập liệu khi mất mạng, nối cân điện tử, in nhãn hàng loạt, lưu ảnh chứng từ, gửi email tự động, quản lý nhiều cơ sở trong một doanh nghiệp, sửa hoặc hủy phiếu đã lưu, tiền công và thuế.

## Quy trình sản xuất tự khai báo

Từ bản di trú `0002_processes.sql`, công đoạn không còn gắn cứng trong mã. Mỗi doanh nghiệp có các quy trình (`processes`), mỗi quy trình gồm các bước (`process_steps`) với định mức thu hồi và khoản chi phí thêm. Lệnh công đoạn (`works`) ghi quy trình và bước đã thực hiện. Trang `/app/quy-trinh` khai báo quy trình và xem đầu vào, thành phẩm, hao hụt, giá vốn, giá bán theo từng quy trình.

Khi triển khai bản mới cần chạy di trú trước: `npm run db:remote`.
