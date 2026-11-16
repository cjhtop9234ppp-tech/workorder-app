// 작업지시서 화면 로직
// 데이터는 tools/build_data.py 가 만든 data.js (window.WORK_DATA) 를 사용한다.

// 도장구분 순환 순서: 교환도장 → 표면보수 → 표면판금보수 → 전면판금보수 → 교환도장 …
const PAINT_CYCLE = ["교환도장", "표면보수", "표면판금보수", "전면판금보수"];
const PAINT_EXCHANGE = "교환도장";
const PAINT_SHEET = "표면판금보수";

const SAMPLE_KEY = { 승용: "sampleLeft", RV1: "sampleLeft", RV2: "sampleLeft", 화물1: "sampleRight", 화물2: "sampleRight" };

// 차량의 구분값을 화면이 아는 값(승용·RV1·RV2·화물1·화물2)으로 맞춘다.
// 서버 자료의 '유형'이 비었거나 '화물', '2. 화물1, 화물2'처럼 그룹명으로 적혀 있어도 작업항목을 찾을 수 있게 한다.
// (예전에는 이 값이 SAMPLE_KEY 에 없어서 작업 표가 비고 화면이 멈춰 보였다)
function vehicleCategory(v) {
  if (!v) return "승용";
  if (SAMPLE_KEY[v.category]) return v.category;
  const text = String(v.category || v.group || "");
  if (text.includes("화물") || /^2\b/.test(text)) return /봉고/.test(v.name) ? "화물2" : "화물1";
  if (/RV1/.test(text)) return "RV1";
  if (/RV2|승합/.test(text)) return "RV2";
  return "승용";
}

const SUGGEST_MAX = 50;

// 도장 DB 이름과 맞지 않아도 도장을 적용하는 예외 항목 (5번 DB 대조 없이 항상 도장 가능)
const ALWAYS_PAINT = new Set(["사이드미러", "트렁크바닥패널"]);

// 서스펜션 "기본 교환" 버튼이 한 번에 교환으로 바꾸는 항목 (모두 좌/우가 있는 항목)
const BASE_EXCHANGE = {
  "프런트 서스펜션": ["쇽업소버(프런트)", "너클(프런트)", "허브(프런트)", "브레이크디스크더스트커버(프런트)", "타이어(프런트)", "휠(프런트)"],
  "리어 서스펜션": ["쇽업소버(리어)", "너클(리어)", "허브(리어)", "브레이크디스크더스트커버(리어)", "타이어(리어)", "휠(리어)"],
};

// (좌)(우) 없이 쓰는 항목 중, 5번 도장 DB에 매칭될 때만 작업지시서에 노출하는 항목
const PAINT_MATCH_ONLY = new Set(["트렁크리드"]);
const LONG_PRESS_MS = 2000;

const data = window.WORK_DATA;
// vehicleItems 는 작업항목 이름 사전 + 차량별 번호 목록으로 줄여 담겨 있다 (전송량을 줄이려고). 쓰기 전에 원래 모양으로 되돌린다.
if (data.vehicleItems && Array.isArray(data.vehicleItems.names)) {
  const names = data.vehicleItems.names;
  data.vehicleItems = Object.fromEntries(
    Object.entries(data.vehicleItems.by).map(([vehicle, idx]) => [vehicle, idx.map((i) => names[i])])
  );
}
const vehicleByName = new Map(data.vehicles.map((v) => [v.name, v]));


const state = {
  vehicle: null,   // 입력/선택한 차량명 (4번 파일 B열)
  plate: "",
  rows: [],        // 작업지시서에 노출되는 주작업항목 + 클릭 상태
  tipGroup: "1",   // 착안점 묶음 (구분에 따라 "1" 승용계 / "2" 화물계)
  locked: false,   // 저장된 작업지시서를 불러와 보기 모드인지 (수정 버튼을 눌러야 고칠 수 있다)
  dirty: false,    // 저장하지 않은 변경이 있는지
  extras: [],      // 일반 작업에서 고른 항목
  role: null,      // 로그인한 계정 역할 ("shop" 또는 "master")
  editBase: null,  // 수정을 누른 순간의 값 (바뀐 칸을 녹색으로 표시하기 위해). 수정 중이 아니면 null
  revised: false,  // 수정 후 저장되어 수정 확인을 기다리는 작업지시서인지 (목록에서 갈색 음영)
  marksMap: null,  // 저장된 녹색 음영 (주작업항목 키 → 바뀐 칸). 수정 확인 전까지 유지된다
  meta: null,      // 입고일·출고일·보험사·담보·도장코드 (메타 줄)
  memoSel: [],     // 기타메모사항에서 고른 문장들 (다중 선택)
};

const $ = (id) => document.getElementById(id);

