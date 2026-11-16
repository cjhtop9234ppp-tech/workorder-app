-- 보험사·담보 목록 (마스터가 설정에서 직접 추가)
CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,          -- 'insurer' (보험사) 또는 'coverage' (담보)
  value TEXT NOT NULL
);
-- 도장코드 (엑셀 업로드: NO, 도장코드, 코트수)
CREATE TABLE IF NOT EXISTS paint_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT,
  code TEXT NOT NULL,
  coats TEXT
);
CREATE INDEX IF NOT EXISTS idx_paint_codes_code ON paint_codes(code);
