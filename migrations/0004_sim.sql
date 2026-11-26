-- Vận hành thử theo kịch bản: doanh nghiệp mô phỏng tự chạy công việc hằng ngày theo giờ đã lên lịch.
ALTER TABLE tenants ADD COLUMN sim_from TEXT NOT NULL DEFAULT '';   -- ngày bắt đầu kịch bản
ALTER TABLE tenants ADD COLUMN sim_until TEXT NOT NULL DEFAULT '';  -- ngày cuối của kịch bản (rỗng = không mô phỏng)
ALTER TABLE tenants ADD COLUMN sim_day TEXT NOT NULL DEFAULT '';    -- ngày đang chạy
ALTER TABLE tenants ADD COLUMN sim_idx INTEGER NOT NULL DEFAULT 0;  -- việc tiếp theo trong ngày
ALTER TABLE tenants ADD COLUMN sim_busy TEXT NOT NULL DEFAULT '';   -- đang có lượt chạy giữ chỗ từ lúc này

CREATE TABLE sim_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  idx INTEGER NOT NULL,
  time TEXT NOT NULL,          -- giờ theo lịch (giờ Việt Nam)
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,        -- ok | skip | error
  result TEXT NOT NULL DEFAULT '',
  ran_at TEXT NOT NULL         -- giờ thật lúc chạy
);
CREATE INDEX idx_sim_log ON sim_log(tenant_id, day, idx);