// 서버 응답이 늦거나 멈춰도 화면이 영원히 기다리지 않도록 시간 제한을 둔다 (휴대폰 네트워크에서 '반응 없음'의 원인이었다)
function fetchTimed(url, options = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// 비교용 이름: 끝에 붙은 (좌)/(우)/(좌, 우)를 떼어 낸다.
// 예) "헤드램프어셈블리(좌)" → "헤드램프어셈블리". 샘플은 좌/우를 한 행으로 묶어 쓰기 때문이다.
const SIDE_SUFFIX = /\((좌|우)(, ?(좌|우))?\)$/;
function baseName(name) {
  return name.replace(SIDE_SUFFIX, "").trim();
}

// 화면 표시용: 문장 안의 (좌)/(우)도 글자로 보이지 않게 뗀다 (요약의 좌/우 표시는 따로 쓴다).
const SIDE_ANYWHERE = /\((좌|우)(, ?(좌|우))?\)/g;
function hideSide(text) {
  return text.replace(SIDE_ANYWHERE, "").replace(/\s{2,}/g, " ").trim();
}

// 동의어 색인: 2번 파일에서 C열 또는 D열에 같은 이름이 있는 행들의 C·D 값을 모두 한 묶음으로 본다.
// 예) 프런트필러(좌) 묶음 = 프런트필러, 프런트필러어셈블리, 프런트필러(아우터), 앞도어필러 …
const synonymIndex = new Map();
for (const [groupName, itemName] of data.groups) {
  const members = [...new Set([groupName, itemName].map(baseName))];
  for (const name of members) {
    if (!synonymIndex.has(name)) synonymIndex.set(name, new Set());
    members.forEach((m) => synonymIndex.get(name).add(m));
  }
}

// 작업항목 그룹 색인 (2번 파일, NO 기준): 같은 그룹 NO 안의 C열·D열 값을 한 묶음으로 본다.
// 이름(C열 또는 D열)이 속한 NO를 찾고, 그 NO에 속한 모든 C열·D열 값을 합친다(중복 제거).
const groupNosByName = new Map();
const groupMembersByNo = new Map();
for (const [no, c, d] of data.groupRows || []) {
  const members = [...new Set([c, d].map(baseName).filter(Boolean))];
  if (!groupMembersByNo.has(no)) groupMembersByNo.set(no, new Set());
  for (const m of members) {
    groupMembersByNo.get(no).add(m);
    if (!groupNosByName.has(m)) groupNosByName.set(m, new Set());
    groupNosByName.get(m).add(no);
  }
}

// 착안점 색인: 업로드 파일의 매핑 시트를 구분(1 승용계 / 2 화물계)별, 주작업항목별로 묶은 작업내역 목록
// 서버(api/mapping)의 매칭 목록을 우선 쓰고, 서버 자료가 없으면 빌드된 data.js 를 쓴다.
let repairIndex = { "1": new Map(), "2": new Map() };
// 착안점 목록(서버 매핑)을 다 받은 뒤에 작업지시서를 연다. 받기 전에 열면 data.js 목록으로 '보기' 단추를 그려서
// 서버 목록에는 없는 항목에 단추가 남고, 누르면 '등록된 착안점이 없습니다'만 뜬다.
let repairIndexReady = Promise.resolve();
// 서버 목록(api/mapping)을 한 번이라도 받았는지. 받았으면 착안점은 서버 목록만 쓴다.
let repairFromServer = false;
// 목록의 '작성'으로 열었으면 저장된 빈 작업지시서도 바로 고칠 수 있게 잠그지 않는다 (한 번만 적용)
let writeOnOpen = false;

// 보기순서 키: 마스터가 저장한 구분은 저장된 순서(sort)를, 아직 저장하지 않은 구분은 작업지시서 샘플(C열·L열) 순서를 쓴다.
// 같은 규칙을 보기순서 창(order-sort.js)에서도 쓴다.
function sampleIndexOf(group, item) {
  const list = group === "2" ? data.sampleRight : data.sampleLeft;
  const name = String(item || "").split(",")[0].trim();
  const at = list.findIndex((s) => s.item === name);
  return at < 0 ? 99999 : at;
}
function orderKeyOf(group, item, sort, customOrder) {
  const s = Number.isFinite(sort) ? sort : 0;
  if (customOrder && customOrder[group]) return s;
  return sampleIndexOf(group, item) * 1000000 + s;
}

function buildRepairIndex(rows, customOrder = {}) {
  const next = { "1": new Map(), "2": new Map() };
  for (const r of rows) {
    const group = String(r.group || "").startsWith("2.") ? "2" : "1";
    if (!r.item || !r.text) continue;
    const entry = {
      repair: r.text,
      imageSrc: r.hasImage && r.code ? `api/img/${encodeURIComponent(r.code)}?v=${encodeURIComponent(typeof APP_VERSION === "string" ? APP_VERSION : "1")}` : null,
      sort: orderKeyOf(group, r.item, r.sort, customOrder), // 보기순서 키
    };
    // 주작업항목에 "A, B"처럼 쉼표로 여러 개를 적었으면, 각 항목 이름마다 같은 작업내역과 그림을 넣는다
    const names = [...new Set(String(r.item).split(",").map((s) => baseName(s)).filter(Boolean))];
    for (const key of names) {
      if (!next[group].has(key)) next[group].set(key, []);
      next[group].get(key).push(entry);
    }
  }
  // 보기순서(마스터가 정한 순서)대로 묶음 안의 작업내역을 놓는다
  for (const group of Object.keys(next)) {
    for (const list of next[group].values()) list.sort((a, b) => a.sort - b.sort);
  }
  return next;
}

function buildRepairIndexFromData() {
  const next = { "1": new Map(), "2": new Map() };
  for (const group of Object.keys(next)) {
    for (const [itemName, list] of Object.entries((data.repairItems || {})[group] || {})) {
      next[group].set(baseName(itemName), list.map((r) => ({ repair: r.text, imageSrc: r.image })));
    }
  }
  return next;
}

repairIndex = buildRepairIndexFromData();

// 마스터가 올린 차량명 정의(엑셀)가 있으면 그 목록을 쓴다 (없으면 data.js 의 차량명)
let storedVehiclesAt = 0;
// 차량명 정의는 입력 칸을 누를 때 한 번씩 다시 받는다 (마스터가 설정에서 바꾼 목록이 바로 검색에 나오도록, 최근 1분 안이면 생략)
async function loadStoredVehicles(force = false) {
  if (!force && Date.now() - storedVehiclesAt < 60000) return;
  storedVehiclesAt = Date.now();
  try {
    const res = await fetch("api/vehicles", { credentials: "same-origin" });
    if (!res.ok) return;
    const { vehicles } = await res.json();
    if (!vehicles || vehicles.length === 0) return;
    data.vehicles = vehicles;
    vehicleByName.clear();
    vehicles.forEach((v) => vehicleByName.set(v.name, v));
  } catch (err) {
    // 서버를 못 읽으면 data.js 목록을 그대로 쓴다
  }
}

// 차량명 목록과 착안점 목록을 같이 받는다 (앞뒤로 기다리지 않도록 동시에 요청한다)
let repairLoadedAt = 0;
async function loadRepairIndex() {
  const vehiclesReady = loadStoredVehicles();
  try {
    const res = await fetchTimed("api/mapping", { credentials: "same-origin" });
    if (!res.ok) return;
    const { rows, customOrder } = await res.json();
    // 서버 목록을 받았으면 그것만 쓴다 (data.js·이 기기의 옛 자료로 채우지 않는다). 마스터가 고친 최종 내용이 그대로 나온다.
    repairIndex = buildRepairIndex(rows || [], customOrder || {});
    repairFromServer = true;
    repairLoadedAt = Date.now();
    // 목록이 바뀌었으므로, 작업지시서를 이미 열어 둔 상태라면 '보기' 단추를 다시 그린다 (입력 중이면 그대로 둔다)
    if (isOrderOpen() && !state.dirty) renderOrder();
  } catch (err) {
    // 서버를 못 읽으면 data.js 자료를 그대로 쓴다
  } finally {
    await vehiclesReady;
  }
}

// 작업항목(ㄱ)은 3번 DB에서만 가져온다. 3번 DB에 없으면 작업항목을 알 수 없으므로 인용한다.
function hasItems(name) {
  return Boolean(data.vehicleItems[name]);
}

// 차량 데이터 기준 차량명 결정
// - 3번 DB(작업항목)에 있으면 그 차량 자신을 쓴다 (도장 가능 여부도 같은 차량명으로 5번 DB에서 찾는다).
// - 없으면 4번 파일 기준으로 같은 그룹(C열)의 차량 중 인용할 차량을 고른다.
//   1순위 같은 차량급(E열), 2순위 같은 제작사(F열), 그 안에서 작업항목수(I열)가 가장 많은 차량.
function resolveDataVehicle(name) {
  if (hasItems(name)) return name;
  const me = vehicleByName.get(name);
  if (!me) return null;

  // 같은 계열(승용·RV1·RV2·화물)끼리 인용한다. 그룹명이 '화물'이든 '2. 화물1, 화물2'든 같은 화물로 본다
  const family = (v) => (vehicleCategory(v).startsWith("화물") ? "화물" : vehicleCategory(v));
  const pool = data.vehicles.filter((v) => family(v) === family(me) && v.name !== name && hasItems(v.name));
  const mostItems = (list) => [...list].sort((a, b) => b.count - a.count)[0] || null;
  const pick =
    mostItems(pool.filter((v) => v.cls === me.cls)) ||
    mostItems(pool.filter((v) => v.maker === me.maker)) ||
    mostItems(pool);
  return pick ? pick.name : null;
}

// ---------- 1. 입력 화면 ----------

// 제목은 창/탭 제목에만 버전과 함께 표시한다 (화면 안의 중복 제목은 두지 않는다).
function setupHeader() {
  document.title = `작업지시서 v${APP_VERSION}`;
  const verEl = $("app-ver");
  if ($("page-ver") && typeof APP_VERSION === "string") $("page-ver").textContent = `v${APP_VERSION}`;
  if (verEl) verEl.textContent = `v${APP_VERSION}`;
}

function renderSuggest() {
  const list = $("vehicle-suggest");
  list.innerHTML = "";
  const query = normalize($("vehicle-input").value);
  if (!query) {
    list.hidden = true;
    return;
  }
  const matches = data.vehicles.filter((v) => normalize(v.name).includes(query)).slice(0, SUGGEST_MAX);
  if (matches.length === 0) {
    list.hidden = true;
    return;
  }
  matches.forEach((v) => {
    const li = document.createElement("li");
    li.textContent = v.name;
    const cat = document.createElement("span");
    cat.className = "cat";
    cat.textContent = v.category;
    li.appendChild(cat);
    li.addEventListener("mousedown", (e) => {
      e.preventDefault(); // 입력칸 포커스가 빠지기 전에 선택되도록
      pickVehicle(v.name);
    });
    list.appendChild(li);
  });
  list.hidden = false;
}

function normalize(text) {
  return text.replace(/\s+/g, "").toLowerCase();
}

function pickVehicle(name) {
  state.vehicle = name;
  $("vehicle-input").value = name;
  $("vehicle-suggest").hidden = true;

  const notice = $("vehicle-notice");
  if (hasItems(name)) {
    notice.hidden = true;
  } else {
    const cited = resolveDataVehicle(name);
    notice.textContent = cited
      ? `이 차량은 3번 DB(작업항목)에 없어 같은 그룹의 '${cited}' 기준으로 작업항목을 표시합니다.`
      : "이 차량은 3번 DB(작업항목)에 없고 인용할 차량도 없어 작업항목이 표시되지 않습니다.";
    notice.hidden = false;
  }
  $("open-order").disabled = false;
}

function setupInput() {
  const input = $("vehicle-input");
  input.addEventListener("focus", () => {
    loadStoredVehicles().then(() => {
      if (document.activeElement === input && input.value.trim()) renderSuggest();
    });
  });
  input.addEventListener("input", () => {
    state.vehicle = null;
    $("vehicle-notice").hidden = true;
    renderSuggest();
  });
  input.addEventListener("blur", () => {
    // 목록에서 고르지 않고 입력만 한 경우, 정확히 같은 차량명이 있으면 선택한다.
    const exact = vehicleByName.get(input.value.trim());
    if (exact) pickVehicle(exact.name);
    $("vehicle-suggest").hidden = true;
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = $("vehicle-suggest").querySelector("li");
      if (first) pickVehicle(first.firstChild.textContent);
    }
  });
  $("open-order").addEventListener("click", () => {
    // 목록에서 고르지 않고 정확히 입력만 한 경우 여기서 차량을 정한다
    if (!state.vehicle) {
      const exact = vehicleByName.get($("vehicle-input").value.trim());
      if (exact) pickVehicle(exact.name);
    }
    // 아무 반응 없이 멈추지 않도록, 빠진 값이 있으면 무엇이 빠졌는지 알려 준다
    if (!state.vehicle) {
      showNotice("차량명을 목록에서 골라 주세요.");
      return;
    }
    const missing = missingVehicleFields();
    if (missing.length) {
      showNotice(`${missing.join(", ")} 값을 입력하세요.`);
      return;
    }
    // 어떤 이유로 실패해도 메시지 없이 작업지시서 화면으로 넘어간다
    openOrder().catch(() => {
      $("screen-input").hidden = true;
      $("screen-order").hidden = false;
      window.scrollTo(0, 0);
      try { renderOrder(); } catch (err) { /* 그릴 수 없으면 빈 화면 대신 입력 칸 값이라도 남긴다 */ }
    });
  });
}

