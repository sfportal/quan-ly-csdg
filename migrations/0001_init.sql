-- Hệ thống quản lý cơ sở đóng gói nông sản
-- Quy ước: khối lượng lưu bằng gam (số nguyên), tiền lưu bằng đồng (số nguyên), thời gian ISO 8601.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  pass_hash TEXT,
  is_sysadmin INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  failed_n INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  lines TEXT NOT NULL DEFAULT 'both',          -- fresh | frozen | both
  status TEXT NOT NULL DEFAULT 'active',       -- active | locked
  is_demo INTEGER NOT NULL DEFAULT 0,
  packing_code TEXT NOT NULL DEFAULT '',       -- mã số cơ sở đóng gói
  address TEXT NOT NULL DEFAULT '',
  norm_peel INTEGER NOT NULL DEFAULT 320,      -- định mức tỷ lệ múi, phần nghìn
  box_cost INTEGER NOT NULL DEFAULT 0,         -- chi phí bao bì mặc định mỗi thùng
  created_at TEXT NOT NULL
);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX idx_memberships_user ON memberships(user_id);

CREATE TABLE audit (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  ref TEXT,
  detail TEXT,
  at TEXT NOT NULL
);
CREATE INDEX idx_audit_tenant ON audit(tenant_id, at);

CREATE TABLE counters (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

-- Đối tác: nhà cung cấp (4 nguồn) và khách hàng (lẻ, sỉ, xuất khẩu)
CREATE TABLE partners (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- supplier | customer
  sub TEXT NOT NULL,                  -- supplier: trader | linked | unlinked | own ; customer: retail | wholesale | export
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  tax_code TEXT NOT NULL DEFAULT '',
  area_code TEXT NOT NULL DEFAULT '', -- mã số vùng trồng
  area_expiry TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_partners_tenant ON partners(tenant_id, kind);

-- Mặt hàng: NL nguyên liệu, BTP bán thành phẩm, TP thành phẩm, PP phụ phẩm
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- NL | BTP | TP | PP
  stage TEXT NOT NULL DEFAULT '',     -- công đoạn tạo ra: receive | sort | peel | freeze | pack
  box_g INTEGER NOT NULL DEFAULT 0,   -- quy cách một thùng (gam), 0 nếu không đóng thùng
  price INTEGER NOT NULL DEFAULT 0,   -- giá gợi ý đ/kg (mua, bán hoặc thu hồi)
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_items_tenant ON items(tenant_id);

-- Lô: đơn vị truy xuất và tính giá thành
CREATE TABLE lots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  item_id TEXT NOT NULL,
  stage TEXT NOT NULL,                -- receive | sort | peel | freeze | pack
  date TEXT NOT NULL,
  qty_in_g INTEGER NOT NULL,
  qty_g INTEGER NOT NULL,             -- còn tồn
  boxes INTEGER NOT NULL DEFAULT 0,
  cost_total INTEGER NOT NULL DEFAULT 0,
  cost_loss INTEGER NOT NULL DEFAULT 0,   -- phần hao hụt lũy kế nằm trong cost_total
  cost_extra INTEGER NOT NULL DEFAULT 0,  -- phần chi phí thêm lũy kế nằm trong cost_total
  ticket_id TEXT,
  work_id TEXT,
  partner_id TEXT,
  area_code TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ok',  -- ok | hold
  created_at TEXT NOT NULL
);
CREATE INDEX idx_lots_tenant ON lots(tenant_id, stage);
CREATE UNIQUE INDEX idx_lots_code ON lots(tenant_id, code);

CREATE TABLE lot_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_lot TEXT NOT NULL,
  to_lot TEXT NOT NULL,
  work_id TEXT NOT NULL,
  qty_g INTEGER NOT NULL
);
CREATE INDEX idx_links_from ON lot_links(tenant_id, from_lot);
CREATE INDEX idx_links_to ON lot_links(tenant_id, to_lot);

