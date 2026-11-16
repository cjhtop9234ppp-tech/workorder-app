-- 작업지시서 저장소 (Cloudflare D1)
-- 공업사 계정: 마스터가 등록한다. 비밀번호는 PBKDF2 해시로만 저장한다.
CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,           -- 공업사명
  login_id TEXT NOT NULL UNIQUE,
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 한 작업지시서 = (공업사, 차량명, 차량번호) 한 건. 저장할 때마다 같은 건을 덮어쓴다.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,          -- "공업사ID|차량명|차량번호"
  shop_id TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  plate TEXT NOT NULL,
  created_at TEXT,              -- 처음 저장한 시각 (생성일, ISO)
  updated_at TEXT NOT NULL,     -- 마지막 저장 시각 (ISO)
  rows_json TEXT NOT NULL       -- 주작업항목별 작업·도장·메모·착안점 (JSON 배열)
);
