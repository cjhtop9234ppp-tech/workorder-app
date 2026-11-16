-- 주작업항목 그림이미지 매칭 (엑셀 '매핑' 시트와 같은 열) 과 그림 목록
CREATE TABLE IF NOT EXISTS repair_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq TEXT,            -- 원본순번
  grp TEXT,            -- 구분 (예: 1. 승용, RV1, RV2)
  part TEXT,           -- 파트
  item TEXT,           -- 주작업항목
  no TEXT,             -- NO (구분별 작업지시서 순번)
  text TEXT,           -- 작업내역
  work_kind TEXT,      -- 작업
  qty TEXT,            -- 수량/시간
  part_price TEXT,     -- 부품액
  labor TEXT,          -- 공임
  code TEXT            -- 그림이미지코드 (USER…)
);
CREATE TABLE IF NOT EXISTS images (
  code TEXT PRIMARY KEY,
  uploaded_at TEXT NOT NULL
);
