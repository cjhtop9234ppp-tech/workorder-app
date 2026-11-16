// 인쇄: 작업지시서 내용을 A4 한 장짜리 인쇄물로 만들어 인쇄한다. 디자인은 사용자가 준 샘플 그림을 따른다.
// 화면의 표는 그대로 두고, #print-sheet 에 인쇄용 내용을 채운 뒤 인쇄 대화상자를 연다.

// 블록 순서와 머리글 색 (샘플 그림과 같은 배치)
const PRINT_BLOCKS = {
  left: [
    { part: "프런트", tone: "navy" },
    { part: "사이드", tone: "teal" },
    { part: "센터", tone: "purple" },
  ],
  right: [
    { part: "리어", tone: "navy" },
    { part: "프런트서스펜션", tone: "navy" },
    { part: "리어서스펜션", tone: "navy" },
  ],
  bottomLeft: [
    { part: "엔진", tone: "gray" },
    { part: "트랜스미션", tone: "indigo" },
  ],
};

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

// 작업 알약: 교환 빨강, 판금 파랑, 탈착 회색
// 수정 중 바뀐 칸(녹색 음영)은 빨강·파랑 대신 녹색으로 표기한다
function workPill(value, marked) {
  if (!value) return "";
  const tone = marked ? "green" : value === "교환" ? "red" : value === "판금" ? "blue" : "gray";
  return `<span class="pill ${tone}">${escapeHtml(value)}</span>`;
}

// 도장 알약: 글자는 "도장", 교환도장은 빨강, 나머지 도장 종류는 파랑
function paintPill(value, marked) {
  if (!value) return "";
  return `<span class="pill ${marked ? "green" : value === "교환도장" ? "red" : "blue"}">도장</span>`;
}

// 항목 이름에서 화면과 같은 방식으로 기존 (좌)/(우) 표기를 뗀다 (아래에서 다시 붙인다)
function hideSideLabel(text) {
  return String(text).replace(/\((좌|우)(, ?(좌|우))?\)$/, "").replace(/\s{2,}/g, " ").trim();
}

// 선택된 칸이 하나라도 있는지
function hasSelection(row) {
  const w = row.work || {};
  const p = row.paint || {};
  return Boolean(w.L || w.R || w.C || p.L || p.R || p.C);
}

// 건수: 선택된 쪽(좌·우·가운데) 하나가 1건 (좌·우 둘 다 있으면 2건)
function countSides(rows) {
  return rows.reduce((n, r) => n + ["L", "R", "C"].filter((s) => r.work?.[s] || r.paint?.[s]).length, 0);
}

// 표에 찍을 줄 만들기 (샘플과 같은 방식)
//  - 가운데(C) 항목: 이름 그대로 한 줄
//  - 좌·우가 같은 작업: 한 줄, 이름 뒤 (좌·우), 연두색
//  - 좌·우가 다른 작업: 쪽마다 한 줄, 이름 뒤 (좌) 또는 (우)
function entriesOf(rows) {
  const out = [];
  for (const r of rows) {
    if (!hasSelection(r)) continue;
    const name = hideSideLabel(r.item);
    const w = r.work || {};
    const p = r.paint || {};
    // 수정으로 바뀐 칸만 녹색 알약으로 찍는다 (수정 확인 전까지). 그 밖의 칸은 실제 작업 색 그대로.
    const mk = (kind, side) => isChanged(r, kind, side);
    if (r.centerWork || w.C || p.C) {
      out.push({ name, work: w.C, paint: p.C, wm: mk("work", "C"), pm: mk("paint", "C"), both: false, count: 1 });
      continue;
    }
    const sameWork = w.L === w.R && p.L === p.R;
    if (w.L && w.R && sameWork) {
      out.push({
        name: `${name}(좌·우)`, work: w.L, paint: p.L, both: true, count: 2,
        wm: mk("work", "L") && mk("work", "R"), pm: mk("paint", "L") && mk("paint", "R"),
      });
      continue;
    }
    if (w.L || p.L) out.push({ name: `${name}(좌)`, work: w.L, paint: p.L, wm: mk("work", "L"), pm: mk("paint", "L"), both: false, count: 1 });
    if (w.R || p.R) out.push({ name: `${name}(우)`, work: w.R, paint: p.R, wm: mk("work", "R"), pm: mk("paint", "R"), both: false, count: 1 });
  }
  return out;
}

