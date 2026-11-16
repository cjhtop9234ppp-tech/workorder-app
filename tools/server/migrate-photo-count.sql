-- 폴더 안 사진 개수 (목록 부서 칸 아래에 "(개수)"로 표시)
ALTER TABLE orders ADD COLUMN photo_count INTEGER NOT NULL DEFAULT 0;
