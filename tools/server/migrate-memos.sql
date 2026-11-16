-- 기타메모사항 목록: shop_id 가 'all' 이면 마스터가 정한 공통 목록, 아니면 그 공업사 전용 목록
CREATE TABLE IF NOT EXISTS memos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id TEXT NOT NULL,
  value TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memos_scope ON memos(shop_id, sort);