// ---------- 2. 작업지시서 만들기 ----------

// ㄱ: 3번 DB 전체 시트에서 차명(C열)이 같은 행의 작업항목(K열)
// ㄴ: 2번 작업항목 그룹. ㄱ 값이 C열 또는 D열과 같은 행이 있으면, 그 행의 NO 묶음 전체의 C열·D열을 모두 가져온다 (중복 제거).
// ㄷ: 1번 샘플의 주작업항목(승용계 C열, 화물계 L열). ㄴ 값과 완전히 같은 이름만 표기한다 (글자가 들어 있다는 이유만으로는 붙이지 않는다).
// 도장 가능: 5번 DB에서 차명(D열)이 같은 행의 작업항목1(E열)이 ㄴ(교집합)에 들어 있는 항목.
function buildRows(dataName, category) {
  const owned = new Set((data.vehicleItems[dataName] || []).map(baseName)); // ㄱ
  const shown = new Set();                                                   // ㄴ (NO 묶음 합계)
  for (const name of owned) {
    for (const no of groupNosByName.get(name) || []) {
      for (const member of groupMembersByNo.get(no) || []) shown.add(member);
    }
  }
  const isShown = (name) => Boolean(name) && shown.has(name);

  // 도장 가능: 5번 DB의 E열 값(좌우 제외)이 이 항목의 동의어 묶음 안에 있을 때
  const paintNames = new Set((data.paintItems[dataName] || []).map(baseName));
  const isPainted = (r) => {
    const key = baseName(r.item);
    if (ALWAYS_PAINT.has(key)) return true;
    const group = synonymIndex.get(key) || new Set([key]);
    return [...group].some((name) => paintNames.has(name));
  };

  return (data[SAMPLE_KEY[category]] || [])
    .filter((r) => isShown(baseName(r.item)))                      // ㄷ ∩ ㄴ (완전 일치)
    .filter((r) => !PAINT_MATCH_ONLY.has(baseName(r.item)) || isPainted(r)) // 도장 DB 매칭 필요
    .map((r) => ({
      part: r.part,
      item: r.item,
      centerWork: r.centerWork,
      centerPaint: r.centerPaint,
      paintable: isPainted(r),
      work: { L: null, R: null, C: null },
      paint: { L: null, R: null, C: null },
      memo: "",         // 기타메모사항 (입력 내용은 화면에만 남는다)
      tip: null,        // 선택한 착안점(복원수리) 문구
    }));
}

// 1. 차량정보 제목을 누르면 상단 배지로 줄고, 배지를 누르면 다시 펼쳐진다
function collapseVehicle() {
  $("vehicle-section").hidden = true;
  const badge = $("vehicle-badge");
  badge.textContent = `1. 차량정보 · ${state.vehicle || ""}`;
  badge.hidden = false;
  alignStickyHeader();
}

function expandVehicle() {
  $("vehicle-section").hidden = false;
  $("vehicle-badge").hidden = true;
  alignStickyHeader();
}

async function openOrder() {
  const name = state.vehicle;
  if (!name) return;
  const forceWrite = writeOnOpen;
  writeOnOpen = false;
  await repairIndexReady;
  // 받은 지 오래된 착안점 목록이면 다시 받는다 (마스터가 고친 내용이 보이도록). 방금 받았으면 그대로 쓴다.
  if (Date.now() - repairLoadedAt > 20000) await loadRepairIndex().catch(() => {});
  expandVehicle();
  const dataName = resolveDataVehicle(name);
  const category = vehicleCategory(vehicleByName.get(name)); // 구분은 선택한 차량명의 4번 파일 그룹값으로 정한다

  state.tipGroup = category.startsWith("화물") ? "2" : "1"; // 착안점 묶음: 1 승용계, 2 화물계
  state.plate = $("plate-input").value.trim();
  state.rows = dataName ? buildRows(dataName, category) : [];

  const info = $("order-info");
  info.innerHTML = "";
  const title = document.createElement("span");
  const b = document.createElement("b");
  b.textContent = name;
  title.appendChild(b);
  // 차량명 · 구분 · 차량번호 (값만 보인다)
  title.appendChild(document.createTextNode(" · "));
  const cat = document.createElement("b");
  cat.textContent = category;
  title.appendChild(cat);
  title.appendChild(document.createTextNode(" · "));
  const plate = document.createElement("b");
  plate.textContent = state.plate || "-";
  title.appendChild(plate);
  info.appendChild(title);
  if (dataName && dataName !== name) {
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = `※ 작업항목은 '${dataName}' 기준입니다.`;
    info.appendChild(sub);
  }

  // 목록에서 열린 저장 자료는 보기 모드로 잠가 두고, 수정 버튼을 눌러야 고칠 수 있다
  state.extras = [];
  state.memoSel = [];
  // 입고일은 작업지시서를 여는 날짜로 고정되고, 출고일·보험사·담보·도장코드는 차량 입력 화면의 값을 쓴다
  state.meta = typeof readMetaFromInput === "function" ? readMetaFromInput() : newOrderMeta();
  // 서버가 안 돼도 작업 화면은 연다: 이 기기에 남은 임시 자료로 채우고, 없으면 빈 칸으로 쓴다
  let source = null;
  try {
    source = await restoreOrder();
  } catch (err) {
    source = null;
  }
  state.locked = source === "server" && !forceWrite;
  state.dirty = false;
  if (typeof showMeta === "function") showMeta(); // 저장된 입고일·출고일 등을 입력 화면 칸에 채운다
  if (typeof renderMemoPicked === "function") renderMemoPicked();
  state.editBase = null;
  $("screen-input").hidden = true;
  $("screen-order").hidden = false;
  window.scrollTo(0, 0);
  renderOrder();
}

// 작업지시서 내용 저장: 차량명 + 차량번호 기준.
// 입력하는 동안은 이 브라우저(IndexedDB)에만 임시 저장하고, '저장' 버튼을 누르면 서버(D1) 목록에 저장한다.
function orderKey() {
  return `order:${state.vehicle}|${state.plate}`;
}

// 저장 형식: { rows: 주작업항목별 값, extras: 일반 작업에서 고른 항목 }
// 새 작업지시서의 기본 메타 (입고일 = 오늘, 한국 시각)
function newOrderMeta() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { inDate: kst, outDate: "", insurer: "", coverage: "", paintCode: "", paintCoats: "" };
}

