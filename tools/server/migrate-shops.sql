-- 1회용 이전: 공업사 계정 도입 전에 저장된 작업지시서는 '공업사 미지정(legacy)'으로 옮긴다.
-- 이 파일은 한 번만 실행한다 (두 번 실행하면 id 가 두 번 바뀐다).
CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  login_id TEXT NOT NULL UNIQUE,
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO shops (id, name, login_id, pw_salt, pw_hash, created_at)
  VALUES ('legacy', '기존 자료 (공업사 미지정)', 'legacy_unassigned', '-', '-', '2026-10-30T00:00:00Z');
ALTER TABLE orders ADD COLUMN shop_id TEXT NOT NULL DEFAULT 'legacy';
UPDATE orders SET id = 'legacy|' || id;