// 한 줄을 표 칸 HTML로
// 항목 이름: 끝의 (좌)·(우)·(좌·우) 표기는 따로 떼어, 이름이 길어 두 줄이 되면 그 표기가 아래 줄로 함께 내려간다
function itemNameHtml(name) {
  const m = String(name).match(/^(.*)(\((?:좌|우)(?:[·,]\s?(?:좌|우))?\))$/);
  if (!m || !m[1]) return escapeHtml(name);
  const cls = m[1].length > 7 ? "sd block-side" : "sd";
  return `<span class="nm">${escapeHtml(m[1])}</span><span class="${cls}">${escapeHtml(m[2])}</span>`;
}

function rowCells(entry) {
  const long = String(entry.name).length > 14; // 긴 항목 이름은 글자 크기를 고정한다 (칸 폭이 무너지지 않게)
  return `
    <td class="item${long ? " long" : ""}">${itemNameHtml(entry.name)}</td>
    <td>${workPill(entry.work, entry.wm)}</td>
    <td>${paintPill(entry.paint, entry.pm)}</td>`;
}

// 부위 블록: 머리글(부위 이름 + 건수, 왼쪽 정렬) + 표
function block(part, tone, rows) {
  // 파트 이름은 띄어쓰기가 있을 때도 있다 ("프런트 서스펜션" = "프런트서스펜션"), 띄어쓰기를 빼고 맞춘다
  const partRows = rows.filter((r) => String(r.part || "").replace(/\s/g, "") === part);
  const entries = entriesOf(partRows);
  // 작업 값이 하나도 없는 부위는 인쇄하지 않는다
  if (entries.length === 0) return "";
  const count = countSides(partRows);
  const body = entries.map((e) => `<tr class="${e.both ? "both" : ""}">${rowCells(e)}</tr>`).join("");
  return `
    <div class="block ${tone}">
      <div class="block-title">${escapeHtml(part)} <span class="count">${count}건</span></div>
      <table>
        <colgroup><col class="c-item"><col class="c-work"><col class="c-paint"></colgroup>
        <thead><tr><th>주작업항목</th><th>작업</th><th>도장</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

// 에어백 상자: 줄을 앞 절반·뒤 절반으로 나눠 한 표에 좌우로 나란히 놓는다
function airbagBlock(rows) {
  const entries = entriesOf(rows.filter((r) => r.part === "에어백"));
  // 작업 값이 하나도 없으면 에어백 상자 자체를 인쇄하지 않는다
  if (entries.length === 0) return "";
  const count = countSides(rows.filter((r) => r.part === "에어백"));
  const half = Math.ceil(entries.length / 2);
  const left = entries.slice(0, half);
  const right = entries.slice(half);
  const cells = (e) => (e ? rowCells(e) : "<td></td><td></td><td></td>");
  const body = Array.from({ length: half }, (_, i) => `<tr>${cells(left[i])}${cells(right[i])}</tr>`).join("");
  return `
    <div class="block maroon wide">
      <div class="block-title">에어백 <span class="count">${count}건</span></div>
      <table>
        <colgroup>
          <col class="c-item"><col class="c-work"><col class="c-paint">
          <col class="c-item"><col class="c-work"><col class="c-paint">
        </colgroup>
        <thead><tr><th>주작업항목</th><th>작업</th><th>도장</th><th>주작업항목</th><th>작업</th><th>도장</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

// 항목들을 " | " 로 가로로 이어 붙인다 (1) 일반, 2) 기타메모사항 공통)
// 같은 내용은 한 번만 적고, 입력 순서대로 좌측부터 ' | '로 잇는다
function inlineItems(texts) {
  const unique = [...new Set(texts.map((t) => String(t || "").trim()).filter(Boolean))];
  return unique.map((t) => `<span>${escapeHtml(t)}</span>`).join('<i class="sep">|</i>');
}

// 항목을 | 로 이어 쓴다 (추가된 항목은 녹색)
function inlineItemsFlags(items) {
  const seen = new Set();
  const unique = items.filter((it) => {
    const t = String(it.text || "").trim();
    if (!t || seen.has(t)) return false;
    seen.add(t);
    return true;
  });
  return unique.map((it) => `<span${it.added ? ' class="added"' : ""}>${escapeHtml(it.text.trim())}</span>`).join('<i class="sep">|</i>');
}

// 1) 일반: 일반 작업에서 고른 항목 (수정으로 더한 항목은 녹색)
function extrasHtml() {
  const picked = state.extras || [];
  if (picked.length === 0) return "";
  return inlineItemsFlags(picked.map((x) => ({ text: x, added: isExtraAdded(x) })));
}

// 2) 기타메모사항: 작업지시서 작성 화면의 기타메모사항과 같은 내용 (추가된 항목은 녹색)
function memoHtml() {
  const items = memoDisplayItems();
  if (items.length === 0) return "";
  return inlineItemsFlags(items);
}

// 도장코드 옆 괄호: "2코트코드"처럼 들어 있어도 "2코트"로 한 번만 쓴다
function coatsLabel(coats) {
  let s = String(coats || '').trim().replace(/코드$/, '');
  if (!/코트$/.test(s)) s += '코트';
  return s;
}

// 차량정보 줄: 입고일·출고일·보험사·담보·도장코드 (차량 입력 화면에서 고른 값), 한 행에 나란히
function vehicleInfoHtml() {
  const m = state.meta || {};
  const v = (x) => escapeHtml(x || "-");
  const paint = m.paintCode ? `${escapeHtml(m.paintCode)}${m.paintCoats ? `(${escapeHtml(coatsLabel(m.paintCoats))})` : ""}` : "-";
  return `
    <section class="ps-info">
      <div><span>입고일</span>[<b>${v(m.inDate)}</b>]</div>
      <div><span>출고일</span>[<b>${v(m.outDate)}</b>]</div>
      <div><span>보험사</span>[<b>${v(m.insurer)}</b>]</div>
      <div><span>담보</span>[<b>${v(m.coverage)}</b>]</div>
      <div><span>도장코드</span>[<b>${paint}</b>]</div>
    </section>`;
}

// 차 그림 위의 말풍선 태그: 구분(파트)과 좌·가운데·우 위치에 맞춰 교환(빨강)·판금(파랑)을 표시한다
// 좌표는 그림 가로·세로에 대한 비율 (0~1)
const CAR_SPOTS = {
  프런트: { L: [0.14, 0.2], R: [0.86, 0.2], C: [0.5, 0.05] },
  사이드: { L: [0.1, 0.46], R: [0.9, 0.46], C: [0.5, 0.5] },
  센터: { L: [0.14, 0.6], R: [0.86, 0.6], C: [0.5, 0.56] },
  리어: { L: [0.12, 0.8], R: [0.88, 0.8], C: [0.5, 0.96] },
};

// 파트 이름을 그림의 위치 묶음으로 바꾼다 (프런트서스펜션 → 프런트, 리어서스펜션 → 리어)
function carZone(part) {
  const p = String(part || "").replace(/\s/g, "");
  if (p.startsWith("프런트")) return "프런트";
  if (p.startsWith("리어")) return "리어";
  return CAR_SPOTS[p] ? p : null;
}

// 인쇄의 차 그림 표식(교환·판금 말풍선)은 기타메모사항을 가리므로 끈다. 다시 켜려면 true.
const CAR_TAGS_IN_PRINT = false;

function carHtml(rows) {
  if (!CAR_TAGS_IN_PRINT) return `<div class="car-wrap"><img src="print-car.png" alt=""></div>`;
  const spots = new Map();
  for (const r of rows) {
    const zone = carZone(r.part);
    if (!zone) continue;
    for (const side of ["L", "R", "C"]) {
      const kind = r.work?.[side];
      if (kind !== "교환" && kind !== "판금") continue;
      const at = CAR_SPOTS[zone][side];
      spots.set(`${zone}|${side}|${kind}`, { at, kind });
    }
  }
  // 같은 자리에 두 종류가 겹치면 위아래로 나눈다
  const used = new Map();
  const tags = [...spots.values()].map(({ at, kind }) => {
    const key = at.join(",");
    const n = used.get(key) || 0;
    used.set(key, n + 1);
    const [x, y] = at;
    const pillY = y - 0.095 - n * 0.11;
    const stemTop = pillY + 0.025;
    const cls = kind === "교환" ? "red" : "blue";
    return `
      <span class="car-tag ${cls}" style="left:${x * 100}%;top:${pillY * 100}%">${kind}</span>`;
  }).join("");
  return `<div class="car-wrap"><img src="print-car.png" alt="">${tags}</div>`;
}

function buildPrintSheet() {
  const rows = state.rows;
  const vehicle = escapeHtml(state.vehicle || "");
  const plate = escapeHtml(state.plate || "");
  // 좌: 프런트·사이드·센터·엔진·트랜스미션·에어백 / 가운데: 차 그림 / 우: 리어·프런트서스펜션·리어서스펜션 (좌우 대칭)
  const left = [
    ...PRINT_BLOCKS.left,
    ...PRINT_BLOCKS.bottomLeft,
  ].map((b) => block(b.part, b.tone, rows)).join("") + airbagBlock(rows);
  const right = PRINT_BLOCKS.right.map((b) => block(b.part, b.tone, rows)).join("");

  return `<div class="ps-paper">
    <header class="ps-head">
      <div class="ps-top">
        <div class="ps-title">작업지시서</div>
        <div class="ps-meta">
          <div class="ps-field"><span>차량명</span>[<b>${vehicle}</b>]</div>
          <div class="ps-field"><span>차량번호</span>[<b>${plate}</b>]</div>
        </div>
      </div>
      ${vehicleInfoHtml()}
    </header>
    <section class="ps-note">
      <div class="ps-note-group"><b>1) 일반</b><div class="ps-items">${extrasHtml()}</div></div>
      <div class="ps-note-group"><b>2) 기타메모사항</b><div class="ps-items">${memoHtml()}</div></div>
    </section>
    <div class="ps-grid">
      <div class="col">${left}</div>
      <div class="center">
        ${carHtml(rows)}
      </div>
      <div class="col">${right}</div>
    </div>
  </div>`;
}

// 차량 그림이 다 읽힐 때까지 기다린다 (그림이 없으면 바로 끝난다)
function waitForCarImage() {
  const car = $("print-sheet").querySelector(".center img");
  if (!car || car.complete) return Promise.resolve();
  return new Promise((resolve) => {
    car.onload = resolve;
    car.onerror = resolve;
  });
}

// 휴대폰은 인쇄 대화상자가 없으므로 미리 보기로 보여 준다. PC는 바로 인쇄한다.
function isPhone() {
  return window.matchMedia("(pointer: coarse)").matches;
}

// 미리 보기 화면: 종이를 화면 폭에 맞게 줄인다
// 미리 보기는 인쇄물과 같은 크기(794px)로 보여 준다. 휴대폰에서는 옆으로 밀어서 본다 (글자 크기가 인쇄물과 같다)
function fitPreviewPaper() {
  const paper = $("print-sheet").querySelector(".ps-paper");
  if (!paper) return;
  // 미리보기는 종이 전체가 한 화면에 보이도록 폭에 맞춘다 (인쇄물 크기는 그대로)
  paper.style.zoom = String(Math.min(1, (window.innerWidth - 16) / 794).toFixed(3));
}

// 미리 보기가 열리면 JPG·PDF를 미리 만들어 둔다.
// 공유창은 버튼을 누른 직후에만 열리므로, 누른 뒤에 만들기 시작하면 공유 기회를 놓친다.
// readyFiles: 만들어진 파일과 data 주소. 다운로드는 이 주소로 바로 저장한다.
let previewFiles = null;
let readyFiles = null;

function preparePreviewFiles() {
  readyFiles = null;
  previewFiles = (async () => {
    await waitForCarImage();
    const { blob, width, height, pdfImage } = await paperToJpeg();
    const jpg = new File([blob], shareFileName("jpg"), { type: "image/jpeg" });
    const pdf = new File([makePdfFlate(pdfImage, width, height)], shareFileName("pdf"), { type: "application/pdf" });
    const [jpgUrl, pdfUrl] = await Promise.all([fileDataUrl(jpg), fileDataUrl(pdf)]);
    readyFiles = { jpg: { file: jpg, url: jpgUrl }, pdf: { file: pdf, url: pdfUrl } };
    return readyFiles;
  })();
  previewFiles.catch((err) => {
    console.error("파일 준비 실패", err);
    previewFiles = null; // 다음에 누르면 다시 만든다
  });
  return previewFiles;
}

// 파일을 data 주소로 바꾼다 (휴대폰 브라우저는 blob 주소 내려받기를 거부하는 경우가 있어 이 주소를 쓴다)
function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// 한 장(A4)에 다 들어가도록 본문을 줄인다: 넘치면 본문 배율을 낮춘다 (글자 크기는 모든 블록이 같게 유지된다)
function fitPrintSheet() {
  const paper = $("print-sheet").querySelector(".ps-paper");
  const grid = paper && paper.querySelector(".ps-grid");
  if (!paper || !grid) return;
  grid.style.zoom = "1";
  const paperTop = paper.getBoundingClientRect().top;
  const limit = paper.clientHeight - parseFloat(getComputedStyle(paper).paddingBottom);
  const needed = grid.getBoundingClientRect().bottom - paperTop;
  const top = grid.getBoundingClientRect().top - paperTop;
  const avail = limit - top;
  const contentH = needed - top;
  if (contentH > avail) grid.style.zoom = String(Math.max(0.6, avail / contentH).toFixed(3));
}

async function openPrintPreview() {
  const sheet = $("print-sheet");
  sheet.innerHTML = buildPrintSheet();
  sheet.classList.add("open");
  fitPrintSheet();
  sheet.scrollTop = 0;
  document.body.classList.add("print-previewing");
  $("print-bar").hidden = false;
  $("pp-print").hidden = isPhone(); // 휴대폰은 인쇄 대화상자가 없으므로 인쇄 버튼을 숨긴다
  // 공유 버튼은 휴대폰에서만 보인다 (PC는 저장 버튼만 쓴다)
  $("pp-share-jpg").hidden = !isPhone();
  $("pp-share-pdf").hidden = !isPhone();
  $("pp-status").textContent = "";
  fitPreviewPaper();
  syncBarHeight();
  preparePreviewFiles();
}

// 막대가 두 줄이 되면 그 높이만큼 아래 내용을 내린다 (CSS 변수 --pp-bar-h)
function syncBarHeight() {
  document.documentElement.style.setProperty("--pp-bar-h", `${$("print-bar").offsetHeight}px`);
}

function closePrintPreview() {
  $("print-sheet").classList.remove("open");
  $("print-sheet").innerHTML = "";
  document.body.classList.remove("print-previewing");
  $("print-bar").hidden = true;
  $("pp-status").textContent = "";
  previewFiles = null;
  readyFiles = null;
}

// 인쇄 버튼: PC·휴대폰 모두 미리 보기를 연다. 인쇄는 PC에서만 미리 보기의 인쇄 버튼으로 한다.
async function printOrder() {
  await openPrintPreview();
}

// PC 인쇄: 공유 파일(PDF·JPG)과 같은 방식으로 그린 한 장 그림을 인쇄한다 → 인쇄물과 파일이 같아진다
async function printFromPreview() {
  const status = $("pp-status");
  if (status) status.textContent = "인쇄 준비 중…";
  let made;
  try {
    made = await paperToJpeg();
  } catch (err) {
    if (status) status.textContent = "인쇄 준비에 실패했습니다. 다시 눌러 주세요.";
    return;
  }
  if (status) status.textContent = "";
  let host = document.getElementById("print-image");
  if (!host) {
    host = document.createElement("div");
    host.id = "print-image";
    document.body.appendChild(host);
  }
  host.innerHTML = `<img src="${made.printUrl}" alt="">`;
  const done = () => {
    host.innerHTML = "";
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}

// ---------- 파일 공유 (JPG · PDF) ----------

// 그림 파일을 data 주소로 바꾼다 (SVG 안에 넣어 캔버스로 그릴 때 필요)
async function imageDataUrl(path) {
  const blob = await fetch(path, { cache: "no-cache" }).then((r) => r.blob());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// 종이(.ps-paper)를 JPG로 찍는다. 종이 HTML을 SVG 글상자에 넣어 그림으로 그린 뒤 캔버스로 옮긴다.
// (화면을 찍는 외부 라이브러리는 이 환경에서 빈 그림을 만들어 쓰지 않는다)
async function paperToJpeg() {
  const [css, carUrl] = await Promise.all([
    fetch("print.css", { cache: "no-cache" }).then((r) => r.text()),
    imageDataUrl("print-car.png"),
  ]);
  const paper = $("print-sheet").querySelector(".ps-paper");
  const clone = paper.cloneNode(true);
  clone.removeAttribute("style");
  const car = clone.querySelector(".center img");
  if (car) car.setAttribute("src", carUrl);
  const body = new XMLSerializer().serializeToString(clone);
  const html = `<div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style><div id="print-sheet" style="display:block">${body}</div></div>`;
  const SCALE = 4; // 해상도: 종이를 4배 크기로 그려서 글자와 선이 선명하게 나오게 한다 (공유 파일의 픽셀 수를 늘림)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${794 * SCALE}" height="${1123 * SCALE}" viewBox="0 0 794 1123"><foreignObject x="0" y="0" width="794" height="1123">${html}</foreignObject></svg>`;

  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = 794 * SCALE;
  canvas.height = 1123 * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  // PDF 안의 그림: 색을 줄이지 않은 원본 픽셀(RGB)을 압축(Flate)해서 넣는다.
  // JPEG 은 글자 가장자리를 뭉개서 PDF 를 열면 글씨가 어른거려 보이기 때문이다.
  const width = canvas.width;
  const height = canvas.height;
  const rgba = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  for (let p = 0, q = 0; p < rgba.length; p += 4, q += 3) {
    rgb[q] = rgba[p];
    rgb[q + 1] = rgba[p + 1];
    rgb[q + 2] = rgba[p + 2];
  }
  const compressed = new Uint8Array(await new Response(new Blob([rgb]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  // 공유용 JPG 파일 (고화질)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.98));
  if (!blob) throw new Error("JPG 변환 실패");
  // PC 인쇄도 이 그림을 그대로 찍는다 (PDF·JPG 와 같은 모양·색·크기)
  const printUrl = canvas.toDataURL("image/jpeg", 0.95);
  return { blob, width, height, pdfImage: compressed, printUrl };
}

// 파일 이름: 작업지시서_차량명_차량번호
function shareFileName(ext) {
  const safe = (text) => String(text || "").replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "");
  const parts = ["작업지시서", safe(state.vehicle), safe(state.plate)].filter(Boolean);
  return `${parts.join("_")}.${ext}`;
}

// JPEG 한 장을 담은 PDF (A4 한 쪽). 외부 라이브러리 없이 바이트로 만든다.
function makePdf(jpegBytes, pixelWidth, pixelHeight) {
  const enc = new TextEncoder();
  const bytes = (text) => enc.encode(text);
  const pageWidth = 595;
  const pageHeight = 842;
  const content = bytes(`q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`);
  const objects = [
    [bytes("<< /Type /Catalog /Pages 2 0 R >>")],
    [bytes("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")],
    [bytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)],
    [bytes(`<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`), jpegBytes, bytes("\nendstream")],
    [bytes(`<< /Length ${content.length} >>\nstream\n`), content, bytes("\nendstream")],
  ];

  const parts = [bytes("%PDF-1.4\n")];
  let pos = parts[0].length;
  const offsets = [];
  objects.forEach((body, i) => {
    const head = bytes(`${i + 1} 0 obj\n`);
    const tail = bytes("\nendobj\n");
    offsets.push(pos);
    parts.push(head, ...body, tail);
    pos += head.length + body.reduce((n, p) => n + p.length, 0) + tail.length;
  });

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { xref += `${String(o).padStart(10, "0")} 00000 n \n`; });
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(bytes(xref));
  return new Blob(parts, { type: "application/pdf" });
}

// 원본 픽셀을 Flate 로 압축해 넣은 PDF (A4 한 쪽)
function makePdfFlate(flateBytes, pixelWidth, pixelHeight) {
  const enc = new TextEncoder();
  const bytes = (text) => enc.encode(text);
  const pageWidth = 595;
  const pageHeight = 842;
  const content = bytes(`q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`);
  const objects = [
    [bytes("<< /Type /Catalog /Pages 2 0 R >>")],
    [bytes("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")],
    [bytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)],
    [bytes(`<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${flateBytes.length} >>\nstream\n`), flateBytes, bytes("\nendstream")],
    [bytes(`<< /Length ${content.length} >>\nstream\n`), content, bytes("\nendstream")],
  ];
  const parts = [bytes("%PDF-1.4\n")];
  let pos = parts[0].length;
  const offsets = [];
  objects.forEach((body, i) => {
    const head = bytes(`${i + 1} 0 obj\n`);
    const tail = bytes("\nendobj\n");
    offsets.push(pos);
    parts.push(head, ...body, tail);
    pos += head.length + body.reduce((n, p) => n + p.length, 0) + tail.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { xref += `${String(o).padStart(10, "0")} 00000 n \n`; });
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(bytes(xref));
  return new Blob(parts, { type: "application/pdf" });
}

// ---------- 다운로드 · 공유 버튼 ----------

const SHARE_TIMEOUT_MS = 15000;

function setPreviewStatus(text) {
  $("pp-status").textContent = text;
}

// 다운로드: 만들어 둔 파일을 바로 저장한다 (PC는 다운로드 폴더, 휴대폰은 내려받기)
async function downloadFile(kind) {
  if (!readyFiles) {
    setPreviewStatus("파일을 만드는 중입니다…");
    try {
      await (previewFiles || preparePreviewFiles());
    } catch (err) {
      setPreviewStatus(`파일을 만들지 못했습니다 (${err.message || err.name || "오류"}). 다시 눌러 주세요.`);
      return;
    }
    setPreviewStatus("");
  }
  const item = readyFiles[kind];
  const link = document.createElement("a");
  link.href = item.url;
  link.download = item.file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// 공유: 외부 앱(카카오톡, 메일, 문자 등)의 공유창을 연다.
// 공유창은 버튼을 누른 직후에만 열리므로 파일이 미리 준비되어 있어야 한다.
function shareFile(kind) {
  if (!readyFiles) {
    setPreviewStatus("파일을 만드는 중입니다. 잠시 후 다시 눌러 주세요.");
    if (!previewFiles) preparePreviewFiles();
    return;
  }
  const file = readyFiles[kind].file;
  if (!navigator.share) {
    setPreviewStatus("이 브라우저는 공유 기능이 없습니다. 크롬(Chrome) 앱에서 열어 주세요. 카카오톡·네이버 앱 안에서 연 화면은 공유가 막힐 수 있습니다.");
    return;
  }
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
    setPreviewStatus("이 기기는 파일을 직접 공유하지 못합니다. 다운로드 버튼으로 저장한 뒤 카카오톡에서 첨부해 주세요.");
    return;
  }
  setPreviewStatus("공유창을 여는 중입니다…");
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(Object.assign(new Error("응답 없음"), { name: "TimeoutError" })), SHARE_TIMEOUT_MS);
  });
  Promise.race([navigator.share({ files: [file], title: file.name }), timeout])
    .then(() => setPreviewStatus(""))
    .catch((err) => {
      if (err.name === "AbortError") {
        setPreviewStatus(""); // 사용자가 공유를 취소했다
        return;
      }
      console.error("공유 실패", err);
      setPreviewStatus(`공유창을 열지 못했습니다 (${err.message || err.name}). 다운로드 버튼을 이용해 주세요.`);
    });
}

$("pp-close").addEventListener("click", closePrintPreview);
$("pp-print").addEventListener("click", printFromPreview);
$("pp-dl-jpg").addEventListener("click", () => downloadFile("jpg"));
$("pp-dl-pdf").addEventListener("click", () => downloadFile("pdf"));
$("pp-share-jpg").addEventListener("click", () => shareFile("jpg"));
$("pp-share-pdf").addEventListener("click", () => shareFile("pdf"));
window.addEventListener("resize", () => {
  if ($("print-bar").hidden === false) {
    fitPreviewPaper();
    syncBarHeight();
  }
});

// 인쇄 미리보기에서 ESC를 누르면 '닫기' 버튼과 같이 닫는다
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!document.body.classList.contains("print-previewing")) return;
  closePrintPreview();
});