function currentSnapshot() {
  return {
    rows: state.rows.map((r) => ({
      item: r.item,
      part: r.part,
      work: r.work,
      paint: r.paint,
      memo: r.memo,
      tip: r.tip,
    })),
    extras: [...state.extras],
    meta: { ...state.meta },
    memoSel: [...(state.memoSel || [])],
  };
}

function saveOrder() {
  // 수정 중에는 입력을 이 기기에 자동으로 남기지 않는다 (저장하거나 되돌릴 때 정해진다)
  if (!state.vehicle || state.editBase) return;
  tipDbPut(currentSnapshot(), orderKey()).catch(() => {});
}

// '저장' 버튼: 현재 작업지시서를 서버 목록에 저장한다
function saveToServer() {
  if (!state.vehicle || guardLocked()) return Promise.resolve(false);
  setSyncStatus("저장 중…");
  return sendOrderToServer(state.vehicle, state.plate, currentSnapshot());
}

async function sendOrderToServer(vehicle, plate, snapshot) {
  // 수정 중에 저장했다면 '수정 확인' 대상으로 표시한다
  const revised = Boolean(state.editBase);
  const send = () => fetch("api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ vehicle, plate, rows: snapshot.rows, extras: snapshot.extras, meta: snapshot.meta, memoSel: snapshot.memoSel, revised, marks: buildMarks() }),
  });
  try {
    let res = await send();
    if (res.status === 401 && await ensureLogin()) res = await send();
    if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
    const time = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    setSyncStatus(`서버 저장 완료 ${time}`);
    showNotice("저장되었습니다");
    // 저장이 끝나면 변경 없음으로 보고, 공업사 계정은 다시 보기 모드로 잠근다
    state.dirty = false;
    // 수정 중 바뀐 칸의 녹색 음영은 수정 확인을 누르거나 다시 수정할 때까지 유지한다
    if (!revised) { state.editBase = null; state.editBaseMemo = null; state.editBaseExtras = null; }
    if (revised) {
      // 저장한 녹색 음영을 그대로 이어서 보여 준다 (다시 열어도 유지)
      state.revised = true;
      state.marksMap = new Map(Object.entries(buildMarks()));
      state.editBase = null;
      state.editBaseMemo = null;
      state.editBaseExtras = null;
    }
    if (state.role === "shop") state.locked = true;
    renderOrder();
    return true;
  } catch (err) {
    setSyncStatus("서버 저장 실패 · 연결과 로그인을 확인한 뒤 다시 눌러 주세요");
    return false;
  }
}

function setSyncStatus(text) {
  const el = $("sync-status");
  if (el) el.textContent = text;
}

// 이 브라우저에 없으면 서버에서 같은 차량명·차량번호의 작업지시서를 가져온다
async function fetchServerOrder() {
  try {
    const params = new URLSearchParams({ vehicle: state.vehicle, plate: state.plate });
    // 마스터가 목록에서 열면 그 공업사 것을 보여 준다 (URL 의 shop 값)
    const shop = new URLSearchParams(location.search).get("shop");
    if (shop) params.set("shop", shop);
    const res = await fetchTimed(`api/orders?${params}`, { credentials: "same-origin" });
    if (!res.ok) return null;
    const data = await res.json();
    return { rows: data.rows || [], extras: data.extras || [], revised: Boolean(data.revised), marks: data.marks || {}, meta: data.meta || {}, memoSel: data.memoSel || [], createdAt: data.createdAt || "" };
  } catch (err) {
    return null;
  }
}

// 저장된 자료를 화면에 채운다. 서버에 저장된 작업지시서를 열었으면 "server", 이 기기의 임시 자료면 "local", 없으면 null
async function restoreOrder() {
  // 서버에 저장된 작업지시서가 있으면 그 내용을 우선한다 (목록에서 연 자료는 저장본이 기준)
  let saved = await fetchServerOrder();
  let source = saved ? "server" : null;
  if (!saved) {
    try {
      saved = await tipDbGet(orderKey());
      if (saved) source = "local";
    } catch (err) {
      saved = null;
    }
  }
  if (!saved) return null;

  // 예전 형식(배열)과 새 형식({rows, extras})을 모두 읽는다
  state.revised = source === "server" ? Boolean(saved.revised) : false;
  if (saved.meta && typeof saved.meta === "object" && !Array.isArray(saved)) {
    state.meta = { ...state.meta, ...saved.meta };
  }
  // 입고일이 없는 예전 저장본은 서버의 최초 저장일(생성일)을 입고일로 쓴다
  if (source === "server" && !state.meta.inDate && saved.createdAt) {
    state.meta.inDate = new Date(Date.parse(saved.createdAt) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  state.marksMap = source === "server" ? new Map(Object.entries(saved.marks || {})) : null;
  const rows = Array.isArray(saved) ? saved : saved.rows || [];
  state.extras = Array.isArray(saved) ? [] : saved.extras || [];
  state.memoSel = Array.isArray(saved) ? [] : saved.memoSel || [];
  // 저장본과 현재 목록은 순서가 달라질 수 있다(규칙 변경으로 빠진 항목이 있으면 뒤 행이 밀린다).
  // 그래서 자리 번호가 아니라 파트+주작업항목 이름으로 짝을 맞춘다. 같은 이름이 여러 개면 저장 순서대로 쓴다.
  const savedByKey = new Map();
  for (const old of rows) {
    const key = `${old.part}|${old.item}`;
    if (!savedByKey.has(key)) savedByKey.set(key, []);
    savedByKey.get(key).push(old);
  }
  state.rows.forEach((row) => {
    const queue = savedByKey.get(`${row.part}|${row.item}`);
    const old = queue && queue.length ? queue.shift() : null;
    if (!old) return;
    row.work = old.work;
    row.paint = old.paint;
    row.memo = old.memo || "";
    row.tip = old.tip || null;
  });
  return source;
}

function backToInput() {
  confirmLeave().then((ok) => {
    if (!ok) return;
    state.dirty = false;
    // '보기'로 바로 연 경우 차량정보 화면을 가리는 표시가 남아 있으므로 함께 푼다 (안 풀면 화면이 안 바뀐다)
    document.documentElement.classList.remove("deep-link");
    $("screen-order").hidden = true;
    $("screen-input").hidden = false;
    window.scrollTo(0, 0);
  });
}

// ----- 클릭 동작 -----

// 작업구분 순환: 빈칸 → 교환 → 판금 → 탈착 → 빈칸
const WORK_CYCLE = [null, "교환", "판금", "탈착"];

function workClick(row, side) {
  if (guardLocked()) return;
  const idx = WORK_CYCLE.indexOf(row.work[side]);
  const next = WORK_CYCLE[(idx + 1) % WORK_CYCLE.length];
  row.work[side] = next;
  if (next === "교환") {
    row.paint[side] = row.paintable ? PAINT_EXCHANGE : null;
  } else if (next === "판금") {
    row.paint[side] = row.paintable ? PAINT_SHEET : null;
  } else {
    row.paint[side] = null; // 탈착과 빈칸은 도장을 두지 않는다
  }
  markDirty();
  renderOrder();
}

function paintClick(row, side) {
  if (guardLocked()) return;
  if (!row.paintable || row.work[side] === "탈착") {
    showNotice("도장적용 불가");
    return;
  }
  const idx = PAINT_CYCLE.indexOf(row.paint[side]);
  row.paint[side] = PAINT_CYCLE[(idx + 1) % PAINT_CYCLE.length];
  markDirty();
  renderOrder();
}

// 우클릭(모바일은 2초 누르기): 작업구분이면 도장구분까지, 도장구분이면 도장구분만 해제
function clearCell(row, side, kind) {
  if (guardLocked()) return;
  if (kind === "work") row.work[side] = null;
  row.paint[side] = null;
  markDirty();
  renderOrder();
}

function showNotice(message) {
  $("modal-msg").textContent = message;
  $("modal").hidden = false;
  $("modal-ok").focus();
}

function hideNotice() {
  $("modal").hidden = true;
}

// ----- 그리기 -----

function cellClass(value) {
  if (value === "교환" || value === "교환도장") return "swap";
  if (value === "판금" || value === "표면판금보수" || value === "전면판금보수" || value === "표면보수") return "sheet";
  return ""; // 탈착, 빈칸은 음영 없음
}

function renderOrder() {
  const body = $("order-body");
  body.innerHTML = "";
  const rows = state.rows;
  $("order-empty").hidden = rows.length > 0;
  $("order-empty").textContent = rows.length > 0 ? "" : "이 차량에 해당하는 작업항목이 없습니다.";

  // 파트별 행 수 (세로 병합용)
  const partSpan = new Map();
  rows.forEach((r, i) => {
    if (i === 0 || rows[i - 1].part !== r.part) {
      let n = 0;
      for (let j = i; j < rows.length && rows[j].part === r.part; j++) n++;
      partSpan.set(i, n);
    }
  });

  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    if (partSpan.has(i)) tr.classList.add("part-start");
    if ((i + 1) % 2 === 0) tr.classList.add("stripe"); // 짝수 NO 행 옅은 색

    if (partSpan.has(i)) {
      const td = document.createElement("td");
      td.className = "c-part";
      td.rowSpan = partSpan.get(i);
      td.textContent = row.part.replace(/ /g, ""); // 화면에는 붙여 쓴다 (내부 값은 그대로)
      if (BASE_EXCHANGE[row.part]) td.appendChild(baseExchangeButtons(row.part));
      tr.appendChild(td);
    }

    const no = document.createElement("td");
    no.className = "c-no";
    no.textContent = String(i + 1);
    tr.appendChild(no);

    const item = document.createElement("td");
    item.className = "c-item";
    item.textContent = hideSide(row.item);
    tr.appendChild(item);

    tr.appendChild(makeCells(row, "work", row.centerWork));
    tr.appendChild(makeCells(row, "paint", row.centerPaint));
    tr.appendChild(makeMemoCell(row));
    tr.appendChild(makeTipCell(row));
    body.appendChild(tr);
  });

  renderSummary();
  alignStickyHeader();
  updateLockUI();
  saveOrder();
}

