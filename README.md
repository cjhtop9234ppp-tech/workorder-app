# 작업지시서 프로그램

자동차 공업사 작업지시서 작성·저장·조회 프로그램입니다.
웹(Cloudflare Worker + D1 + KV)으로 동작하고, 데스크톱 설치 프로그램(Windows)도 함께 만들 수 있습니다.

## 폴더 구성

| 경로 | 내용 |
|---|---|
| `app/` | 화면(웹 앱). 작업지시서 입력·보기, 마스터 설정, 작업지시서 목록 |
| `app/version.js` | **앱 버전의 단일 출처**. 설치파일 버전도 이 값과 같아야 합니다 |
| `tools/server/worker.js` | 저장·조회 API (`/api/*`) |
| `tools/server/schema.sql`, `migrate-*.sql` | D1 테이블 생성과 변경 스크립트 |
| `tools/server/wrangler.jsonc` | Cloudflare 설정 (KV·D1 식별자는 자리표시자) |
| `tools/build_data.py` | 원본 엑셀 → `app/data.js` 변환 |
| `tools/sanitize_images.py` | 그림 파일 가공(개인정보 가림) |
| `tools/publish.py` | 버전 올리기 → 웹 배포 → (선택) 설치파일 빌드 |
| `tools/build_installer.py`, `installer.iss`, `WorkOrder.spec` | 설치파일 빌드 |
| `launcher/main.py`, `web_server.py`, `start_web_remote.bat` | 데스크톱 실행기와 로컬 서버 |
| `docs/` | 사용 매뉴얼 작성용 참고 자료 |

## 이 저장소에 없는 것 (직접 준비해야 함)

- **엑셀 원본**: 1~5번 원본 엑셀(작업지시서 샘플, 작업항목 그룹, 결과도출리스트 차량DB, 차량명정의, 비교분석 도장DB), 업로드 파일
- **그림 파일**: 그림코드(USER…) 이미지 원본과 가공본
- **생성물**: `app/data.js`, `app/img/`, `build/`, `dist/`, `installer_output/`
- **계정·비밀 값**: 마스터 비밀번호(Worker secret `WORKORDER_PASSWORD`), Cloudflare 로그인

## 처음 설정

1. Cloudflare에서 D1 데이터베이스와 KV 네임스페이스를 만듭니다.
2. `tools/server/wrangler.jsonc`의 `YOUR_KV_NAMESPACE_ID`, `YOUR_D1_DATABASE_ID`를 실제 값으로 바꿉니다.
3. D1에 `schema.sql`을 먼저 적용하고, `migrate-*.sql`을 파일 이름 순서대로 적용합니다.
   - 예: `npx wrangler d1 execute workorder --remote --file tools/server/schema.sql`
4. 마스터 비밀번호를 설정합니다: `npx wrangler secret put WORKORDER_PASSWORD`

## 데이터 만들기

원본 엑셀이 있는 폴더를 환경 변수나 인자로 알려 줍니다.

```bash
set WORKORDER_EXCEL_DIR=엑셀 폴더 경로
set WORKORDER_REPAIR_XLSX=업로드 파일 경로
set WORKORDER_IMAGE_DIR=그림 폴더 경로
python tools/build_data.py
```

`app/data.js`와 `app/sample-order.js`가 만들어집니다. 원본 엑셀이 바뀌면 다시 실행합니다.

## 배포

```bash
python tools/publish.py --web-only     # 웹만 배포 (버전 +1)
python tools/publish.py                # 웹 배포 + 설치파일 빌드
```

배포 후 `version.js`의 버전을 확인하세요. 웹 배포는 `npx wrangler`(Cloudflare 로그인 필요)를 씁니다.

## 역할

- **마스터**: 공업사 계정 등록, 차량명정의·착안점(복원수리) 매칭 업로드와 편집, 보기순서 변경, 그림 업로드
- **공업사**: 자기 작업지시서 작성·저장·조회(목록에서 보기·작성)

## API 요약

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/login` | 로그인 (쿠키) |
| POST | `/api/logout` | 로그아웃 |
| GET | `/api/session` | 현재 계정 `{ok, role, shopId, name}` |
| GET·POST | `/api/shops` | 공업사 목록·등록 (마스터) |
| POST·PATCH·DELETE | `/api/shops/:id` | 공업사 수정·삭제 (마스터) |
| POST | `/api/orders` | 작업지시서 저장 `{vehicle, plate, rows, ...}` |
| GET | `/api/orders` | 목록 (`page`, `size`, `sort=created|inDate|outDate`, `dir=asc|desc`, 검색 조건) |
| GET | `/api/orders?vehicle=&plate=[&shop=]` | 한 건 |
| GET·PUT | `/api/vehicles` | 차량명 정의 (PUT은 전체 교체) |
| GET·POST | `/api/mapping` | 착안점 매칭 목록 (POST는 전체 교체) |
| POST | `/api/mapping/row`, `/api/mapping/order` | 행 추가, 보기순서 저장 |
| PATCH·DELETE | `/api/mapping/:id` | 행 수정·삭제 |
| GET·PUT·DELETE | `/api/img/:code` | 그림 파일 |

전체 목록은 `tools/server/worker.js` 상단 주석과 라우터를 보세요.

## 데이터 구조 (브릿지 연결 시 참고)

- **작업지시서 한 건** (`orders.rows_json`): `{ meta, rows, extras, memoSel, marks }`
  - `meta`: 입고일·출고일·보험사·담보·도장코드·도장횟수
  - `rows[]`: `{ part, item, centerWork, centerPaint, work:{L,R,C}, paint:{L,R,C}, memo, tip }`
  - `L`·`R`·`C`: 좌·우·가운데(교환·판금·탈착 등)
- **착안점 매칭 행** (`repair_items`): `{ id, seq, group, part, item, no, text, workKind, qty, partPrice, labor, code, sort }`
  - `group`: "1. 승용, RV1, RV2" 또는 "2. 화물1, 화물2"
  - `code`: 그림코드. 그림은 `/api/img/:code`
- **보기순서**: 구분별로 `sort`(순서 번호)와 `customOrder`(구분별 저장 여부). 저장하지 않은 구분은 작업지시서 샘플(1번 파일) C열·L열 순서를 씁니다.
- **차량 기준 작업항목**: `data.js`의 `vehicleItems` (3번 차량DB 전체 시트 중 숨김이 아닌 행)

## 버전 규칙

- 버전 번호는 `app/version.js` 한 곳에서만 관리합니다.
- 새 빌드마다 버전을 올리고, 설치파일 이름에도 버전을 넣습니다.
- 창을 띄우는 실행 파일은 창 제목에 버전을 표시합니다.
