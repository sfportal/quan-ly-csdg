-- Sổ kho: hủy chứng từ có lý do, phiếu kiểm kê và điều chỉnh, khóa sổ, nhật ký ghi giá trị cũ và mới.
ALTER TABLE weigh_tickets ADD COLUMN void_at TEXT;
ALTER TABLE weigh_tickets ADD COLUMN void_by TEXT;
ALTER TABLE weigh_tickets ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE weigh_tickets ADD COLUMN void_snap TEXT NOT NULL DEFAULT '';  -- ảnh chụp số liệu lúc hủy (JSON)
ALTER TABLE works ADD COLUMN void_at TEXT;
ALTER TABLE works ADD COLUMN void_by TEXT;
ALTER TABLE works ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE works ADD COLUMN void_snap TEXT NOT NULL DEFAULT '';

ALTER TABLE audit ADD COLUMN old TEXT NOT NULL DEFAULT '';
ALTER TABLE audit ADD COLUMN new TEXT NOT NULL DEFAULT '';

ALTER TABLE tenants ADD COLUMN lock_date TEXT NOT NULL DEFAULT '';     -- khóa sổ: chứng từ đến hết ngày này không lập, hủy được
ALTER TABLE tenants ADD COLUMN raw_days INTEGER NOT NULL DEFAULT 3;    -- nguyên liệu nằm chờ quá số ngày này thì cảnh báo (tự đặt)

-- Phiếu điều chỉnh tồn: kiểm kê (count), hủy hàng hư (scrap), hao hụt bảo quản (loss)
CREATE TABLE adjusts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  total_g INTEGER NOT NULL DEFAULT 0,     -- chênh lệch, có dấu
  total_cost INTEGER NOT NULL DEFAULT 0,  -- giá trị chênh lệch, có dấu
  created_by TEXT,
  created_at TEXT NOT NULL,
  void_at TEXT,
  void_by TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  void_snap TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_adjusts_tenant ON adjusts(tenant_id, date);

CREATE TABLE adjust_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  adjust_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  before_g INTEGER NOT NULL,
  delta_g INTEGER NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_alines_adjust ON adjust_lines(tenant_id, adjust_id);
CREATE INDEX idx_alines_lot ON adjust_lines(tenant_id, lot_id);