// 기본 교환 버튼: 해당 서스펜션의 6개 항목을 한쪽(좌/우)만 교환으로 바꾼다.
function baseExchangeButtons(part) {
  const box = document.createElement("div");
  box.className = "base-btns";
  [["L", "기본교환(좌)"], ["R", "기본교환(우)"]].forEach(([side, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "base-btn";
    btn.textContent = label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      applyBaseExchange(part, side);
    });
    box.appendChild(btn);
  });
  return box;
}

// 기본 교환(좌/우): 누르면 해당 쪽 값이 모두 교환으로 체크되고, 다시 누르면 모두 해제된다.
function applyBaseExchange(part, side) {
  if (guardLocked()) return;
  const names = new Set(BASE_EXCHANGE[part]);
  const targets = state.rows.filter((r) => r.part === part && names.has(r.item) && !r.centerWork);
  if (targets.length === 0) return;
  const allOn = targets.every((r) => r.work[side] === "교환");
  for (const row of targets) {
    row.work[side] = allOn ? null : "교환";
    row.paint[side] = allOn ? null : (row.paintable ? PAINT_EXCHANGE : null);
  }
  markDirty();
  renderOrder();
}

// 고정 머리글: 1. 차량정보 + 2. 작업지시서 작성 + 표 머리글(파트~도장구분)이 화면 위에 함께 고정된다.
// 두 번째 머리글 줄(좌측/우측)은 첫 줄 바로 아래에 붙도록 위치를 맞춘다.
function alignStickyHeader() {
  const card = document.querySelector(".order-card");
  const rows = document.querySelectorAll("#order-table thead tr");
  if (!card || rows.length < 2) return;
  const cardH = card.offsetHeight;
  rows[0].querySelectorAll("th").forEach((th) => (th.style.top = `${cardH}px`));
  const row2Top = cardH + rows[0].offsetHeight;
  rows[1].querySelectorAll("th").forEach((th) => (th.style.top = `${row2Top}px`));
}

// 작업구분 또는 도장구분 칸(좌/우 또는 가운데)을 만든다.
function makeCells(row, kind, center) {
  const frag = document.createDocumentFragment();
  const keys = center ? ["C"] : ["L", "R"];
  keys.forEach((side) => {
    const td = document.createElement("td");
    const value = row[kind][side];
    td.className = `${kind} ${cellClass(value)}`.trim();
    if (isChanged(row, kind, side)) td.classList.add("changed");
    // 도장구분 칸은 글자 대신 "도장"으로 보인다. 색(교환=빨강, 판금 계열=파랑)으로만 구분한다.
    td.textContent = kind === "paint" && value ? "도장" : value || "";
    if (center) td.colSpan = 2;
    // 묶음의 바깥쪽 칸에 짙은 세로선을 긋는다 (좌/우가 한 칸이면 양쪽 모두)
    if (center || side === "L") td.classList.add("grp-l");
    if (center || side === "R") td.classList.add("grp-r");
    td.title = kind === "work"
      ? "클릭: 교환→판금→빈칸 / 우클릭·2초 누르기: 해제"
      : "클릭: 도장구분 순환 / 우클릭·2초 누르기: 도장만 해제";
    attachCellEvents(td, row, side, kind);
    frag.appendChild(td);
  });
  return frag;
}

// 수정 중에 바뀐 칸인지 (수정을 누른 순간의 값과 다른지)
function isChanged(row, kind, side) {
  // 수정 확인 전이면 저장해 둔 녹색 음영은 그대로 유지한다 (다시 수정을 눌러도 빨강·파랑으로 바뀌지 않는다)
  if (state.revised && isMarked(row, kind, side)) return true;
  if (state.editBase) {
    const base = state.editBase.get(row);
    if (!base) return false;
    return (row[kind][side] || null) !== (base[kind][side] || null);
  }
  return false;
}

function markKey(row) {
  return `${row.part}|${row.item}`;
}

function isMarked(row, kind, side) {
  const m = state.marksMap && state.marksMap.get(markKey(row));
  return Boolean(m && m[kind] && m[kind][side]);
}

function isMemoMarked(row) {
  if (state.revised && state.marksMap && state.marksMap.get(markKey(row))?.memo) return true;
  if (state.editBase) return (state.editBase.get(row)?.memo || "") !== (row.memo || "");
  return false;
}

// 수정 중 바뀐 칸 목록 (저장할 때 함께 보낸다)
function buildMarks() {
  const marks = {};
  for (const row of state.rows) {
    const m = { work: {}, paint: {}, memo: false };
    let any = false;
    for (const side of ["L", "R", "C"]) {
      if (isChanged(row, "work", side)) { m.work[side] = true; any = true; }
      if (isChanged(row, "paint", side)) { m.paint[side] = true; any = true; }
    }
    if (isMemoMarked(row)) { m.memo = true; any = true; }
    if (any) marks[markKey(row)] = m;
  }
  // 추가된 일반·기타메모 항목도 저장한다 (수정 확인 전까지 녹색으로 보인다)
  const keep = (key) => (state.revised && state.marksMap ? state.marksMap.get(key) || [] : []);
  const extrasAdded = [...new Set([...keep("__extras"), ...currentAddedExtras()])];
  const memoAdded = [...new Set([...keep("__memo"), ...currentAddedMemo()])];
  if (extrasAdded.length) marks.__extras = extrasAdded;
  if (memoAdded.length) marks.__memo = memoAdded;
  return marks;
}

// 길게 누르기로 해제한 직후에는 따라오는 클릭을 무시한다.
// (해제하면 칸이 다시 그려져 클릭 대상이 바뀌므로 칸 단위 플래그 대신 시간으로 막는다)
let suppressClickUntil = 0;

// 클릭, 우클릭, 길게 누르기(2초) 처리
function attachCellEvents(td, row, side, kind) {
  let timer = null;

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };

  td.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    cancel();
    timer = setTimeout(() => {
      suppressClickUntil = Date.now() + 600;
      clearCell(row, side, kind);
    }, LONG_PRESS_MS);
  });
  td.addEventListener("pointerup", cancel);
  td.addEventListener("pointerleave", cancel);
  td.addEventListener("pointercancel", cancel);

  td.addEventListener("click", () => {
    if (Date.now() < suppressClickUntil) return;
    if (kind === "work") workClick(row, side);
    else paintClick(row, side);
  });

  td.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    cancel();
    clearCell(row, side, kind);
  });
}

