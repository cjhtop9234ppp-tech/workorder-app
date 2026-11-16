// 작업지시서 목록: 검색과 페이지 나누기는 서버에서 한다 (목록에는 요약만 온다).
// 서버 API: GET api/orders?page=&size=&from=&to=&q_shop=&plate=&q_vehicle= (로그인 필요)

const PAGE_SIZE = 50;

const rowsEl = document.getElementById("rows");
const statusEl = document.getElementById("status");
const pagerEl = document.getElementById("pager");
const formEl = document.getElementById("search-form");
const dateFromEl = document.getElementById("date-from");
const dateToEl = document.getElementById("date-to");
const dateKindEl = document.getElementById("date-kind");
const shopEl = document.getElementById("shop-q");
const insurerEl = document.getElementById("insurer-q");
const coverageEl = document.getElementById("coverage-q");
const plateEl = document.getElementById("plate-q");
const vehicleEl = document.getElementById("vehicle-q");
const paintEl = document.getElementById("paint-q");
const whoEl = document.getElementById("who");
const logoutEl = document.getElementById("logout");

document.getElementById("ver").textContent =
  typeof APP_VERSION === "string" ? `v${APP_VERSION}` : "";

let role = null;
let query = {};

// 서버에서 목록을 받아 온다 (로그인이 필요하면 입력창을 띄운다)
async function fetchJson(path) {
  const request = () => fetch(path, { credentials: "same-origin" });
  let res = await request();
  if (res.status === 401 && await ensureLogin()) {
    await refreshRole(); // 이 화면에서 로그인한 계정의 역할(마스터·공업사)을 다시 읽는다
    res = await request();
  }
  return res;
}

// 로그인 후 역할과 표시 상태를 맞춘다
async function refreshRole() {
  const session = await getSession();
  if (!session.ok) return;
  role = session.role;
  whoEl.textContent = session.role === "master" ? "마스터" : session.name;
  logoutEl.hidden = false;
  document.getElementById("settings-link").hidden = role !== "master";
  applyShopVisibility();
}