-- Phiếu cân nhập
CREATE TABLE weigh_tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  source TEXT NOT NULL,               -- trader | linked | unlinked | own
  vehicle TEXT NOT NULL DEFAULT '',
  area_code TEXT NOT NULL DEFAULT '',
  pay_method TEXT NOT NULL DEFAULT 'bank',  -- bank | cash | internal
  doc_invoice INTEGER NOT NULL DEFAULT 0,   -- hóa đơn
  doc_list INTEGER NOT NULL DEFAULT 0,      -- bảng kê thu mua
  doc_contract INTEGER NOT NULL DEFAULT 0,  -- hợp đồng liên kết hoặc phiếu nội bộ
  total_g INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tickets_tenant ON weigh_tickets(tenant_id, date);

CREATE TABLE weigh_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  gross_g INTEGER NOT NULL,
  tare_g INTEGER NOT NULL DEFAULT 0,
  deduct_g INTEGER NOT NULL DEFAULT 0,
  net_g INTEGER NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  lot_id TEXT
);
CREATE INDEX idx_wlines_ticket ON weigh_lines(tenant_id, ticket_id);

-- Lệnh công đoạn: phân loại, bóc múi, cấp đông, đóng gói
CREATE TABLE works (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL,                 -- sort | peel | freeze | pack
  date TEXT NOT NULL,
  norm INTEGER NOT NULL DEFAULT 1000, -- định mức đầu ra trên đầu vào, phần nghìn
  in_g INTEGER NOT NULL DEFAULT 0,
  out_g INTEGER NOT NULL DEFAULT 0,   -- sản phẩm chính
  by_g INTEGER NOT NULL DEFAULT 0,    -- phụ phẩm
  loss_g INTEGER NOT NULL DEFAULT 0,
  in_cost INTEGER NOT NULL DEFAULT 0,
  extra_cost INTEGER NOT NULL DEFAULT 0,
  by_value INTEGER NOT NULL DEFAULT 0,
  loss_cost INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_works_tenant ON works(tenant_id, date);

CREATE TABLE work_inputs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  qty_g INTEGER NOT NULL,
  cost INTEGER NOT NULL
);
CREATE INDEX idx_winputs ON work_inputs(tenant_id, work_id);

CREATE TABLE work_outputs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty_g INTEGER NOT NULL,
  boxes INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL
);
CREATE INDEX idx_woutputs ON work_outputs(tenant_id, work_id);

-- Đơn hàng: lẻ, sỉ, xuất khẩu
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  type TEXT NOT NULL,                 -- retail | wholesale | export
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | shipped
  vehicle TEXT NOT NULL DEFAULT '',
  container TEXT NOT NULL DEFAULT '',
  seal TEXT NOT NULL DEFAULT '',
  lab_cd TEXT NOT NULL DEFAULT 'na',  -- na | wait | ok | fail  (Cadimi)
  lab_o TEXT NOT NULL DEFAULT 'na',   -- vàng O
  lab_ref TEXT NOT NULL DEFAULT '',
  phyto TEXT NOT NULL DEFAULT '',     -- số chứng thư kiểm dịch thực vật
  revenue INTEGER NOT NULL DEFAULT 0,
  deduct INTEGER NOT NULL DEFAULT 0,  -- khoản khách trừ
  trip_cost INTEGER NOT NULL DEFAULT 0, -- chi phí chuyến hàng
  cogs INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  shipped_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_orders_tenant ON orders(tenant_id, date);

CREATE TABLE order_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty_g INTEGER NOT NULL,
  boxes INTEGER NOT NULL DEFAULT 0,
  price INTEGER NOT NULL DEFAULT 0,   -- đ/kg
  amount INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_olines_order ON order_lines(tenant_id, order_id);
CREATE INDEX idx_olines_lot ON order_lines(tenant_id, lot_id);

CREATE TABLE order_costs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- deduct | trip
  name TEXT NOT NULL,
  amount INTEGER NOT NULL
);
CREATE INDEX idx_ocosts_order ON order_costs(tenant_id, order_id);

-- Tiền thu, chi
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  dir TEXT NOT NULL,                  -- in (thu từ khách) | out (chi cho người bán)
  ref_type TEXT NOT NULL,             -- order | ticket
  ref_id TEXT NOT NULL,
  date TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'bank',-- bank | cash
  amount INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_payments_ref ON payments(tenant_id, ref_type, ref_id);