// 요약 한 줄 형식: 항목명(좌/우)_작업(도장)
// 예) 프런트펜더(좌)_교환(표면판금보수), 후드_판금(표면판금보수)
function summaryLine(row, side) {
  const name = row.centerWork ? row.item : `${row.item}${side === "L" ? "(좌)" : "(우)"}`;
  const work = row.work[side];
  const paint = row.paint[side];
  return paint ? `${name}_${work}(${paint})` : `${name}_${work}`;
}

// 항목 사이의 "|": 맨 앞에는 없고, 줄 끝에 걸리면 생략한다 (줄이 바뀌는 항목 앞·뒤의 구분선은 뺀다)
function layoutSummarySeparators() {
  const items = [...document.querySelectorAll("#summary-list li.sum-item")];
  items.forEach((li, i) => {
    const next = items[i + 1];
    let sep = li.querySelector(".sum-sep");
    if (!next) {
      if (sep) sep.remove();
      return;
    }
    if (!sep) {
      sep = document.createElement("span");
      sep.className = "sum-sep";
      sep.textContent = "|";
      li.appendChild(sep);
    }
    // 다음 항목이 다른 줄에서 시작하면 이 줄 끝의 구분선은 생략
    sep.hidden = next.offsetTop !== li.offsetTop;
  });
  layoutSummaryCollapse();
}

// 작업 요약은 평소에 4줄까지만 보이고, 누르면 전체가 펼쳐진다 (다시 누르면 접힌다)
const SUMMARY_LINES = 4;
function layoutSummaryCollapse() {
  const box = $("summary");
  const list = $("summary-list");
  if (!box || !list) return;
  list.style.maxHeight = "";
  list.style.overflow = "";
  // 줄 위치는 화면에서 잰 값으로 본다 (offsetTop 은 기준 칸이 달라 어긋날 수 있다)
  const items = [...list.querySelectorAll("li.sum-item")];
  const rects = items.map((li) => li.getBoundingClientRect());
  const tops = [...new Set(rects.map((r) => Math.round(r.top)))].sort((a, b) => a - b);
  const fold = tops.length > SUMMARY_LINES && !box.classList.contains("expanded");
  box.classList.toggle("sum-fold", tops.length > SUMMARY_LINES); // 접을 수 있을 때만 '누르면 전체 보기' 표시
  if (!fold) return;
  const cutTop = tops[SUMMARY_LINES - 1];
  const listTop = list.getBoundingClientRect().top;
  const bottom = Math.max(...rects.filter((r) => Math.round(r.top) <= cutTop).map((r) => r.bottom)) - listTop;
  list.style.maxHeight = `${Math.ceil(bottom)}px`;
  list.style.overflow = "hidden";
}

function renderSummary() {
  const list = $("summary-list");
  const box = $("summary");
  list.innerHTML = "";
  let exchange = 0;
  let sheet = 0;
  let removal = 0;

  for (const row of state.rows) {
    for (const side of row.centerWork ? ["C"] : ["L", "R"]) {
      const w = row.work[side];
      if (!w) continue;
      if (w === "교환") exchange++;
      else if (w === "판금") sheet++;
      else if (w) removal++;

      // 표기: 프런트범퍼커버_교환  — 작업 글자는 빨강·파랑·회색. 도장 값은 요약에서 뺀다. 항목 사이는 "  |  "
      // 항목 전체 색: 교환은 빨강, 판금은 파랑, 그 밖은 회색 (글자는 굵게 하지 않는다)
      const li = document.createElement("li");
      li.className = `sum-item ${w === "교환" ? "red" : w === "판금" ? "blue" : "gray"}`;

      const name = document.createElement("span");
      name.className = "sum-name";
      name.textContent = row.centerWork ? row.item : `${row.item}${side === "L" ? "(좌)" : "(우)"}`;
      li.appendChild(name);
      li.appendChild(document.createTextNode("_"));
      const work = document.createElement("span");
      work.className = `sum-work ${w === "교환" ? "red" : w === "판금" ? "blue" : "gray"}`;
      work.textContent = w;
      li.appendChild(work);
      list.appendChild(li);
    }
  }

  // 작업 요약 오른쪽에 건수를 괄호로 표기
  $("summary-count").innerHTML = `(<span class="c-ex">교환 ${exchange}건</span> / <span class="c-sh">판금 ${sheet}건</span> / <span class="c-rm">탈착 ${removal}건</span>)`;
  // 값이 없으면 작업 요약은 보이지 않는다
  box.hidden = list.children.length === 0;
  layoutSummarySeparators(); // 보이게 된 뒤에 줄 위치를 재서 구분선을 정한다
}



// ---------- 착안점(복원수리) 자료 ----------
// 엑셀(NO, 주작업항목, 복원수리, 이미지매칭)과 그림 파일을 이 브라우저(IndexedDB)에 저장한다.
// 저장된 자료는 이 기기에서만 보인다.
const DB_NAME = "workorder-tips";
const DB_STORE = "kv";
const DB_KEY = "tips";
const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

let tipData = { rows: [], images: {} };   // rows: {item, repair, imageId}, images: {소문자이름: Blob}
let xlsxLoading = null;

function openTipDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tipDbGet(key = DB_KEY) {
  const db = await openTipDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE).objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function tipDbPut(value, key = DB_KEY) {
  const db = await openTipDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxLoading) {
    xlsxLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = XLSX_URL;
      script.onload = () => resolve(window.XLSX);
      script.onerror = () => {
        xlsxLoading = null;
        reject(new Error("엑셀 읽기 엔진을 불러오지 못했습니다. 인터넷 연결을 확인하세요."));
      };
      document.head.appendChild(script);
    });
  }
  return xlsxLoading;
}

function imageKey(name) {
  return String(name).trim().toLowerCase();
}

function excelText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

async function saveTipData() {
  const status = $("tip-status");
  status.hidden = false;
  status.className = "notice ok";
  status.textContent = "자료를 읽는 중입니다...";
  try {
    const excelFile = $("tip-excel").files[0];
    if (!excelFile) throw new Error("엑셀 파일을 먼저 선택하세요.");

    const XLSX = await loadXlsx();
    const book = XLSX.read(await excelFile.arrayBuffer(), { type: "array" });
    const sheet = book.Sheets[book.SheetNames[0]];
    const table = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const rows = table
      .map((r) => ({
        item: excelText(r["주작업항목"]),
        repair: excelText(r["복원수리"]),
        imageId: excelText(r["이미지매칭"]),
      }))
      .filter((r) => r.item && r.repair);
    if (rows.length === 0) {
      throw new Error("엑셀에서 '주작업항목'과 '복원수리' 열을 찾지 못했습니다.");
    }

    const images = {};
    for (const file of $("tip-images").files) {
      const key = imageKey(file.name.replace(/\.[^.]+$/, ""));
      images[key] = file;
    }

    tipData = { rows, images };
    await tipDbPut(tipData);

    const missing = [...new Set(rows.map((r) => r.imageId).filter((id) => id && !images[imageKey(id)]))];
    status.textContent = `저장 완료: 엑셀 ${rows.length}행, 그림 ${Object.keys(images).length}개`
      + (missing.length ? ` · 그림이 없는 이미지매칭: ${missing.join(", ")}` : "");
  } catch (err) {
    status.className = "notice";
    status.textContent = err.message;
  }
}

async function loadTipData() {
  try {
    const saved = await tipDbGet();
    if (saved) tipData = saved;
  } catch (err) {
    // 저장소를 쓸 수 없으면 자료 없이 진행한다
  }
  const status = $("tip-status");
  if (status && tipData.rows.length) {
    status.hidden = false;
    status.className = "notice ok";
    status.textContent = `저장된 자료: 엑셀 ${tipData.rows.length}행, 그림 ${Object.keys(tipData.images).length}개`;
  }
}

