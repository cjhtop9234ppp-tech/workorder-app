-- 목록 조회 속도: 업체별·날짜별 색인 (100개 업체 · 월 1만 건 규모 대비)
CREATE INDEX IF NOT EXISTS idx_orders_shop_created ON orders(shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_shops_name ON shops(name);
