-- 착안점(복원수리) 보기순서: 구분(grp) 안에서의 표시 순서 (작은 번호가 먼저)
-- 적용 후 기존 행은 원래 순서(id)대로 번호를 받는다.
ALTER TABLE repair_items ADD COLUMN sort_no INTEGER;
UPDATE repair_items SET sort_no = id WHERE sort_no IS NULL;