// 보기 목록: 서버의 매핑 시트 작업내역(마스터가 고친 최종 내용). 서버 목록을 못 받은 때에만 이 기기의 자료를 쓴다.
function tipsFor(item) {
  const key = baseName(item);
  const built = repairIndex[state.tipGroup].get(key);
  if (built && built.length) return built;
  if (repairFromServer) return [];
  return tipData.rows
    .filter((r) => baseName(r.item) === key)
    .map((r) => ({ repair: r.repair, imageId: r.imageId }));
}

function hasTipImage(option) {
  return Boolean(option.imageSrc || tipData.images[imageKey(option.imageId)]);
}

function makeMemoCell(row) {
  const td = document.createElement("td");
  td.className = "c-memo";
  if (isMemoMarked(row)) td.classList.add("changed");
  const box = document.createElement("textarea");
  box.className = "memo-input";
  box.rows = 1;
  box.value = row.memo;
  // 입력 중에는 화면을 다시 그리지 않아야 커서가 유지된다
  // 보기 모드에서는 기타메모도 잠긴다: 누르면 수정 안내만 나온다
  box.readOnly = state.locked;
  box.addEventListener("mousedown", (e) => {
    if (state.locked) {
      e.preventDefault();
      guardLocked();
    }
  });
  // 칸 높이는 고정이다 (글이 길면 칸 안에서 스크롤). 글 길이에 따라 행 높이가 달라지지 않게 한다
  const fit = () => {};
  box.addEventListener("input", () => {
    row.memo = box.value;
    markDirty();
    td.classList.toggle("changed", isMemoMarked(row));
    // 입력한 글을 바로 '2) 기타메모사항' 줄(일반 아래, 기타메모사항 버튼 오른쪽)에도 보여 준다
    if (typeof renderMemoPicked === "function") renderMemoPicked();
    fit();
  });
  requestAnimationFrame(fit);
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); // 한 줄 메모: 엔터는 저장만 한다
      box.blur();
    }
  });
  box.addEventListener("change", saveOrder);

  td.appendChild(box);
  return td;
}

function makeTipCell(row) {
  const td = document.createElement("td");
  td.className = "c-tip";

  // 작업내역이 없는 항목은 보기 버튼을 두지 않는다
  if (tipsFor(row.item).length > 0) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "tip-open";
    open.textContent = "보기";
    open.addEventListener("click", () => openTipPicker(row));
    td.appendChild(open);
  }

  if (row.tip) {
    const value = document.createElement("div");
    value.className = "tip-value";
    value.textContent = hideSide(row.tip);
    td.appendChild(value);
  }
  return td;
}

// 보기 팝업: 주작업항목의 작업내역 목록을 띄운다 (표 안에 펼치지 않아 표가 어지럽지 않다)
// 그림 주소: 배포 버전을 붙여 두면 같은 버전 안에서는 캐시가 쓰이고, 새 배포 때 새로 받는다
function imageUrl(src) {
  const v = typeof APP_VERSION === "string" ? APP_VERSION : "1";
  return `${src}?v=${encodeURIComponent(v)}`;
}

function openTipPicker(row) {
  const modal = $("tip-pick");
  const body = $("tip-pick-body");
  const options = tipsFor(row.item);
  // 등록된 착안점이 없는 항목은 '보기' 단추가 없다 (makeTipCell). 그래도 열리면 빈 팝업을 띄우지 않는다
  if (options.length === 0) return;
  // 그림을 미리 받아 둔다: '이미지 보기'를 누르면 바로 나온다.
  // 주소를 항상 같게 두어 브라우저 캐시가 쓰이게 한다 (예전에는 열 때마다 새 주소라 매번 다시 받았다)
  options.forEach((opt) => {
    if (opt.imageSrc) {
      opt.bust = imageUrl(opt.imageSrc);
      const pre = new Image();
      pre.src = opt.bust;
    }
  });
  $("tip-pick-title").textContent = `${hideSide(row.item)} · 작업내역`;
  body.innerHTML = "";
  options.forEach((opt) => {
    // 왼쪽: 작업내역 (누르면 착안점으로 선택) / 오른쪽: 이미지 보기
    const tr = document.createElement("tr");
    const text = document.createElement("td");
    text.className = "tip-text";
    text.textContent = hideSide(opt.repair);
    text.addEventListener("click", () => chooseTip(row, opt));
    const pic = document.createElement("td");
    pic.className = "tip-pic-cell";
    if (hasTipImage(opt)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tip-pic";
      btn.textContent = "이미지 보기";
      btn.addEventListener("click", () => showTipImage(opt));
      pic.appendChild(btn);
    }
    tr.append(text, pic);
    body.appendChild(tr);
  });
  modal.hidden = false;
}

function hideTipPicker() {
  $("tip-pick").hidden = true;
}

// 작업내역을 고르면 착안점으로 적힌다 (그림은 팝업의 '이미지 보기'로 연다)
function chooseTip(row, option) {
  if (guardLocked()) return;
  row.tip = option.repair;
  markDirty();
  hideTipPicker();
  renderOrder();
}

function showTipImage(option) {
  const modal = $("tip-modal");
  const img = $("tip-image");
  const caption = $("tip-caption");
  const blob = option.imageSrc ? null : tipData.images[imageKey(option.imageId)];
  caption.textContent = hideSide(option.repair);
  if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
  if (option.imageSrc || blob) {
    // 서버 그림은 미리 받아 둔 같은 주소를 쓴다 (캐시에서 바로 나온다). 배포 버전이 바뀌면 주소도 바뀌어 새로 받는다
    img.src = option.imageSrc
      ? (option.bust || imageUrl(option.imageSrc))
      : URL.createObjectURL(blob);
    img.hidden = false;
    modal.classList.add("full"); // 그림 팝업은 화면을 꽉 채운다
    tipZoom = 1; // 새 그림은 원래 크기로 연다
    tipPanX = 0;
    tipPanY = 0;
    applyTipZoom();
  } else {
    img.removeAttribute("src");
    img.hidden = true;
  }
  modal.hidden = false;
}

function hideTipImage() {
  $("tip-modal").hidden = true;
}

