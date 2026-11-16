# 백업 방법 (작업지시서 서버)

데이터는 Cloudflare D1(작업지시서·업체 계정·매칭 목록)과 KV(그림 파일)에 있습니다.

## 1. 자동 복구 지점 (D1 Time Travel)
- D1 은 최근 30일 안의 임의 시점으로 되돌릴 수 있습니다.
- 복구 예: `npx wrangler d1 time-travel restore workorder --timestamp=2026-11-01T09:00:00Z`

## 2. 월 1회 전체 내보내기 (권장)
아래 명령을 매월 1일에 실행해서 `backup/` 폴더에 보관합니다.

    npx wrangler d1 export workorder --remote --output=backup/workorder-YYYY-MM.sql

- 작업지시서 1년치는 용량이 커질 수 있으므로 내보낸 파일을 외장 저장소나 다른 클라우드에도 보관하세요.

## 3. 그림 파일 (KV)
- KV 는 전체 내보내기 명령이 없습니다. 원본 그림은 공유 폴더(6. 이미지검색 …)에 따로 보관하고, 설정 화면의 "그림 다운로드 (zip)"으로 주기적으로 받아 두세요.

## 4. 계정 비밀번호
- 업체 비밀번호는 해시로만 저장됩니다. 백업 파일에도 평문이 없습니다.
