-- Quy trình sản xuất tự khai báo: mỗi quy trình là một chuỗi bước từ đầu vào đến thành phẩm.
CREATE TABLE processes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  in_item_id TEXT,                    -- mặt hàng đầu vào; NULL = mọi nguyên liệu nhập
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_proc_tenant ON processes(tenant_id);

CREATE TABLE process_steps (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  process_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  skey TEXT NOT NULL,                 -- khóa công đoạn, ghi vào lots.stage, items.stage, works.type
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,               -- tiền tố số lệnh
  norm INTEGER NOT NULL DEFAULT 1000, -- định mức đầu ra trên đầu vào, phần nghìn
  extra_label TEXT NOT NULL DEFAULT '', -- tên khoản chi phí thêm ở bước này (bao bì, phụ gia...), rỗng = không có
  hold_days INTEGER NOT NULL DEFAULT 0  -- cảnh báo khi hàng sau bước này tồn quá số ngày, 0 = không cảnh báo
);
CREATE INDEX idx_psteps ON process_steps(tenant_id, process_id, seq);

ALTER TABLE works ADD COLUMN process_id TEXT;
ALTER TABLE works ADD COLUMN step_name TEXT NOT NULL DEFAULT '';

-- Doanh nghiệp đã có: sinh quy trình mặc định theo dòng sản phẩm
INSERT INTO processes(id,tenant_id,name,sort,created_at)
  SELECT 'pf_'||id, id, 'Sầu riêng trái tươi đóng thùng', 1, created_at FROM tenants WHERE lines IN ('fresh','both');
INSERT INTO processes(id,tenant_id,name,sort,created_at)
  SELECT 'pz_'||id, id, 'Sầu riêng bóc múi cấp đông', 2, created_at FROM tenants WHERE lines IN ('frozen','both');
INSERT INTO process_steps(id,tenant_id,process_id,seq,skey,name,prefix,norm,extra_label,hold_days)
  SELECT 'pf1_'||id, id, 'pf_'||id, 1, 'sort', 'Phân loại, xử lý', 'PL', 1000, '', 2 FROM tenants WHERE lines IN ('fresh','both');
INSERT INTO process_steps(id,tenant_id,process_id,seq,skey,name,prefix,norm,extra_label,hold_days)
  SELECT 'pf2_'||id, id, 'pf_'||id, 2, 'pack', 'Đóng gói', 'DG', 1000, 'Bao bì, vật tư', 3 FROM tenants WHERE lines IN ('fresh','both');
INSERT INTO process_steps(id,tenant_id,process_id,seq,skey,name,prefix,norm,extra_label,hold_days)
  SELECT 'pz1_'||id, id, 'pz_'||id, 1, 'sort', 'Phân loại, xử lý', 'PL', 1000, '', 2 FROM tenants WHERE lines IN ('frozen','both');
INSERT INTO process_steps(id,tenant_id,process_id,seq,skey,name,prefix,norm,extra_label,hold_days)
  SELECT 'pz2_'||id, id, 'pz_'||id, 2, 'peel', 'Bóc múi', 'BM', norm_peel, '', 1 FROM tenants WHERE lines IN ('frozen','both');
INSERT INTO process_steps(id,tenant_id,process_id,seq,skey,name,prefix,norm,extra_label,hold_days)
  SELECT 'pz3_'||id, id, 'pz_'||id, 3, 'freeze', 'Cấp đông', 'CD', 1000, '', 0 FROM tenants WHERE lines IN ('frozen','both');
INSERT INTO process_steps(id,tenant_id,process_id,seq,skey,name,prefix,norm,extra_label,hold_days)
  SELECT 'pz4_'||id, id, 'pz_'||id, 4, 'pack', 'Đóng gói', 'DG', 1000, 'Bao bì, vật tư', 0 FROM tenants WHERE lines IN ('frozen','both');

UPDATE works SET step_name = CASE type WHEN 'sort' THEN 'Phân loại, xử lý' WHEN 'peel' THEN 'Bóc múi' WHEN 'freeze' THEN 'Cấp đông' ELSE 'Đóng gói' END WHERE step_name='';
UPDATE works SET process_id = CASE
  WHEN type IN ('peel','freeze') THEN 'pz_'||tenant_id
  WHEN type='pack' AND EXISTS (SELECT 1 FROM work_inputs x JOIN lots l ON l.id=x.lot_id WHERE x.work_id=works.id AND l.stage='freeze') THEN 'pz_'||tenant_id
  WHEN (SELECT lines FROM tenants t WHERE t.id=works.tenant_id)='frozen' THEN 'pz_'||tenant_id
  ELSE 'pf_'||tenant_id END
WHERE process_id IS NULL;