// ---------- 착안점 그림 확대·축소: 그림만 바뀌고 뒤의 목록 크기는 그대로 ----------
let tipZoom = 1;
// 확대된 그림의 위치(가로·세로 이동). 확대 중에는 끌어서 옮긴다
let tipPanX = 0;
let tipPanY = 0;
let suppressTipClick = false;
const tipPointers = new Map();
let tipPinchStart = 0;
let tipZoomStart = 1;
let tipDrag = null; // { x, y, panX, panY, moved } 한 손가락 끌기 중
let tipPinchMid = null; // 두 손가락 가운데 (처음)
let tipPinchOffset = { x: 0, y: 0 }; // 그 가운데가 그림 상자 가운데에서 떨어진 거리
let tipPanStart = { x: 0, y: 0 };
// 화면 좌표 점이 그림 상자 가운데에서 얼마나 떨어져 있는지
function tipBoxOffset(point) {
  const box = document.querySelector("#tip-modal .tip-box");
  if (!box) return { x: 0, y: 0 };
  const r = box.getBoundingClientRect();
  return { x: point.x - (r.left + r.width / 2), y: point.y - (r.top + r.height / 2) };
}
function clampTipPan() {
  const box = document.querySelector("#tip-modal .tip-box");
  if (!box) return;
  // 그림이 화면 밖으로 너무 멀리 나가지 않도록, 확대한 만큼만 움직인다
  const maxX = (box.clientWidth * (tipZoom - 1)) / 2;
  const maxY = (box.clientHeight * (tipZoom - 1)) / 2;
  tipPanX = Math.min(maxX, Math.max(-maxX, tipPanX));
  tipPanY = Math.min(maxY, Math.max(-maxY, tipPanY));
}
function applyTipZoom() {
  const img = $("tip-image");
  if (!img) return;
  tipZoom = Math.min(6, Math.max(1, tipZoom));
  if (tipZoom === 1) { tipPanX = 0; tipPanY = 0; }
  clampTipPan();
  img.style.transform = `translate(${tipPanX}px, ${tipPanY}px) scale(${tipZoom})`;
  img.style.cursor = tipZoom > 1 ? "grab" : "";
  const label = $("tip-zoom-reset");
  if (label) label.textContent = `${Math.round(tipZoom * 100)}%`;
}
function setupTipZoom() {
  const box = document.querySelector("#tip-modal .tip-box");
  const img = $("tip-image");
  if (!box || !img) return;
  const stop = (e) => e.stopPropagation();
  $("tip-zoom-in").addEventListener("click", (e) => { stop(e); tipZoom *= 1.25; applyTipZoom(); });
  $("tip-zoom-out").addEventListener("click", (e) => { stop(e); tipZoom /= 1.25; applyTipZoom(); });
  $("tip-zoom-reset").addEventListener("click", (e) => { stop(e); tipZoom = 1; applyTipZoom(); });
  box.querySelector(".tip-zoom").addEventListener("click", stop);
  // 마우스 휠 (PC): 그림 위에서 휠을 굴리면 확대·축소
  img.addEventListener("wheel", (e) => {
    e.preventDefault();
    tipZoom *= e.deltaY < 0 ? 1.1 : 1 / 1.1;
    applyTipZoom();
  }, { passive: false });
  // 두 손가락 (휴대폰): 그림만 확대·축소한다
  img.addEventListener("pointerdown", (e) => {
    tipPointers.set(e.pointerId, e);
    if (tipPointers.size === 1 && tipZoom > 1) {
      // 확대된 상태에서 한 손가락(마우스)으로 누르면 그림을 끌 수 있다
      tipDrag = { x: e.clientX, y: e.clientY, panX: tipPanX, panY: tipPanY, moved: false };
      try { img.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    }
    // 손가락을 대는 동안에는 애니메이션을 끄고 손가락을 바로 따라간다
    img.style.transition = "none";
    if (tipPointers.size === 2) {
      tipDrag = null;
      const [a, b] = [...tipPointers.values()];
      tipPinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      tipZoomStart = tipZoom;
      // 두 손가락 사이 가운데를 기준점으로 잡는다 (그 자리가 확대·축소 뒤에도 그대로 머문다)
      tipPinchMid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
      tipPinchOffset = tipBoxOffset(tipPinchMid);
      tipPanStart = { x: tipPanX, y: tipPanY };
    }
  });
  img.addEventListener("pointermove", (e) => {
    if (!tipPointers.has(e.pointerId)) return;
    tipPointers.set(e.pointerId, e);
    if (tipPointers.size === 2 && tipPinchStart > 0) {
      const [a, b] = [...tipPointers.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const z = Math.min(6, Math.max(1, tipZoomStart * (d / tipPinchStart)));
      const ratio = z / tipZoomStart;
      // 처음 기준점(가운데)이 손가락 가운데를 계속 따라가도록 이동 값을 정한다 (확대·축소가 손가락 자리에서 일어난다)
      const mid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
      const now = tipBoxOffset(mid);
      tipPanX = now.x - (tipPinchOffset.x - tipPanStart.x) * ratio;
      tipPanY = now.y - (tipPinchOffset.y - tipPanStart.y) * ratio;
      tipZoom = z;
      applyTipZoom();
      suppressTipClick = true;
    } else if (tipPointers.size === 1 && tipDrag && tipZoom > 1) {
      const dx = e.clientX - tipDrag.x;
      const dy = e.clientY - tipDrag.y;
      if (!tipDrag.moved && Math.hypot(dx, dy) < 4) return;
      tipDrag.moved = true;
      tipPanX = tipDrag.panX + dx;
      tipPanY = tipDrag.panY + dy;
      applyTipZoom();
      suppressTipClick = true; // 끈 뒤의 손 떼기는 닫기로 보지 않는다
    }
  });
  const endPointer = (e) => {
    tipPointers.delete(e.pointerId);
    if (tipPointers.size < 2) tipPinchStart = 0;
    if (tipPointers.size === 0) { tipDrag = null; img.style.transition = ""; }
  };
  img.addEventListener("pointerup", endPointer);
  img.addEventListener("pointercancel", endPointer);
}

function setupTips() {
  if ($("tip-save")) $("tip-save").addEventListener("click", saveTipData);
  setupTipZoom();
  $("tip-modal").addEventListener("click", (e) => {
    // 확대·축소(두 손가락)를 한 뒤의 손 떼기는 닫기로 보지 않는다
    if (suppressTipClick) { suppressTipClick = false; return; }
    hideTipImage();
  });
  $("tip-pick-close").addEventListener("click", hideTipPicker);
  // 팝업 어디를 누르든(바깥, 내용, 이미지 보기 등) 닫힌다. '닫기' 버튼은 그대로 둔다
  $("tip-pick").addEventListener("click", (e) => {
    // '이미지 보기' 버튼을 누른 경우에는 목록 팝업을 닫지 않는다 (그림 팝업만 열린다)
    if (e.target.closest(".tip-pic")) return;
    hideTipPicker();
  });
  loadTipData();
}

// ---------- 시작 ----------

function init() {
  // 처음 열 때 로그인 화면을 먼저 띄운다 (공업사·마스터 모두 아이디와 비밀번호로 들어온다)
  // 목록을 5초 안에 못 받아도 기다리지 않고 열린다 (data.js 자료로 연다)
  repairIndexReady = Promise.race([
    ensureLogin().then(loadRepairIndex),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  window.addEventListener("resize", () => { alignStickyHeader(); layoutSummarySeparators(); });
  setupHeader();
  setupInput();
  setupTips();
  $("back-input").addEventListener("click", backToInput);
  $("vehicle-title").addEventListener("click", collapseVehicle);
  $("vehicle-badge").addEventListener("click", expandVehicle);
  $("print-order").addEventListener("click", () => printOrder()); // print.js 는 app.js 뒤에 읽히므로 눌릴 때 찾는다
  $("modal-ok").addEventListener("click", hideNotice);
  $("modal").addEventListener("click", (e) => {
    if (e.target === $("modal")) hideNotice();
  });

  $("save-order").addEventListener("click", saveToServer);

  // 작업지시서 목록에서 '보기'로 들어오면 차량명·차량번호를 채우고 바로 연다
  const params = new URLSearchParams(location.search);
  // 마스터(보기 전용)는 저장 버튼을 쓰지 않는다
  getSession().then((s) => {
    if (!s.ok) return;
    state.role = s.role;
    state.shopName = s.role === "shop" ? (s.name || "") : "";
    // 우측 상단에 공업사명을 보인다 (공업사 계정)
    if (s.role === "shop" && s.name) {
      const shopEl = $("shop-name");
      shopEl.textContent = s.name;
      shopEl.hidden = false;
    }
    if (s.role !== "shop") $("save-order").hidden = true;
    if (s.role === "master") $("settings-link").hidden = false;
    if (s.role === "master") $("settings-icon").hidden = false;
    updateLockUI();
  });
  setupOrderTools();

  const deepVehicle = params.get("vehicle");
  if (deepVehicle && !vehicleByName.get(deepVehicle)) document.documentElement.classList.remove("deep-link");
  if (deepVehicle && vehicleByName.get(deepVehicle)) {
    // 목록의 '보기': 차량정보 화면을 거치지 않고 바로 작업지시서를 연다
    $("screen-input").hidden = true;
    pickVehicle(deepVehicle);
    $("plate-input").value = params.get("plate") || "";
    writeOnOpen = params.get("write") === "1";
    openOrder().then(() => {
      if (!isOrderOpen()) {
        // 열지 못했으면 차량정보 화면으로 돌아간다
        document.documentElement.classList.remove("deep-link");
        $("screen-input").hidden = false;
      }
      // 확인용: ?preview=print 이면 인쇄물을 화면에 펼쳐 보여 준다 (인쇄 버튼과 같은 내용)
      if (params.get("preview") === "print") openPrintPreview();
    });
  }
}

init();

// 차량정보 입력에서 빠진 값 목록 (작업지시서 보기 전에 확인한다)
function missingVehicleFields() {
  const missing = [];
  if (!state.vehicle) missing.push("차량명");
  if (!$("plate-input").value.trim()) missing.push("차량번호");
  const inDate = $("in-date").value.trim();
  if (!inDate || inDate === "-") missing.push("입고일");
  if (!$("out-date").value.trim()) missing.push("출고일");
  if (!$("insurer").value) missing.push("보험사");
  if (!$("coverage").value) missing.push("담보");
  if (!$("paint-code").value.trim()) missing.push("도장코드");
  return missing;
}