// 날짜 입력: 2026-05-02, 2026.5.2, 20260502 모두 받아서 YYYY-MM-DD 로 맞춘다. 맞지 않으면 빈 값
function normalizeDate(text) {
  const m = String(text || "").trim().match(/^(\d{4})\D?(\d{1,2})\D?(\d{1,2})$/);
  if (!m) return "";
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

[dateFromEl, dateToEl].forEach((el) => {
  el.addEventListener("blur", () => {
    if (el.value.trim()) el.value = normalizeDate(el.value) || "";
  });
});

// 생성일은 서버 시각(UTC)을 한국 날짜로 바꿔 YYYY-MM-DD 로 본다
function dateKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// '보기' 링크: 마스터는 어느 공업사 것인지 함께 넘긴다
function linkTo(order, write = false) {
  const params = new URLSearchParams({ vehicle: order.vehicle, plate: order.plate });
  if (role === "master") params.set("shop", order.shopId);
  if (write) params.set("write", "1"); // '작성': 아직 작업 내용이 없는 작업지시서를 바로 고칠 수 있게 연다
  return `index.html?${params}`;
}

// 목록 정렬: 생성일(기본) · 입고일 · 출고일. 머리글을 누르면 오름차순·내림차순이 바뀐다.
let sortKey = "created";
let sortDir = "desc";
function setupSortHeaders() {
  const ths = document.querySelectorAll("table.orders thead th");
  ths.forEach((th) => {
    const key = { 입고일: "inDate", 출고일: "outDate" }[th.textContent.trim()];
    if (!key) return;
    th.classList.add("sortable");
    th.addEventListener("click", () => {
      if (sortKey === key) sortDir = sortDir === "desc" ? "asc" : "desc";
      else { sortKey = key; sortDir = "desc"; }
      paintSortHeaders();
      load(1);
    });
  });
  paintSortHeaders();
}
function paintSortHeaders() {
  document.querySelectorAll("table.orders thead th").forEach((th) => {
    const key = { 입고일: "inDate", 출고일: "outDate" }[th.textContent.trim()];
    if (!key) return;
    th.classList.toggle("sort-asc", sortKey === key && sortDir === "asc");
    th.classList.toggle("sort-desc", sortKey === key && sortDir === "desc");
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupSortHeaders);
else setupSortHeaders();

// '보기'는 목록 화면을 바꾸지 않고 별도의 창(팝업)으로 작업지시서를 연다.
// 팝업이 막히면 기존처럼 이 화면을 바꾼다.
const ORDER_WINDOW_NAME = "workorder-view";
// 높이는 화면 높이에 맞춘다 (위아래를 넓게 쓴다). 폭은 1100.
// 창은 모니터 가운데에 뜨도록 위치를 계산한다 (주 모니터 기준).
function orderWindowFeatures() {
  const scr = window.screen;
  const areaW = scr.availWidth || 1280;
  const areaH = scr.availHeight || 900;
  const width = Math.min(1100, areaW);
  const height = Math.min(Math.max(860, Math.round(areaH * 0.95)), areaH);
  const left = (scr.availLeft || 0) + Math.max(0, Math.round((areaW - width) / 2));
  const top = (scr.availTop || 0) + Math.max(0, Math.round((areaH - height) / 2));
  return `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
}
function openOrderWindow(href) {
  const win = window.open(href, ORDER_WINDOW_NAME, orderWindowFeatures());
  if (win) win.focus();
  else location.href = href;
}

// 목록에서 보험사·담보는 쉼표 없이 띄어서 보인다 ("삼성, 현대" → "삼성 현대")
function listText(value) {
  const parts = String(value || "").split(",").map((t) => t.trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : "-";
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

// 공업사명 검색칸과 공업사명 열은 마스터 계정에만 보인다
function isMaster() {
  return role === "master";
}

function applyShopVisibility() {
  const show = isMaster();
  shopEl.closest("label").hidden = !show;
  // 표 머리글 중 공업사명(다섯 번째 칸)
  // 휴대폰 공업사 화면만 감춘다 (PC 공업사 화면은 마스터와 같은 열을 보인다)
  document.querySelectorAll("table.orders thead th")[4].hidden = !(show || !isPhoneWidth());
}

// 휴대폰 화면 판단과 짧은 날짜 (26-11-06)
const isPhoneWidth = () => window.matchMedia("(max-width: 1000px)").matches;
const isPhoneShop = () => role === "shop" && isPhoneWidth();
function shortDay(v) {
  const t = String(v || "");
  return t ? t.replace(/^20(\d\d)-/, "$1-") : "-";
}
function dayText(v) {
  return isPhoneWidth() ? shortDay(v) : (v || "-");
}
// 날짜 칸: 첫 줄 날짜, 둘째 줄 요일 (휴대폰은 11/6, PC는 2026-11-06)
function weekdayKo(v) {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return ["일", "월", "화", "수", "목", "금", "토"][new Date(`${v}T00:00:00+09:00`).getDay()];
}
function dayCell(v) {
  const td = cell("");
  const t = String(v || "");
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) { td.textContent = "-"; return td; }
  const l1 = document.createElement("span");
  // PC: 연도 네 자리 중 뒤 두 자리만 (2026-11-06 → 26-11-06), 휴대폰은 기존 표기
  l1.textContent = isPhoneWidth() ? `${+m[2]}/${+m[3]}` : t.slice(2);
  const l2 = document.createElement("span");
  l2.className = "wk-line";
  l2.textContent = `(${weekdayKo(t)})`;
  td.append(l1, l2);
  return td;
}
// 대표정보보기: 가장 많은 파트명(첫 줄)과 작업요약 개수(둘째 줄). 파트명을 누르면 작업요약을 펼쳐 보인다
function repCell(order) {
  const td = cell("-");
  if (!order.repPart) return td;
  td.textContent = "";
  const part = document.createElement("span");
  part.className = "rep-part";
  // 띄어쓰기 앞은 첫 행, 띄어쓰기 뒤는 아래 행 (예: 프런트 / 서스펜션)
  const words = String(order.repPart).trim().split(/\s+/);
  part.append(words[0]);
  if (words.length > 1) {
    part.append(document.createElement("br"), words.slice(1).join(" "));
  }
  part.title = "눌러서 작업요약 보기";
  part.addEventListener("click", (e) => { e.stopPropagation(); toggleRepPopup(order, td); });
  const count = document.createElement("span");
  count.className = "rep-count";
  count.textContent = `(${order.repCount})`;
  td.append(part, count);
  return td;
}
// 작업요약 팝업: 화면의 작업 요약과 같은 글자 색 (교환 빨강, 판금 파랑, 그 밖 회색). 다시 누르면 사라진다
// 팝업 크기: 지금까지 팝업된 값 중 가장 큰 가로·세로를 모든 팝업에 똑같이 적용한다 (고정)
const repPopupSize = { w: 0, h: 0 };
function toggleRepPopup(order, anchor) {
  const old = document.querySelector(".rep-popup");
  if (old) { closeRepPopup(); return; }
  const box = document.createElement("div");
  box.className = "rep-popup";
  // (1) 일반
  const secTitle = (text) => {
    const p = document.createElement("p");
    p.className = "rep-sec-title";
    p.textContent = text;
    return p;
  };
  // 일반·기타메모: 왼쪽에 구분 칩(일반·기타메모사항), 오른쪽에 입력값을 "|"로 이어 한 줄에 보인다
  // 일반 값은 파란색, 기타메모 값은 녹색 (작업지시서 작성 화면과 같은 색)
  // 수정으로 더한 항목은 녹색 (수정 확인 전 · 저장된 녹색 표시와 같다)
  const addedList = (kind) => (order.revised ? (kind === "gen" ? order.addedGeneral : order.addedMemos) || [] : []);
  const chipLine = (label, items, kind) => {
    const added = addedList(kind);
    const line = document.createElement("div");
    line.className = "rep-line";
    const chip = document.createElement("span");
    chip.className = `rep-chip ${kind}`;
    chip.textContent = label;
    line.appendChild(chip);
    const vals = document.createElement("span");
    vals.className = `rep-vals ${kind}`;
    if (!items.length) {
      vals.classList.add("rep-none");
      vals.textContent = "없음";
    } else {
      items.forEach((text, i) => {
        if (i > 0) {
          const sep = document.createElement("span");
          sep.className = "rep-sep";
          sep.textContent = "|";
          vals.appendChild(sep);
        }
        const s = document.createElement("span");
        s.textContent = text;
        if (added.includes(text)) s.className = "added-text";
        vals.appendChild(s);
      });
    }
    line.appendChild(vals);
    return line;
  };
  box.appendChild(chipLine("(1) 일반", order.general || [], "gen"));
  box.appendChild(chipLine("(2) 기타메모사항", order.memos || [], "memo"));
  // (3) 작업요약: 제목의 건수도 작업요약 색과 같다 (교환 빨강 · 판금 파랑 · 탈착 회색)
  const c = order.counts || { 교환: 0, 판금: 0, 탈착: 0 };
  // 제목 칩: 일반·기타메모사항과 같은 테두리 칩으로 맞춘다
  const sumLine = document.createElement("div");
  sumLine.className = "rep-line";
  const sumChip = document.createElement("span");
  sumChip.className = "rep-chip sum";
  sumChip.textContent = "(3) 작업요약";
  sumLine.appendChild(sumChip);
  const sumVals = document.createElement("span");
  sumVals.className = "rep-vals sum";
  sumVals.append("(");
  [["red", `교환${c.교환 || 0}건`], ["blue", `판금${c.판금 || 0}건`], ["gray", `탈착${c.탈착 || 0}건`]].forEach(([cls, text], i) => {
    if (i > 0) sumVals.append(" / ");
    const s = document.createElement("span");
    s.className = `rep-cnt ${cls}`;
    s.textContent = text;
    sumVals.appendChild(s);
  });
  sumVals.append(")");
  sumLine.appendChild(sumVals);
  box.appendChild(sumLine);
  const list = document.createElement("ul");
  list.className = "rep-list";
  const sums = order.summary || [];
  sums.forEach((it, i) => {
    const li = document.createElement("li");
    const cls = it.w === "교환" ? "red" : it.w === "판금" ? "blue" : "gray";
    li.className = `sum-item ${cls}`;
    li.textContent = `${it.t}_${it.w}`;
    // 항목 사이는 "|" (마지막 항목 뒤에는 없다)
    if (i < sums.length - 1) {
      const sep = document.createElement("span");
      sep.className = "rep-sep";
      sep.textContent = "|";
      li.appendChild(sep);
    }
    list.appendChild(li);
  });
  if (!list.children.length) {
    const li = document.createElement("li");
    li.textContent = "작업요약이 없습니다";
    list.appendChild(li);
  }
  box.appendChild(list);
  box.addEventListener("click", () => closeRepPopup());
  // ESC 로도 닫는다
  const onKey = (e) => { if (e.key === "Escape") closeRepPopup(); };
  box._onKey = onKey;
  document.addEventListener("keydown", onKey);
  document.body.appendChild(box);
  // 가장 큰 값으로 고정 후, 누른 대표정보 칸의 바로 왼쪽에 맞춘다
  repPopupSize.w = Math.max(repPopupSize.w, box.offsetWidth);
  repPopupSize.h = Math.max(repPopupSize.h, box.offsetHeight);
  // 행을 넓히기 위해 가장 큰 값의 1.5배로 두되, 화면 밖으로 나가지 않게 제한한다
  const w = Math.min(Math.round(repPopupSize.w * 1.5), window.innerWidth - 8);
  const h = repPopupSize.h;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
  const r = (anchor || box).getBoundingClientRect();
  const left = Math.max(4, r.left - w - 6);
  const top = Math.min(Math.max(4, r.top), Math.max(4, window.innerHeight - h - 4));
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}
// 작업요약 팝업 닫기 (누르기, 다시 누르기, ESC 공통)
function closeRepPopup() {
  const box = document.querySelector(".rep-popup");
  if (!box) return;
  if (box._onKey) document.removeEventListener("keydown", box._onKey);
  box.remove();
}

// 부서: 1. 최초 ~ 6. 서류 만 보인다
function deptShown(v) {
  const m = String(v || "").match(/^([1-6])\.\s*(.+)$/);
  return m ? `${m[1]}. ${m[2]}` : "";
}

// 휴대폰 공업사 화면: 첫 머리글 '생성일'을 'NO'로 바꾸고, 원래 NO 칸은 감춘다
function setPhoneHeader() {
  const phoneShop = isPhoneShop();
  const shopMode = role === "shop";
  document.body.classList.toggle("phone-shop", phoneShop);
  const ths = document.querySelectorAll(".table-scroll > table.orders thead th");
  // 공업사 화면: 공업사명 열은 없으므로 그 머리글도 감춘다
  const shopTh = document.querySelector(".table-scroll > table.orders thead th.c-shop");
  if (shopTh) shopTh.style.display = (shopMode && isPhoneWidth()) ? "none" : "";
  if (shopMode && isPhoneWidth()) {
    // 머리글을 실제 값 순서(NO · 생성일 · 입고일 · 출고일)에 맞춘다
    const labels = phoneShop ? ["NO", "생성일", null, null] : ["NO", "생성일", "입고일", "출고일"];
    labels.forEach((t, i) => { if (t !== null && ths[i]) ths[i].textContent = t; });
  } else if (ths[1] && !shopMode) {
    ths[1].textContent = "생성일";
  }
  // 보험사 머리글: 휴대폰은 '보험사명'
  ths.forEach((th) => {
    if (th.classList.contains("c-ins")) th.textContent = isPhoneWidth() ? "보험사명" : "보험사";
    // 휴대폰: 도장코드 머리글은 두 줄 (도장 / 코드)
    if (th.classList.contains("c-paint")) th.innerHTML = isPhoneWidth() ? "도장<br>코드" : "도장코드";
  });
}

// 보험사·담보: 값이 두 개면 위아래 두 줄, 한 개면 가운데 한 줄 (PC·휴대폰 공통)
function fillStack(td, value) {
  const parts = String(value || "").split(",").map((t) => t.trim()).filter(Boolean);
  td.textContent = "";
  if (parts.length === 0) { td.textContent = "-"; return td; }
  parts.forEach((name) => {
    const line = document.createElement("span");
    line.className = "ins-line";
    line.textContent = name;
    td.appendChild(line);
  });
  return td;
}

function stackCell(value) {
  return fillStack(cell("-"), value);
}

function insurerCell(order) {
  return stackCell(order.insurer);
}

// 도장코드: 코드 아래 줄에 (3코트)
function coatsText(v) {
  const n = String(v || "").trim().replace(/(코드|코트)+$/, "").trim();
  return n ? `(${n}코트)` : "";
}
function paintCell(order) {
  const td = cell(order.paintCode || "-");
  const coats = coatsText(order.paintCoats);
  if (order.paintCode && coats) {
    td.textContent = "";
    const code = document.createElement("span");
    code.textContent = order.paintCode;
    const c = document.createElement("span");
    c.className = "coats-line";
    c.textContent = coats;
    td.append(code, c);
  }
  // 도장코드 칸에서 구글 검색 팝업이 뜨지 않도록 길게 누르기·선택을 막는다
  td.addEventListener("contextmenu", (e) => e.preventDefault());
  td.addEventListener("selectstart", (e) => e.preventDefault());
  return td;
}

// 부서 칸: 값이 있으면 누르면 그 차량의 사진을 본다.
// 부서가 바뀌었으면(folder 에서 새로 읽힘) 녹색 음영으로 새 부서를 보이고, 공업사는 '갱신'으로 적용한다
let listPage = 1;
// 목록에 보이는 부서(대기 중이면 새 부서)를 저장 형식으로 ("3. 하체" → "3.하체")
function deptRawOf(order) {
  const shown = deptShown(order.deptNew) && order.deptNew !== order.dept ? order.deptNew : order.dept;
  return deptShown(shown) ? String(shown).replace(/\s+/g, "") : "";
}
function deptCell(order) {
  const td = cell(deptShown(order.dept) || "-");
  td.addEventListener("contextmenu", (e) => e.preventDefault());
  td.addEventListener("selectstart", (e) => e.preventDefault());
  if (deptShown(order.dept)) {
    td.classList.add("dept-link");
    td.title = "눌러서 사진 보기";
    td.addEventListener("click", () => openDeptPhoto(order.plate, deptRawOf(order)));
  }
  let shown = deptShown(order.dept);
  if (deptShown(order.deptNew) && order.deptNew !== order.dept) {
    shown = deptShown(order.deptNew);
    td.textContent = "";
    td.classList.add("dept-pending");
    const val = document.createElement("span");
    val.className = "dept-new";
    val.textContent = shown;
    val.title = "눌러서 사진 보기";
    val.addEventListener("click", (e) => { e.stopPropagation(); openDeptPhoto(order.plate, deptRawOf(order)); });
    td.appendChild(val);
  }
  // 부서 글자 아래에 폴더 안 사진 개수를 "(개수)"로 보인다
  if (shown && order.photoCount > 0) {
    const cnt = document.createElement("span");
    cnt.className = "dept-count";
    cnt.textContent = `(${order.photoCount})`;
    td.appendChild(cnt);
  }
  return td;
}

function renderRows(data) {
  setPhoneHeader();
  rowsEl.innerHTML = "";
  const start = (data.page - 1) * data.size;
  data.orders.forEach((order, i) => {
    const tr = document.createElement("tr");
    const open = document.createElement("td");
    const link = document.createElement("a");
    link.className = "open";
    // 작업 내용이 있으면 '보기', 아직 없으면 '작성' (작성은 바로 고칠 수 있게 연다)
    link.href = linkTo(order, !order.hasWork);
    link.textContent = order.hasWork ? "보기" : "작성";
    if (!order.hasWork) link.classList.add("write");
    link.addEventListener("click", (e) => {
      // 가운데·Ctrl 클릭 등은 브라우저 기본 동작(새 탭)을 그대로 둔다
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      openOrderWindow(link.href);
    });
    if (order.revised) link.classList.add("revised");
    open.appendChild(link);
    const cells = {
      no: cell(data.total - start - i),
      created: dayCell(dateKey(order.createdAt)),
      inDate: dayCell(order.inDate),
      outDate: dayCell(order.outDate),
      // 공업사명 열은 마스터만 본다
      shop: (isMaster() || !isPhoneWidth()) ? cell(order.shopName || "-") : null,
      insurer: insurerCell(order),
      coverage: stackCell(order.coverage),
      plate: cell(order.plate || "-"),
      vehicle: cell(order.vehicle),
      dept: deptCell(order),
      rep: repCell(order),
      paint: paintCell(order),
    };
    // 칸마다 머리글과 같은 열 이름을 붙인다 (폭·줄바꿈·정렬 규칙이 값 칸에도 적용되도록)
    const colClass = { no: "c-no", created: "c-date", inDate: "c-date", outDate: "c-date", shop: "c-shop", insurer: "c-ins", coverage: "c-cov", plate: "c-plate", vehicle: "c-veh", dept: "c-dept", rep: "c-rep", paint: "c-paint" };
    Object.entries(colClass).forEach(([k, c]) => { if (cells[k]) cells[k].classList.add(c); });
    // 휴대폰에서는 생성일 칸을 보이지 않는다 (PC는 그대로)
    cells.created.classList.add("phone-hide");
    open.classList.add("c-open");
    const editTd = document.createElement("td");
    editTd.className = "c-edit";
    tr.append(
      cells.no, cells.created, cells.inDate, cells.outDate,
      ...(cells.shop ? [cells.shop] : []),
      cells.insurer, cells.coverage, cells.plate, cells.vehicle, cells.dept, cells.rep, cells.paint,
      open, editTd,
    );
    rowsEl.appendChild(tr);
    setupEditCell(order, cells, editTd, link, data.page);
  });
}

// PC 목록: 수정을 누르면 칸 폭을 지금 폭 그대로 고정한다. 입력 칸이 들어가도 표가 옆으로 늘어나지 않는다 (수정 단추가 화면 밖으로 밀리지 않게)
function freezeTableWidths(table) {
  if (!table || table.dataset.frozen === "1" || window.innerWidth <= 1000) return;
  const ths = [...table.querySelectorAll("thead th")];
  const widths = ths.map((th) => th.getBoundingClientRect().width);
  const tableWidth = table.getBoundingClientRect().width;
  table.dataset.frozen = "1";
  table.style.tableLayout = "fixed";
  table.style.width = `${tableWidth}px`;
  ths.forEach((th, i) => { th.style.width = `${widths[i]}px`; });
}

// 수정 칸: [수정]을 누르면 날짜·보험사·담보·차량번호·차량명·도장코드를 고칠 수 있고 [저장]이 켜진다.
// [삭제]는 확인 팝업에서 '예'를 누르면 지운다.
function setupEditCell(order, cells, editTd, link, page) {
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "row-btn";
  editBtn.textContent = "수정";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "row-btn primary";
  saveBtn.textContent = "저장";
  saveBtn.disabled = true;
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "row-btn danger";
  delBtn.textContent = "삭제";
  editTd.append(editBtn, saveBtn, delBtn);

  let fields = null; // 수정 중일 때 입력 칸들
  let outsideHandler = null;
  const original = { vehicle: order.vehicle, plate: order.plate };
  // 보기 값(화면에 쓰는 글자) — 수정을 그만둘 때 그대로 되돌린다
  const shown = () => ({
    created: dateKey(order.createdAt) || "-",
    inDate: order.inDate || "-",
    outDate: order.outDate || "-",
    insurer: listText(order.insurer),
    coverage: listText(order.coverage),
    plate: order.plate || "-",
    vehicle: order.vehicle,
    paint: order.paintCode || "-",
  });

  const makeField = (value, kind) => {
    const wrap = document.createElement("span");
    wrap.className = "edit-field";
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.className = "edit-input";
    wrap.appendChild(input);
    if (kind === "date") {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cal-btn";
      b.textContent = "📅";
      b.title = "달력에서 고르기";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        openDateCalendar(b, input.value, (v) => { input.value = v; });
      });
      wrap.appendChild(b);
    } else if (kind === "insurer" || kind === "coverage") {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pick-btn";
      b.textContent = "선택";
      b.addEventListener("click", (e) => { e.stopPropagation(); openPickPopup(b, kind, input); });
      wrap.appendChild(b);
    } else if (kind === "vehicle" || kind === "paint") {
      wrap.classList.add("suggest-field");
      const list = document.createElement("div");
      list.className = "ac-list";
      list.hidden = true;
      wrap.appendChild(list);
      if (kind === "vehicle") {
        attachSuggest(input, list, (q) => {
          const key = normalizeText(q);
          if (!key || typeof VEHICLE_NAMES === "undefined") return [];
          return VEHICLE_NAMES.filter((n) => normalizeText(n).includes(key)).slice(0, 30);
        });
      } else {
        loadPaintCodeList();
        attachSuggest(input, list, (q) => {
          const key = normalizeText(q);
          if (!key || !paintCodeList) return [];
          return paintCodeList.filter((c) => normalizeText(c).includes(key)).slice(0, 30);
        });
      }
    }
    return { wrap, input, kind };
  };

  // 선택 칸은 목록에 있는 값만 인정한다. 정확히 고르지 않은 값이면 기존 저장값으로 되돌린다.
  const cleanValue = async (key, raw, saved) => {
    const v = String(raw || "").trim();
    if (key === "created" || key === "inDate" || key === "outDate") {
      if (v === "") return saved;
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : saved;
    }
    if (key === "vehicle") {
      return typeof VEHICLE_NAMES !== "undefined" && VEHICLE_NAMES.includes(v) ? v : saved;
    }
    if (key === "paint") {
      await loadPaintCodeList();
      return v === "" || (paintCodeList && paintCodeList.includes(v)) ? v : saved;
    }
    if (key === "insurer" || key === "coverage") {
      const list = await loadOptionValues();
      const items = key === "insurer" ? list.insurers : list.coverages;
      return v === "" || items.includes(v) ? v : saved;
    }
    if (key === "plate") return v === "" ? saved : v;
    return v;
  };

  const exitEdit = () => {
    if (outsideHandler) document.removeEventListener("pointerdown", outsideHandler, true);
    outsideHandler = null;
    fields = null;
    const s = shown();
    Object.keys(s).forEach((k) => {
      if (!cells[k]) return;
      // 보험사·담보는 두 줄 형식을 그대로 되돌린다
      if (k === "insurer") fillStack(cells[k], order.insurer);
      else if (k === "coverage") fillStack(cells[k], order.coverage);
      else cells[k].textContent = s[k];
    });
    link.href = linkTo(order);
    editBtn.disabled = false;
    saveBtn.disabled = true;
  };

  // 저장: 입력한 값을 정리해서 서버에 보낸다. 바뀐 것이 없으면 그냥 보기 상태로 돌아간다.
  let saving = false;
  const commitEdit = async () => {
    if (!fields || saving) return;
    saving = true;
    // 저장 중에는 바깥 누르기로 다시 저장되지 않게 감시를 끈다
    if (outsideHandler) { document.removeEventListener("pointerdown", outsideHandler, true); outsideHandler = null; }
    const raw = {};
    Object.keys(fields).forEach((k) => { raw[k] = fields[k].input.value; });
    const saved = {
      created: dateKey(order.createdAt), inDate: order.inDate || "", outDate: order.outDate || "",
      insurer: order.insurer || "", coverage: order.coverage || "", plate: order.plate || "",
      vehicle: order.vehicle || "", paint: order.paintCode || "",
    };
    const next = {};
    for (const k of Object.keys(saved)) next[k] = await cleanValue(k, raw[k], saved[k]);
    if (!next.vehicle) next.vehicle = saved.vehicle;
    if (!next.plate) next.plate = saved.plate;
    const changed = Object.keys(saved).some((k) => next[k] !== saved[k]);
    if (!changed) { saving = false; exitEdit(); return; }
    saveBtn.disabled = true;
    try {
      const coats = paintCoatsMap.get(next.paint) || "";
      const res = await fetch("api/orders/edit", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId: order.shopId,
          vehicle: original.vehicle,
          plate: original.plate,
          next: {
            vehicle: next.vehicle, plate: next.plate,
            createdAt: next.created, inDate: next.inDate, outDate: next.outDate,
            insurer: next.insurer, coverage: next.coverage,
            paintCode: next.paint, paintCoats: coats,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || String(res.status));
      // 이 줄만 저장한 값으로 바꾼다. 목록을 다시 받으면 다른 줄을 누른 수정이 닫혀 버리므로 다시 받지 않는다
      original.vehicle = next.vehicle;
      original.plate = next.plate;
      order.vehicle = next.vehicle;
      order.plate = next.plate;
      order.createdAt = next.created ? next.created : order.createdAt;
      order.inDate = next.inDate;
      order.outDate = next.outDate;
      order.insurer = next.insurer;
      order.coverage = next.coverage;
      order.paintCode = next.paint;
      order.paintCoats = coats;
      saving = false;
      exitEdit();
      statusEl.textContent = "저장했습니다.";
    } catch (err) {
      statusEl.textContent = `저장하지 못했습니다: ${err.message}`;
      saveBtn.disabled = false;
      saving = false;
    }
  };

  const enterEdit = () => {
    // 칸 폭을 먼저 고정한 뒤 입력 칸을 넣는다
    freezeTableWidths(editTd.closest("table"));
    fields = {
      created: makeField(dateKey(order.createdAt), "date"),
      inDate: makeField(order.inDate, "date"),
      outDate: makeField(order.outDate, "date"),
      insurer: makeField(order.insurer, "insurer"),
      coverage: makeField(order.coverage, "coverage"),
      plate: makeField(order.plate, "plain"),
      vehicle: makeField(order.vehicle, "vehicle"),
      paint: makeField(order.paintCode, "paint"),
    };
    Object.keys(fields).forEach((key) => {
      const target = cells[key];
      target.textContent = "";
      target.appendChild(fields[key].wrap);
    });
    editBtn.disabled = true;
    saveBtn.disabled = false;
    // 이 줄 밖을 누르면 수정을 마치고 저장한다 (달력·선택창·자동검색 목록을 누른 것은 수정 중으로 본다)
    outsideHandler = (e) => {
      if (tr_contains(e.target)) return;
      if (e.target.closest && e.target.closest(".cal-pop, .pick-pop, .ac-list, .confirm-overlay")) return;
      commitEdit();
    };
    // 입력 칸에서 엔터를 누르면 바로 저장한다
    Object.keys(fields).forEach((k) => {
      fields[k].input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); commitEdit(); }
      });
    });
    // 바깥을 누르거나 손가락으로 눌러도 자동 저장 (마우스·터치 모두)
    setTimeout(() => document.addEventListener("pointerdown", outsideHandler, true), 0);
  };
  const tr_contains = (node) => editTd.parentElement && editTd.parentElement.contains(node);

  editBtn.addEventListener("click", enterEdit);
  saveBtn.addEventListener("click", commitEdit);

  delBtn.addEventListener("click", async () => {
    const yes = await askYesNo("최종 삭제하시겠습니까?\n삭제한 작업지시서는 되돌릴 수 없습니다.");
    if (!yes) return;
    try {
      const res = await fetch("api/orders/delete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopId: order.shopId, vehicle: original.vehicle, plate: original.plate }),
      });
      if (!res.ok) throw new Error(String(res.status));
      statusEl.textContent = "삭제했습니다.";
      load(page);
    } catch (err) {
      statusEl.textContent = `삭제하지 못했습니다: ${err.message}`;
    }
  });
}

// 보험사·담보 목록 (수정 칸에서 정확한 값인지 확인할 때 쓴다)
let optionValuesCache = null;
async function loadOptionValues() {
  if (optionValuesCache) return optionValuesCache;
  try {
    const res = await fetch("api/options", { credentials: "same-origin" });
    const data = res.ok ? await res.json() : {};
    optionValuesCache = {
      insurers: (data.insurers || []).map((x) => x.value),
      coverages: (data.coverages || []).map((x) => x.value),
    };
  } catch (err) {
    optionValuesCache = { insurers: [], coverages: [] };
  }
  return optionValuesCache;
}

// 예/아니오 확인 팝업 (가운데에 뜨고, 예·아니오 중 하나를 고르면 닫힌다)
function askYesNo(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    const box = document.createElement("div");
    box.className = "confirm-box";
    const p = document.createElement("p");
    p.textContent = message;
    const row = document.createElement("div");
    row.className = "confirm-actions";
    const no = document.createElement("button");
    no.type = "button";
    no.textContent = "아니오";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "primary";
    yes.textContent = "예";
    const done = (answer) => { overlay.remove(); resolve(answer); };
    no.addEventListener("click", () => done(false));
    yes.addEventListener("click", () => done(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(false); });
    row.append(no, yes);
    box.append(p, row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

function renderPager(data) {
  pagerEl.innerHTML = "";
  const pages = Math.max(1, Math.ceil(data.total / data.size));
  if (pages <= 1) return;
  const make = (label, target, disabled) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener("click", () => load(target));
    return btn;
  };
  const label = document.createElement("span");
  label.textContent = `${data.page} / ${pages}`;
  pagerEl.append(make("이전", data.page - 1, data.page <= 1), label, make("다음", data.page + 1, data.page >= pages));
}

async function load(page = 1) {
  listPage = page;
  statusEl.textContent = "불러오는 중…";
  const params = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE), ...query });
  params.set("sort", sortKey);
  params.set("dir", sortDir);
  try {
    // 목록 요청을 먼저 보내고, 로그인 확인이 끝난 뒤에 그린다 (두 요청을 겹쳐서 기다리는 시간을 줄인다)
    const listReq = fetchJson(`api/orders?${params}`);
    await sessionReady;
    const res = await listReq;
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    statusEl.textContent = data.total === 0
      ? "저장된 작업지시서가 없습니다."
      : `총 ${data.total}건 중 ${(data.page - 1) * data.size + 1}~${Math.min(data.page * data.size, data.total)}건`;
    renderRows(data);
    renderPager(data);
  } catch (err) {
    statusEl.textContent = "서버에서 목록을 가져오지 못했습니다. 연결과 로그인 상태를 확인한 뒤 새로고침하세요.";
  }
  // 목록이 완성된 뒤에 화면을 보인다 (처음 열 때 숨겨 둔 본문)
  // 공유 사진 차량 고르기를 준비 중이면 그 화면이 끝날 때 함께 보인다
  if (!sharePending) document.documentElement.classList.remove("booting");
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  query = {};
  // 기간 기준(생성일·입고일·출고일)을 골라 하나의 기간으로 찾는다
  const from = normalizeDate(dateFromEl.value);
  const to = normalizeDate(dateToEl.value);
  const kind = dateKindEl.value === "in" ? "in" : dateKindEl.value === "out" ? "out" : "created";
  const names = kind === "created" ? ["from", "to"] : [`${kind}_from`, `${kind}_to`];
  if (from) query[names[0]] = from;
  if (to) query[names[1]] = to;
  if (isMaster() && shopEl.value.trim()) query.q_shop = shopEl.value.trim();
  if (insurerEl.value.trim()) query.q_insurer = insurerEl.value.trim();
  if (coverageEl.value.trim()) query.q_coverage = coverageEl.value.trim();
  if (plateEl.value.trim()) query.plate = plateEl.value.trim();
  if (vehicleEl.value.trim()) query.q_vehicle = vehicleEl.value.trim();
  if (paintEl.value.trim()) query.q_paint = paintEl.value.trim();
  load(1);
});

document.getElementById("reset").addEventListener("click", () => {
  [dateFromEl, dateToEl, shopEl, insurerEl, coverageEl, plateEl, vehicleEl, paintEl]
    .forEach((el) => { el.value = ""; });
  dateKindEl.value = "created";
  query = {};
  load(1);
});

logoutEl.addEventListener("click", logout);

// 공유로 들어온 화면: 차량 고르기 화면이 준비될 때까지 목록을 바로 보이지 않는다
let sharePending = new URLSearchParams(location.search).has("shared");
// 로그인 확인과 목록 받기를 동시에 한다 (목록은 역할에 따라 그릴 때만 기다린다)
let sessionReady = Promise.resolve();
function init() {
  sessionReady = getSession().then((session) => {
    if (session.ok) {
      role = session.role;
      whoEl.textContent = session.role === "master" ? "마스터" : session.name;
      logoutEl.hidden = false;
      if (role === "master") {
        document.getElementById("settings-link").hidden = false;
      }
    }
    applyShopVisibility();
  });
  load(1);
}

// ---------- 카톡 등에서 공유한 사진: 차량 고르기 → 그 차량의 부서 사진으로 올리기 ----------
const SHARE_CACHE = "share-tmp-v1";
// 서비스 워커가 받아 둔 공유 사진을 꺼낸다 (꺼내고 나면 캐시에서 지운다)
async function takeSharedPhotos() {
  if (!("caches" in window)) return [];
  const cache = await caches.open(SHARE_CACHE);
  const reqs = await cache.keys();
  const files = [];
  for (const req of reqs) {
    const res = await cache.match(req);
    if (!res) continue;
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get("X-Name") || "photo.jpg");
    files.push(new File([blob], name, { type: blob.type || "image/jpeg" }));
  }
  for (const req of reqs) await cache.delete(req);
  return files;
}

// 공유로 들어온 경우: 목록과 사진을 모두 준비한 뒤 최종 차량 고르기 화면 한 번만 보인다 (중간 화면이 나오지 않게 본문은 숨겨 둔다)
async function checkSharedPhotos() {
  const n = Number(new URLSearchParams(location.search).get("shared")) || 0;
  if (!n) return;
  history.replaceState(null, "", "overview.html");
  try {
    const [files] = await Promise.all([takeSharedPhotos(), sessionReady]);
    if (files.length) {
      const orders = await fetchPickerOrders("");
      openSharePicker(files, orders);
    }
  } catch (err) {
    // 사진을 못 꺼내면 그냥 목록 화면을 보인다
  } finally {
    sharePending = false;
    document.documentElement.classList.remove("booting");
  }
}

// 차량 고르기 목록: 같은 차량번호는 한 줄, 입고일 최근순
async function fetchPickerOrders(q) {
  const params = new URLSearchParams({ page: "1", size: "100" });
  if (q) params.set("plate", q);
  const res = await fetchJson(`api/orders?${params}`);
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.json();
  const seen = new Set();
  return (data.orders || [])
    .filter((o) => { if (!o.plate || seen.has(o.plate)) return false; seen.add(o.plate); return true; })
    .sort((a, b) => String(b.inDate || "").localeCompare(String(a.inDate || "")));
}

// 차량 고르기 창: 입고일 최근순, 위의 칸에 차량번호를 치면 자동으로 찾는다. 한 대만 고른다
function openSharePicker(files, initialOrders) {
  let chosen = null;
  const overlay = document.createElement("div");
  overlay.className = "share-overlay";
  const box = document.createElement("div");
  box.className = "share-box";
  const title = document.createElement("p");
  title.className = "share-title";
  title.textContent = `보낼 사진 ${files.length}장 · 차량 고르기`;
  const search = document.createElement("input");
  search.type = "search";
  search.className = "share-search";
  search.placeholder = "차량번호 검색 (예: 12가3456)";
  search.autocomplete = "off";
  const listWrap = document.createElement("div");
  listWrap.className = "share-list";
  const status = document.createElement("p");
  status.className = "share-status";
  status.setAttribute("aria-live", "polite");
  const actions = document.createElement("div");
  actions.className = "share-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "취소";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "primary";
  ok.textContent = "확인";
  ok.disabled = true;
  actions.append(cancel, ok);
  box.append(title, search, listWrap, status, actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  cancel.addEventListener("click", close);

  const renderList = (orders) => {
    chosen = null;
    ok.disabled = true;
    listWrap.innerHTML = "";
    const table = document.createElement("table");
    table.className = "orders share-table";
    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>입고일</th><th>차량번호</th><th>선택</th></tr>";
    const tb = document.createElement("tbody");
    const boxes = [];
    orders.forEach((o) => {
      const tr = document.createElement("tr");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.addEventListener("change", () => {
        if (cb.checked) {
          boxes.forEach((x) => { if (x !== cb) x.checked = false; });
          chosen = { plate: o.plate, dept: deptRawOf(o) };
        } else {
          chosen = null;
        }
        ok.disabled = !chosen;
      });
      tr.addEventListener("click", (e) => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change"));
      });
      const tdCb = document.createElement("td");
      tdCb.appendChild(cb);
      boxes.push(cb);
      tr.append(cell(o.inDate || "-"), cell(o.plate || "-"), tdCb);
      tb.appendChild(tr);
    });
    table.append(thead, tb);
    listWrap.appendChild(table);
  };

  const loadList = async (q) => {
    status.textContent = "불러오는 중…";
    try {
      const orders = await fetchPickerOrders(q);
      renderList(orders);
      status.textContent = orders.length ? "차량을 한 대 고른 뒤 확인을 누르세요." : "찾는 차량이 없습니다.";
    } catch (err) {
      status.textContent = "목록을 불러오지 못했습니다.";
    }
  };

  let timer = null;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => loadList(search.value.trim()), 300);
  });

  ok.addEventListener("click", async () => {
    if (!chosen) return;
    ok.disabled = true;
    cancel.disabled = true;
    status.textContent = `${chosen.plate}에 사진 ${files.length}장을 올리는 중…`;
    try {
      const n = await uploadPhotosForPlate(chosen.plate, chosen.dept, files);
      status.textContent = `${chosen.plate} 사진 ${n}장을 올렸습니다. PC 지정폴더에도 보입니다.`;
      setTimeout(close, 1500);
    } catch (err) {
      status.textContent = `올리지 못했습니다: ${err.message || err}`;
      ok.disabled = false;
      cancel.disabled = false;
    }
  });

  // 처음 목록은 미리 받아 둔 것을 바로 그린다 (검색창이 잠깐 빈 채로 뜨지 않게)
  renderList(initialOrders || []);
  status.textContent = (initialOrders || []).length ? "차량을 한 대 고른 뒤 확인을 누르세요." : "찾는 차량이 없습니다.";
}

init();
checkSharedPhotos();

// ---------- 검색 칸: 날짜 달력, 보험사·담보 선택, 차량명·도장코드 자동검색 ----------

// 📅 버튼: 날짜 달력을 버튼 아래에 띄우고, 고르면 그 날짜가 칸에 들어간다
document.querySelectorAll("[data-cal]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const input = document.getElementById(btn.dataset.cal);
    openDateCalendar(btn, input.value, (value) => { input.value = value; });
  });
});

// 선택 팝업: 목록에서 하나를 고르면 칸에 들어간다 (보험사·담보)
let pickPop = null;
function closePickPopup() {
  if (pickPop) pickPop.remove();
  pickPop = null;
}
async function openPickPopup(btn, kind, input) {
  closePickPopup();
  const res = await fetch("api/options", { credentials: "same-origin" }).catch(() => null);
  const data = res && res.ok ? await res.json() : { insurers: [], coverages: [] };
  const items = kind === "insurer" ? data.insurers : data.coverages;
  const pop = document.createElement("div");
  pop.className = "pick-pop";
  pop.addEventListener("click", (e) => e.stopPropagation());
  const all = document.createElement("button");
  all.type = "button";
  all.className = "pick-item";
  all.textContent = "전체 (선택 해제)";
  all.addEventListener("click", () => { input.value = ""; closePickPopup(); });
  pop.appendChild(all);
  (items || []).forEach((it) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pick-item";
    b.textContent = it.value;
    b.addEventListener("click", () => { input.value = it.value; closePickPopup(); });
    pop.appendChild(b);
  });
  if (!items || items.length === 0) {
    const none = document.createElement("p");
    none.className = "pick-empty";
    none.textContent = "등록된 항목이 없습니다.";
    pop.appendChild(none);
  }
  document.body.appendChild(pop);
  pickPop = pop;
  const r = btn.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left), window.innerWidth - pop.offsetWidth - 8);
  let top = r.bottom + 6;
  if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}
document.querySelectorAll("[data-pick]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const kind = btn.dataset.pick;
    const input = document.getElementById(kind === "insurer" ? "insurer-q" : "coverage-q");
    openPickPopup(btn, kind, input);
  });
});
document.addEventListener("click", closePickPopup);

// 자동검색: 글을 칠 때마다 맞는 항목을 보여 주고, 누르면 칸에 들어간다
function attachSuggest(input, listEl, findItems) {
  const show = () => {
    const items = findItems(input.value.trim());
    listEl.innerHTML = "";
    if (!input.value.trim() || items.length === 0) { listEl.hidden = true; return; }
    items.forEach((text) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ac-item";
      b.textContent = text;
      b.addEventListener("mousedown", (e) => e.preventDefault()); // 누르기 전에 목록이 닫히지 않게
      b.addEventListener("click", () => { input.value = text; listEl.hidden = true; });
      listEl.appendChild(b);
    });
    listEl.hidden = false;
  };
  input.addEventListener("input", show);
  input.addEventListener("focus", show);
  input.addEventListener("blur", () => setTimeout(() => { listEl.hidden = true; }, 150));
}

const normalizeText = (t) => String(t || "").replace(/\s+/g, "").toLowerCase();
attachSuggest(vehicleEl, document.getElementById("vehicle-ac"), (q) => {
  const key = normalizeText(q);
  if (!key || typeof VEHICLE_NAMES === "undefined") return [];
  return VEHICLE_NAMES.filter((n) => normalizeText(n).includes(key)).slice(0, 30);
});

let paintCodeList = null;
let paintCoatsMap = new Map();
async function loadPaintCodeList() {
  if (paintCodeList) return paintCodeList;
  try {
    const res = await fetch("api/paintcodes", { credentials: "same-origin" });
    const codes = res.ok ? (await res.json()).codes || [] : [];
    paintCodeList = codes.map((c) => c.code);
    paintCoatsMap = new Map(codes.map((c) => [c.code, c.coats]));
  } catch (err) {
    paintCodeList = [];
  }
  return paintCodeList;
}
const paintInput = document.getElementById("paint-q");
const paintAc = document.getElementById("paint-ac");
paintInput.addEventListener("focus", () => { loadPaintCodeList(); });
attachSuggest(paintInput, paintAc, (q) => {
  const key = normalizeText(q);
  if (!key || !paintCodeList) return [];
  return paintCodeList.filter((c) => normalizeText(c).includes(key)).slice(0, 30);
});
paintInput.addEventListener("input", () => { loadPaintCodeList(); });


// 차량명 자동검색 목록: 마스터가 올린 차량명 정의가 있으면 그 목록을 쓴다
(async function loadVehicleNamesForSearch() {
  try {
    const res = await fetch("api/vehicles", { credentials: "same-origin" });
    if (!res.ok) return;
    const { vehicles } = await res.json();
    if (vehicles && vehicles.length) window.VEHICLE_NAMES = vehicles.map((v) => v.name);
  } catch (err) {
    // 못 읽으면 기본 목록(vehicle-names.js)을 쓴다
  }
})();

// ---------- 당일출고검색: 오늘 출고인 작업지시서만 찾는다 ----------
function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
document.getElementById("today-out-btn").addEventListener("click", () => {
  document.getElementById("date-kind").value = "out";
  document.getElementById("date-from").value = todayKst();
  document.getElementById("date-to").value = todayKst();
  formEl.requestSubmit();
});

// ---------- 작업목록 엑셀다운로드: 검색된 결과 전체를 A4 세로 한 장 폭에 맞춰 내려받는다 ----------
async function fetchAllForExcel() {
  const rows = [];
  for (let page = 1; page < 1000; page++) {
    const params = new URLSearchParams({ page: String(page), size: "100", ...query });
    const res = await fetchJson(`api/orders?${params}`);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    rows.push(...(data.orders || []));
    if (page * 100 >= (data.total || 0) || (data.orders || []).length === 0) break;
  }
  return rows;
}
// .xlsx 는 여러 파일을 zip 으로 묶은 것이다. 압축 없이(store) 묶어서 Blob 으로 만든다
const ZIP_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function zipCrc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = ZIP_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makeXlsx(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.text);
    const crc = zipCrc32(data);
    const size = data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, 0, true);
    ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true);
    ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
function xlEsc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
document.getElementById("excel-list-btn").addEventListener("click", async () => {
  statusEl.textContent = "엑셀 만드는 중…";
  let orders;
  try {
    orders = await fetchAllForExcel();
  } catch (err) {
    statusEl.textContent = "엑셀을 만들지 못했습니다. 다시 시도해 주세요.";
    return;
  }
  const head = ["NO", "입고일", "출고일", "보험사명", "담보", "차량번호", "차량명", "도장코드"];
  const body = orders.map((o, i) => [
    i + 1,
    o.inDate || "",
    o.outDate || "",
    String(o.insurer || "").split(",").map((x) => x.trim()).filter(Boolean).join(" / "),
    String(o.coverage || "").split(",").map((x) => x.trim()).filter(Boolean).join(" / "),
    o.plate || "",
    o.vehicle || "",
    o.paintCode ? [o.paintCode, coatsText(o.paintCoats)].filter(Boolean).join("\n") : "",
  ]);
  // 진짜 엑셀(.xlsx) 파일을 직접 만든다. 휴대폰 Office 앱도 열 수 있는 형식이다.
  // 모든 칸은 얇은 테두리, 굵은 글씨 없음, 행 높이는 기본의 2배(30pt), 도장코드는 한 칸에 두 줄
  const widths = [36, 80, 80, 110, 90, 90, 150, 110];
  const COLS = widths.length;
  const colName = (i) => String.fromCharCode(65 + i);
  const cellXml = (ref, text, s) => `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xlEsc(text)}</t></is></c>`;
  const rowXml = (r, values, s, ht) => {
    const padded = values.concat(Array(COLS - values.length).fill(""));
    return `<row r="${r}" ht="${ht}" customHeight="1">` + padded.map((v, i) => cellXml(`${colName(i)}${r}`, v, s)).join("") + `</row>`;
  };
  const sheetRows = [
    rowXml(1, ["작업지시서 목록"], 1, 36),
    rowXml(2, [`검색 결과 ${orders.length}건 · 출력일 ${todayKst()}`], 2, 30),
    rowXml(3, head, 3, 30),
    ...body.map((b, i) => rowXml(i + 4, b.map((v) => String(v ?? "")), 4, 30)),
  ];
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${colName(COLS - 1)}${sheetRows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${(w / 7).toFixed(2)}" customWidth="1"/>`).join("")}</cols><sheetData>${sheetRows.join("")}</sheetData><mergeCells count="2"><mergeCell ref="A1:${colName(COLS - 1)}1"/><mergeCell ref="A2:${colName(COLS - 1)}2"/></mergeCells><pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="맑은 고딕"/></font><font><sz val="28"/><name val="맑은 고딕"/></font><font><sz val="10"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF2FA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="49" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="작업지시서 목록" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const blob = makeXlsx([
    { name: "[Content_Types].xml", text: contentTypes },
    { name: "_rels/.rels", text: rootRels },
    { name: "xl/workbook.xml", text: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", text: workbookRels },
    { name: "xl/worksheets/sheet1.xml", text: sheetXml },
    { name: "xl/styles.xml", text: stylesXml },
  ]);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "작업지시서목록.xlsx";
  a.click();
  URL.revokeObjectURL(a.href);
  statusEl.textContent = `엑셀 ${orders.length}건을 내려받았습니다.`;
});

