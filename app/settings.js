// 설정 (마스터 전용): 매칭 엑셀 업/다운로드, 그림 파일 업/다운로드, 매칭 목록(행 추가·수정·삭제), 공업사 등록.
// 서버 API: GET/POST api/mapping, POST api/mapping/row, PATCH/DELETE api/mapping/:id,
//           GET api/images, PUT/GET api/img/:code, GET/POST api/shops, PATCH/DELETE api/shops/:id

const XLSX_CDN = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
const SHEET_HEADER = ["원본순번", "구분", "파트", "주작업항목", "NO", "작업내역", "작업", "수량/시간", "부품액", "공임", "그림코드"];
// 목록 칸 순서 (화면의 열과 같다)
const COLUMNS = ["seq", "group", "part", "item", "no", "text", "workKind", "qty", "partPrice", "labor", "code"];

const $ = (id) => document.getElementById(id);

let mapping = [];          // 서버의 매칭 행
let imageCodes = new Set();
let shops = [];

document.getElementById("ver").textContent =
  typeof APP_VERSION === "string" ? `v${APP_VERSION}` : "";

// 로그인이 필요하면 입력창을 띄우고, 한 번 다시 시도한다
async function api(path, options = {}) {
  const request = () => fetch(path, { credentials: "same-origin", ...options });
  let res = await request();
  if (res.status === 401 && await ensureLogin()) res = await request();
  return res;
}

function jsonBody(data) {
  return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error("불러오지 못했습니다. 인터넷 연결을 확인하세요."));
    document.head.appendChild(script);
  });
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 1200);
}

function cellText(value) {
  return value === undefined || value === null ? "" : String(value);
}

// ---------- 탭 ----------

// 탭: 누른 탭을 기억해서, 새로고침(F5)해도 같은 탭이 열린다
const SETTINGS_TABS = ["mapping", "vehicles", "shops", "meta", "memo-common"];
function showSettingsTab(name) {
  if (!SETTINGS_TABS.includes(name)) return;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  SETTINGS_TABS.forEach((n) => {
    $(`tab-${n}`).hidden = n !== name;
  });
  try { localStorage.setItem("settings-tab", name); } catch (err) { /* 저장을 못 해도 화면은 바뀐다 */ }
}
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => showSettingsTab(btn.dataset.tab));
});
try {
  const saved = localStorage.getItem("settings-tab");
  if (saved) showSettingsTab(saved);
} catch (err) { /* 기억한 탭이 없으면 기본 탭 */ }

// ---------- (1) 엑셀 업/다운로드 ----------

function excelRowsToMapping(sheetRows) {
  return sheetRows
    .map((r) => ({
      seq: cellText(r["원본순번"]).trim(),
      group: cellText(r["구분"]).trim(),
      part: cellText(r["파트"]).trim(),
      item: cellText(r["주작업항목"]).trim(),
      no: cellText(r["NO"]).trim(),
      text: cellText(r["작업내역"]).trim(),
      workKind: cellText(r["작업"]).trim(),
      qty: cellText(r["수량/시간"]).trim(),
      partPrice: cellText(r["부품액"]).trim(),
      labor: cellText(r["공임"]).trim(),
      code: cellText(r["그림코드"]).trim(),
    }))
    .filter((r) => r.text);
}

async function uploadMappingFile(file) {
  const status = $("mapping-status");
  status.textContent = "엑셀을 읽는 중…";
  try {
    await loadScript(XLSX_CDN);
    const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheetName = book.SheetNames.includes("매핑") ? "매핑" : book.SheetNames[0];
    const rows = excelRowsToMapping(XLSX.utils.sheet_to_json(book.Sheets[sheetName], { defval: "" }));
    if (rows.length === 0) throw new Error("'원본순번·구분·파트·주작업항목·작업내역·그림코드' 열이 있는 '매핑' 시트를 찾지 못했습니다.");
    status.textContent = `${rows.length}행을 서버에 저장하는 중…`;
    const res = await api("api/mapping", { method: "POST", ...jsonBody({ rows }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `서버 응답 ${res.status}`);
    status.textContent = `${data.count}행 저장 완료. 작업지시서 화면에 바로 적용됩니다.`;
    await loadMapping();
  } catch (err) {
    status.textContent = err.message;
  }
}

async function downloadMappingFile() {
  const status = $("mapping-status");
  try {
    await loadScript(XLSX_CDN);
    // 항상 서버에서 다시 받아서 쓴다 (F2로 고친 내용이 엑셀에 그대로 들어가도록)
    await loadMapping();
    const body = mapping.map((r) => COLUMNS.slice(0, SHEET_HEADER.length).map((k) => r[k] ?? ""));
    const sheet = XLSX.utils.aoa_to_sheet([SHEET_HEADER, ...body]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "매핑");
    XLSX.writeFile(book, "주작업항목 그림이미지 매칭.xlsx");
    status.textContent = `${mapping.length}행 다운로드했습니다.`;
  } catch (err) {
    status.textContent = err.message;
  }
}

// ---------- (2) 그림 파일 ----------

async function loadImages() {
  const res = await api("api/images");
  if (!res.ok) return;
  const { images } = await res.json();
  imageCodes = new Set(images.map((i) => i.code));
  // 올린 시각을 그림 주소에 넣어, 새로 올린 그림이 브라우저 캐시의 옛 그림으로 보이지 않게 한다
  imageStamp.clear();
  images.forEach((i) => imageStamp.set(i.code, i.uploadedAt || ""));
  $("image-count").textContent = String(imageCodes.size);
  // 그림 목록이 늦게 와도 매칭·비매칭 표시와 선택 항목을 다시 맞춘다
  renderMatchRows();
}

async function uploadImageFiles(files) {
  const status = $("image-status");
  const used = mappingCodes();
  const list = [...files].filter((f) => used.has(f.name.replace(/\.[^.]+$/, "").trim()));
  const skipped = files.length - list.length;
  let done = 0;
  const failed = [];
  for (const file of list) {
    const code = file.name.replace(/\.[^.]+$/, "").trim();
    status.textContent = `그림 올리는 중… ${done + 1} / ${list.length}`;
    try {
      const res = await api(`api/img/${encodeURIComponent(code)}`, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      if (!res.ok) throw new Error(String(res.status));
      imageCodes.add(code);
      forgetImage(code);
    } catch (err) {
      failed.push(file.name);
    }
    done++;
  }
  status.textContent = `${done - failed.length}개 저장 완료` + (skipped ? ` · 주작업항목에 없는 그림 ${skipped}개는 올리지 않았습니다` : "") + (failed.length ? ` · 실패: ${failed.join(", ")}` : "");
  $("image-count").textContent = String(matchedCodes().length);
  renderMatchRows();
}

// zip 을 직접 만든다 (그림은 이미 압축되어 있어 그대로 담는다). 외부 라이브러리를 기다리지 않아 멈추지 않는다
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
// entries: [{ name, data(ArrayBuffer) }] → zip Blob (무압축)
function buildZip(entries) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const bytes = new Uint8Array(data);
    const nameBytes = enc.encode(name);
    const crc = crc32(bytes);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // 이름은 UTF-8
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, bytes.length, true);
    lh.setUint32(22, bytes.length, true);
    lh.setUint16(26, nameBytes.length, true);
    parts.push(lh.buffer, nameBytes, bytes);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, bytes.length, true);
    ch.setUint32(24, bytes.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, nameBytes);
    offset += 30 + nameBytes.length + bytes.length;
  }
  let cdSize = 0;
  for (const p of central) cdSize += p.byteLength;
  parts.push(...central);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  parts.push(end.buffer);
  return new Blob(parts, { type: "application/zip" });
}

// 그림 전체를 zip 으로 받는다. 누르는 즉시 아래 줄에 진행 상황을 보여 준다 (반응이 있도록)
async function downloadImagesZip() {
  const status = $("image-status");
  const btn = $("image-download");
  const label = btn.textContent;
  const codes = matchedCodes();
  if (codes.length === 0) {
    status.textContent = "받을 그림이 없습니다.";
    toast("받을 그림이 없습니다");
    return;
  }
  const show = (msg) => { status.textContent = msg; };
  btn.disabled = true;
  const started = performance.now();
  toast(`그림 ${codes.length}개를 zip 으로 묶는 중입니다`);
  show(`그림 받는 중… 0 / ${codes.length}`);
  try {
    const entries = [];
    const failed = [];
    let done = 0;
    let next = 0;
    let bytes = 0;
    // 그림을 여러 개씩 동시에 받는다 (한 개씩 기다리지 않는다). 미리 받아 둔 그림은 브라우저에서 바로 나온다
    const worker = async () => {
      while (next < codes.length) {
        const code = codes[next++];
        try {
          const entry = await loadImageEntry(code);
          const type = entry.blob.type || "image/jpeg";
          const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("gif") ? "gif" : "jpg";
          const data = await entry.blob.arrayBuffer();
          entries.push({ name: `${code}.${ext}`, data });
          bytes += data.byteLength;
        } catch (err) {
          failed.push(code);
        }
        // 하나 받을 때마다 바로 보여 준다 (아무것도 안 움직이는 것처럼 보이지 않도록)
        done++;
        show(`그림 받는 중… ${done} / ${codes.length} (${(bytes / 1048576).toFixed(1)}MB)`);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    show("zip 만드는 중…");
    await new Promise((r) => setTimeout(r, 0)); // 화면에 문구가 먼저 그려지도록
    const blob = buildZip(entries);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "그림파일.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    show(`${entries.length}개 다운로드했습니다 (${secs}초)` + (failed.length ? ` · 못 받은 그림 ${failed.length}개` : ""));
    toast("zip 다운로드를 시작했습니다");
  } catch (err) {
    show(`다운로드하지 못했습니다: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------- (3) 매칭 목록 ----------

// 목록 나열 순서: 구분 1 먼저, 그다음 구분 안은 보기순서와 같은 규칙
// (마스터가 보기순서를 저장한 구분은 저장된 순서, 아직 안 한 구분은 작업지시서 샘플 C열·L열 순서)
let mappingCustomOrder = {};
function sortMappingForList(rows) {
  const groupNo = (r) => (String(r.group || "").match(/^\s*(\d+)/) || [])[1] || "1";
  const listKey = (r) => {
    const g = groupNo(r);
    const s = Number.isFinite(r.sort) ? r.sort : r.id;
    if (mappingCustomOrder[g]) return s;
    const list = g === "2" ? window.SAMPLE_ORDER.right : window.SAMPLE_ORDER.left;
    const name = String(r.item || "").split(",")[0].trim();
    const at = list.indexOf(name);
    return (at < 0 ? 99999 : at) * 1000000 + s;
  };
  return rows
    .map((r) => ({ r, g: groupNo(r), k: listKey(r) }))
    .sort((a, b) => (a.g < b.g ? -1 : a.g > b.g ? 1 : a.k - b.k))
    .map((x) => x.r);
}

async function loadMapping() {
  const res = await api("api/mapping");
  if (!res.ok) {
    $("list-status").textContent = "목록을 가져오지 못했습니다.";
    return;
  }
  const data = await res.json();
  mappingCustomOrder = data.customOrder || {};
  mapping = sortMappingForList(data.rows || []);
  fillMemoItemOptions();
  renderMatchRows();
}

// ---------- 목록 표시 · 선택 · 수정 ----------

let selectedIds = new Set(); // 체크한 행(id)

// 구분: 숫자만 보인다 ("1. 승용" → "1")
function groupLabel(value) {
  const m = String(value || "").match(/^\s*(\d+)/);
  return m ? m[1] : cellText(value);
}

// 그림 올린 시각(imageStamp)과 이 기기에서 올린 시각(imageBust)을 주소에 넣는다. 올릴 때마다 주소가 바뀌어 옛 캐시를 쓰지 않는다
const imageStamp = new Map(); // code -> 서버에 올린 시각 (api/images 의 uploadedAt)
function imageUrlFor(code) {
  const v = typeof APP_VERSION === "string" ? APP_VERSION : "1";
  const bust = (typeof imageBust !== "undefined" && imageBust.get(code)) || 0;
  const stamp = imageStamp.get(code) || "";
  return `api/img/${encodeURIComponent(code)}?v=${encodeURIComponent(v)}-${encodeURIComponent(stamp)}-${bust}`;
}

// 주작업항목 목록에 실제로 쓰이는 그림 코드 (이 목록과 상관없는 그림은 매칭으로 치지 않는다)
function mappingCodes() {
  return new Set(mapping.map((r) => r.code).filter(Boolean));
}
function matchedCodes() {
  const used = mappingCodes();
  return [...imageCodes].filter((c) => used.has(c));
}

// 이미지존재여부 선택(전체·매칭·비매칭)에 맞는 행
function isMatchedRow(r) {
  return Boolean(r.code && imageCodes.has(r.code));
}
// 작업내역 검색어 (공백·대소문자 무시)
function textQuery() {
  return ($("text-q") ? $("text-q").value : "").trim().toLowerCase().replace(/\s+/g, "");
}
// NO 검색어 (작업내역 왼쪽 NO 칸, 숫자 일부만 입력해도 찾는다)
function noQuery() {
  return ($("no-q") ? $("no-q").value : "").trim().replace(/\s+/g, "");
}
// 구분·파트·주작업항목 선택값 ("" 이면 전체)
function headerFilterValue(id) {
  return $(id) ? $(id).value : "";
}
function visibleRows() {
  const f = $("match-filter") ? $("match-filter").value : "all";
  let rows = mapping;
  if (f === "match") rows = mapping.filter(isMatchedRow);
  else if (f === "nomatch") rows = mapping.filter((r) => !isMatchedRow(r));
  const g = headerFilterValue("group-filter");
  if (g) rows = rows.filter((r) => groupLabel(r.group) === g);
  const p = headerFilterValue("part-filter");
  if (p) rows = rows.filter((r) => String(r.part ?? "").trim() === p);
  const it = headerFilterValue("item-filter");
  if (it) rows = rows.filter((r) => String(r.item ?? "").trim() === it);
  const q = textQuery();
  if (q) rows = rows.filter((r) => String(r.text || "").toLowerCase().replace(/\s+/g, "").includes(q));
  const s = noQuery();
  if (s) rows = rows.filter((r) => String(r.no || "").includes(s));
  return rows;
}

// 이미지존재여부 선택: 목록에 있는 값만 보인다 (매칭만 있으면 비매칭은 빼고, 비매칭만 있으면 매칭은 뺀다)
// 구분·파트·주작업항목 선택지: 목록에 실제로 있는 값만 넣는다 (고른 값이 사라지면 전체로 돌아간다)
function syncHeaderFilter(id, values) {
  const sel = $(id);
  if (!sel) return;
  const keep = sel.value;
  const wanted = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  const same = wanted.length + 1 === sel.options.length && wanted.every((v, i) => sel.options[i + 1].value === v);
  if (same) return;
  sel.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "전체";
  sel.appendChild(all);
  wanted.forEach((v) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  });
  sel.value = wanted.includes(keep) ? keep : "";
  setSearchFilterText(id);
}
function syncMatchFilterOptions() {
  syncHeaderFilter("group-filter", mapping.map((r) => groupLabel(r.group)));
  syncHeaderFilter("part-filter", mapping.map((r) => String(r.part ?? "").trim()));
  syncHeaderFilter("item-filter", mapping.map((r) => String(r.item ?? "").trim()));
  const sel = $("match-filter");
  if (!sel) return;
  const hasMatch = mapping.some(isMatchedRow);
  const hasNo = mapping.some((r) => !isMatchedRow(r));
  const wanted = [["all", "전체"]];
  if (hasMatch) wanted.push(["match", "매칭"]);
  if (hasNo) wanted.push(["nomatch", "비매칭"]);
  const same = wanted.length === sel.options.length && wanted.every(([v], i) => sel.options[i].value === v);
  if (same) return;
  const keep = wanted.some(([v]) => v === sel.value) ? sel.value : "all";
  sel.innerHTML = "";
  wanted.forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    sel.appendChild(o);
  });
  sel.value = keep;
}

function renderMatchRows() {
  const body = $("match-rows");
  body.innerHTML = "";
  syncMatchFilterOptions();
  const shown = visibleRows();
  const positionOf = new Map(mapping.map((r, i) => [r.id, i + 1]));
  // 화면에 보이지 않는 행(필터로 가려진 행)은 선택에서 뺀다: 선택 개수와 삭제 대상이 화면과 일치하도록
  const shownIds = new Set(shown.map((r) => r.id));
  for (const id of [...selectedIds]) if (!shownIds.has(id)) selectedIds.delete(id);
  shown.forEach((r) => {
    const tr = document.createElement("tr");
    tr.dataset.id = String(r.id);
    COLUMNS.forEach((key) => {
      // 맨 왼쪽 NO: 전체 목록 순서대로 1부터 오름차순 (검색·필터로 줄어도 번호는 전체 기준으로 유지)
      if (key === "seq") {
        const numCell = document.createElement("td");
        numCell.textContent = String(positionOf.get(r.id) || "");
        tr.appendChild(numCell);
        return;
      }
      const cell = editableCell(r, key);
      if (key === "text") cell.classList.add("c-text");
      tr.appendChild(cell);
    });
    const matched = Boolean(r.code && imageCodes.has(r.code));
    const st = document.createElement("td");
    st.className = `status-cell ${matched ? "match" : "nomatch"}`;
    st.textContent = matched ? "매칭" : "비매칭";
    tr.appendChild(st);

    const view = document.createElement("td");
    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "small-btn";
    viewBtn.textContent = "보기";
    viewBtn.disabled = !matched;
    viewBtn.addEventListener("click", () => openMatchImage(r.code));
    // 마우스를 올리거나 포커스가 가면 그림을 미리 받아 둔다 (누르면 바로 뜬다)
    viewBtn.addEventListener("pointerenter", () => prefetchImage(r.code));
    viewBtn.addEventListener("focus", () => prefetchImage(r.code));
    view.appendChild(viewBtn);
    tr.appendChild(view);

    const sel = document.createElement("td");
    sel.className = "sel-col";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = selectedIds.has(r.id);
    // 네모 칸을 누른 채 위아래로 끌면, 지나가는 칸들이 시작한 칸과 같은 상태가 된다
    box.addEventListener("click", (e) => e.preventDefault()); // 기본 토글은 아래 pointerdown 에서 처리
    box.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") return; // 휴대폰은 화면 스크롤과 겹치므로 누르기만 처리
      e.preventDefault();
      dragMode = !box.checked;
      dragging = true;
      applySelection(r.id, dragMode, box);
    });
    box.addEventListener("pointerenter", () => {
      if (dragging) applySelection(r.id, dragMode, box);
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === " ") { e.preventDefault(); applySelection(r.id, !box.checked, box); }
    });
    sel.appendChild(box);
    tr.appendChild(sel);

    const del = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "small-btn";
    delBtn.textContent = "삭제";
    // 행의 삭제 버튼: 체크 여부와 상관없이 그 행만 지운다
    delBtn.addEventListener("click", () => deleteRows([r.id]));
    del.appendChild(delBtn);
    tr.appendChild(del);
    body.appendChild(tr);
  });
  $("list-status").textContent = `총 ${mapping.length}행 · 매칭 ${mapping.filter((r) => imageCodes.has(r.code)).length}행`;
  $("list-legend").textContent = "1. 승용, RV1, RV2 // 2. 화물1, 화물2";
  updateSelectTools();
  fitWorkTextColumn();
  // 화면에 보이는 행의 그림부터, 그다음 나머지 행의 그림을 미리 받는다
  queuePreload(shown.filter(isMatchedRow).map((r) => r.code));
  queuePreload(mapping.filter(isMatchedRow).map((r) => r.code));
}

// 개별 선택: 네모 칸을 누르면 그 행만 선택·해제된다 (누른 채 끌면 지나가는 칸도 같은 상태가 된다)
let dragMode = false;
let dragging = false;
function applySelection(id, on, box) {
  if (on) selectedIds.add(id);
  else selectedIds.delete(id);
  box.checked = on;
  updateSelectTools();
}
document.addEventListener("pointerup", () => { dragging = false; });
document.addEventListener("pointercancel", () => { dragging = false; });

// 선택 도구: 선택 개수와 단추 상태
function updateSelectTools() {
  const n = selectedIds.size;
  $("sel-count").textContent = n ? `${n}행 선택` : "";
  $("sel-delete").disabled = n === 0;
}

function toggleSelectAll() {
  const rows = visibleRows();
  const allOn = rows.length && rows.every((r) => selectedIds.has(r.id));
  if (allOn) rows.forEach((r) => selectedIds.delete(r.id));
  else rows.forEach((r) => selectedIds.add(r.id));
  renderMatchRows();
}

// 선택값 삭제하기: 체크된 행을 모두 지운다
async function deleteSelected() {
  if (selectedIds.size === 0) return;
  await deleteRows([...selectedIds]);
}

// 행 삭제 (선택값 삭제하기, 또는 행의 개별 삭제 버튼 공용)
async function deleteRows(ids) {
  if (ids.length === 0) return;
  // 삭제할 행에 연결된 그림이미지 코드 (다른 행이 같은 코드를 쓰지 않는 그림만 함께 지운다)
  const idSet = new Set(ids);
  const candidateCodes = [...new Set(mapping.filter((r) => idSet.has(r.id)).map((r) => r.code).filter(Boolean))];
  if (!confirm(`${ids.length}행을 삭제할까요?\n삭제한 행에만 쓰인 그림이미지도 함께 삭제됩니다.`)) return;

  const btn = $("sel-delete");
  const progress = $("del-status");
  const started = performance.now();
  btn.disabled = true;
  btn.textContent = "삭제 중…";
  progress.textContent = `삭제 중… 행 ${ids.length}개를 지우는 중`;
  try {
    // 1) 행을 한 번에 지운다
    const res = await api("api/mapping/delete", { method: "POST", ...jsonBody({ ids }) });
    if (!res.ok) throw new Error(`행 삭제 실패 (${res.status})`);
    // 화면에서도 바로 뺀다
    mapping = mapping.filter((r) => !idSet.has(r.id));
    ids.forEach((id) => selectedIds.delete(id));
    renderMatchRows();

    // 2) 남은 행이 쓰지 않는 그림만 지운다
    const stillUsed = new Set(mapping.map((r) => r.code).filter(Boolean));
    const imageTargets = candidateCodes.filter((c) => !stillUsed.has(c) && imageCodes.has(c));
    let imagesRemoved = 0;
    if (imageTargets.length) {
      progress.textContent = `삭제 중… 그림 ${imageTargets.length}개를 지우는 중`;
      const imgRes = await api("api/images/delete", { method: "POST", ...jsonBody({ codes: imageTargets }) });
      if (!imgRes.ok) throw new Error(`그림 삭제 실패 (${imgRes.status})`);
      imageTargets.forEach((c) => { imageCodes.delete(c); forgetImage(c); });
      imagesRemoved = imageTargets.length;
    }
    $("image-count").textContent = String(matchedCodes().length);
    renderMatchRows();
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const msg = `삭제 완료: 행 ${ids.length}개${imagesRemoved ? `, 그림 ${imagesRemoved}개` : ""} (${secs}초)`;
    progress.textContent = msg;
    toast("삭제했습니다");
  } catch (err) {
    progress.textContent = `삭제하지 못했습니다: ${err.message}. 목록을 다시 불러옵니다.`;
    await loadMapping();
    await loadImages();
  } finally {
    btn.textContent = "선택값 삭제하기";
    btn.disabled = false;
    updateSelectTools();
  }
}

// 그림을 미리 받아 두는 주소 기록 (같은 그림은 한 번만 받는다)
const prefetched = new Set();
// 그림 저장소: 받은 그림은 메모리에 두고 주소(objectURL)로 바로 쓴다. 팝업·zip 이 다시 받지 않도록
const imageStore = new Map(); // code -> Promise<{ blob, url }>
const imageReady = new Map(); // code -> { blob, url } (받기가 끝난 그림)
function loadImageEntry(code) {
  if (!imageStore.has(code)) {
    const p = api(imageUrlFor(code)).then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const entry = { blob, url: URL.createObjectURL(blob) };
      imageReady.set(code, entry);
      return entry;
    });
    p.catch(() => imageStore.delete(code));
    imageStore.set(code, p);
  }
  return imageStore.get(code);
}
// 그림이 바뀌었으면(올리기·삭제) 저장해 둔 그림을 버린다
function forgetImage(code) {
  const entry = imageReady.get(code);
  imageReady.delete(code);
  imageStore.delete(code);
  if (entry) URL.revokeObjectURL(entry.url);
}
function prefetchImage(code) {
  if (!code || !imageCodes.has(code) || prefetched.has(code)) return;
  prefetched.add(code);
  loadImageEntry(code).catch(() => {});
}

// 그림 미리 받기: 화면의 매칭 그림부터 백그라운드에서 하나씩 받아 브라우저에 저장해 둔다.
// 받은 그림은 imageReady 에 남아, 팝업·zip 이 기다리지 않고 바로 쓴다
const preloadQueued = new Set();
const preloadQueue = [];
let preloadActive = 0;
function queuePreload(codes) {
  for (const code of codes) {
    if (!code || !imageCodes.has(code) || preloadQueued.has(code)) continue;
    preloadQueued.add(code);
    preloadQueue.push(code);
  }
  pumpPreload();
}
function pumpPreload() {
  while (preloadActive < 4 && preloadQueue.length) {
    const code = preloadQueue.shift();
    preloadActive++;
    loadImageEntry(code)
      .catch(() => {})
      .finally(() => { preloadActive--; pumpPreload(); });
  }
}

// 그림 보기: 공업사 화면과 같은 팝업으로 크게 보인다 (누르면 닫힌다)
function openMatchImage(code) {
  if (!code || !imageCodes.has(code)) return;
  const modal = $("tip-modal");
  $("tip-image").src = imageUrlFor(code);
  $("tip-caption").textContent = code;
  modal.classList.add("full");
  modal.hidden = false;
}

// 그림이미지코드를 누르면: 바로 파일 선택창이 뜨고, 파일을 고르면 자동으로 올라간다
let codeUploadRow = null;
const codeFileInput = document.createElement("input");
codeFileInput.type = "file";
codeFileInput.accept = "image/*";
codeFileInput.hidden = true;
document.body.appendChild(codeFileInput);
codeFileInput.addEventListener("change", async () => {
  const file = codeFileInput.files[0];
  const row = codeUploadRow;
  codeFileInput.value = "";
  if (!file || !row || !row.code) return;
  await uploadImageForCode(row.code, file);
});

function openCodeUpload(row) {
  if (!row.code) { toast("그림이미지코드가 없습니다. F2로 먼저 적어 주세요"); return; }
  codeUploadRow = row;
  codeFileInput.click();
}

// 그림을 올린 시각: 같은 코드의 새 그림이 옛 캐시로 보이지 않게 주소를 바꾼다
const imageBust = new Map();

// 큰 사진은 올리기 전에 줄인다 (긴 쪽 1600px, JPEG). 화면에서 보기에는 충분하고 훨씬 빨리 올라간다
async function shrinkImage(file) {
  if (!file.type.startsWith("image/") || file.size < 300 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return out && out.size < file.size ? out : file;
  } catch (err) {
    return file;
  }
}

async function uploadImageForCode(code, file) {
  toast("그림을 올리는 중…");
  const body = await shrinkImage(file);
  const res = await api(`api/img/${encodeURIComponent(code)}`, {
    method: "PUT",
    headers: { "Content-Type": body.type || "image/jpeg" },
    body,
  });
  if (!res.ok) {
    toast("올리지 못했습니다. 다시 시도해 주세요");
    return false;
  }
  imageCodes.add(code);
  imageBust.set(code, Date.now());
  imageStamp.set(code, new Date().toISOString());
  forgetImage(code);
  // 방금 올린 그림을 이 기기에 바로 넣어 둔다: 저장소 반영이 조금 늦어도 작업내역 팝업과 ZIP 에 새 그림이 나온다
  const entry = { blob: body, url: URL.createObjectURL(body) };
  imageReady.set(code, entry);
  imageStore.set(code, Promise.resolve(entry));
  prefetched.delete(code);
  renderMatchRows();
  toast("그림을 올렸습니다");
  return true;
}

// 칸: 클릭은 복사(그림이미지코드는 그림 올리기), F2는 이 행 전체를 입력칸으로 바꾼다
function editableCell(row, key) {
  const td = document.createElement("td");
  td.className = "editable";
  td.dataset.key = key;
  td.tabIndex = 0;
  td.textContent = key === "group" ? groupLabel(row[key]) : cellText(row[key]);
  td.title = key === "code" ? "클릭: 그림 올리기 · F2: 행 수정" : "클릭: 복사 · F2: 행 수정";
  td.addEventListener("click", () => {
    if (td.querySelector("input")) return; // 편집 중에는 클릭이 입력 칸에만 간다
    if (key === "code") { openCodeUpload(row); return; }
    // 복사는 조용히 한다 (안내 팝업 없음)
    if (navigator.clipboard) navigator.clipboard.writeText(cellText(row[key])).catch(() => {});
  });
  td.addEventListener("keydown", (e) => {
    if (e.key === "F2") {
      e.preventDefault();
      startCellEdit(td, row);
    }
  });
  return td;
}

// F2: 클릭한 칸 하나만 입력칸으로 바꾼다. Enter 는 저장, Esc 는 취소
function startCellEdit(td, row) {
  if (!td || td.querySelector("input")) return;
  const key = td.dataset.key;
  const input = document.createElement("input");
  input.type = "text";
  input.value = cellText(row[key]);
  td.textContent = "";
  td.appendChild(input);
  input.focus();
  input.select();

  // Enter 또는 Esc 를 누르기 전까지는 입력 칸이 계속 활성화되어 있어야 한다 (다른 칸을 눌러도 포커스를 되찾는다)
  let finished = false;
  input.addEventListener("blur", () => {
    if (finished || !input.isConnected) return;
    setTimeout(() => { if (!finished && input.isConnected) input.focus({ preventScroll: true }); }, 0);
  });

  const save = async () => {
    finished = true;
    const value = input.value.trim();
    if (value === cellText(row[key]).trim()) { renderMatchRows(); return; }
    const res = await api(`api/mapping/${row.id}`, { method: "PATCH", ...jsonBody({ [key]: value }) });
    if (res.ok) {
      row[key] = value;
      toast("저장되었습니다");
    } else {
      toast("저장하지 못했습니다");
    }
    renderMatchRows();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    if (e.key === "Escape") { e.preventDefault(); finished = true; renderMatchRows(); }
  });
}

// 선택 도구·그림 팝업 연결
// 목록 제목 '선택'을 누르면 모두 선택, 다시 누르면 선택 해제 (보이는 행 기준)
$("sel-head").addEventListener("click", toggleSelectAll);
$("sel-delete").addEventListener("click", deleteSelected);
$("code-upload-close").addEventListener("click", () => { $("code-modal").hidden = true; });
$("tip-modal").addEventListener("click", () => { $("tip-modal").hidden = true; });

// 작업내역 그림 창: 프로그램 화면 밖으로도 옮기고 크기를 바꿀 수 있는 별도의 창
// - 처음 한 번은 작업내역을 클릭해야 창이 열린다 (브라우저는 클릭으로 연 창만 허용한다)
// - 창이 열린 뒤에는 작업내역에 마우스를 올리면 그 행의 그림으로 바뀐다
// - 작업내역을 클릭하면 그 행의 그림으로 고정된다. 고정된 동안은 마우스를 올려도 바뀌지 않는다
// - 다른 작업내역을 클릭하면 그 그림으로 바뀌고 다시 고정된다
// - 그림 창을 클릭하면 닫힌다. 창 크기와 위치는 사용자가 정한 대로 유지된다
const matchRows = $("match-rows");
let hoverWin = null;
let hoverCode = null;
let hoverLocked = false;
let hoverToken = 0;

function hoverDoc() {
  return hoverWin && !hoverWin.closed ? hoverWin.document : null;
}
function openHoverWin() {
  if (hoverDoc()) return true;
  const w = Math.min(900, Math.round(screen.availWidth * 0.6));
  const h = Math.min(760, Math.round(screen.availHeight * 0.8));
  const left = Math.max(0, screen.availWidth - w - 40);
  const top = Math.max(0, Math.round((screen.availHeight - h) / 2));
  hoverWin = window.open("about:blank", "workorder-match-image", `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=no`);
  if (!hoverWin) {
    toast("그림 창을 허용해 주세요 (주소창의 차단 표시를 누르세요)");
    return false;
  }
  const d = hoverWin.document;
  d.open();
  d.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>그림</title><style>'
    + 'html,body{margin:0;height:100%;background:#111;color:#eee;font-family:sans-serif;overflow:hidden}'
    + '#pic{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;cursor:pointer}'
    + '#msg{position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer}'
    + '#cap{display:none}' // 그림 아래 주석은 보이지 않는다
    + '</style></head><body><img id="pic" alt=""><div id="msg"></div><div id="cap"></div></body></html>');
  d.close();
  // 그림 창을 클릭하면 닫힌다
  hoverWin.document.body.addEventListener("click", () => {
    hoverLocked = false;
    hoverWin.close();
  });
  return true;
}

// 창에 그림을 그린다. 받아 둔 그림은 바로, 아직이면 "불러오는 중"을 보인 뒤 받는 대로 바꾼다
function paintHoverWin(code, label) {
  const d = hoverDoc();
  if (!d) return;
  const pic = d.getElementById("pic");
  const msg = d.getElementById("msg");
  const cap = d.getElementById("cap");
  const token = ++hoverToken;
  const lockText = hoverLocked ? "고정 · " : "";
  if (code && imageCodes.has(code)) {
    cap.textContent = `${lockText}${code} · 클릭하면 닫힘`;
    const ready = imageReady.get(code);
    if (ready) {
      pic.src = ready.url;
      pic.style.display = "";
      msg.style.display = "none";
      return;
    }
    pic.style.display = "none";
    msg.style.display = "";
    msg.textContent = "그림 불러오는 중…";
    loadImageEntry(code).then((entry) => {
      if (token !== hoverToken || !hoverDoc()) return;
      pic.src = entry.url;
      pic.style.display = "";
      msg.style.display = "none";
    }).catch(() => {
      if (token !== hoverToken || !hoverDoc()) return;
      msg.textContent = "그림을 불러오지 못했습니다";
    });
    return;
  }
  pic.style.display = "none";
  msg.style.display = "";
  msg.textContent = "그림 없음";
  cap.textContent = label || "그림 없음";
}
function showRowImage(tr) {
  const row = mapping.find((r) => String(r.id) === tr.dataset.id);
  const code = row && row.code;
  hoverCode = code || null;
  paintHoverWin(code, code ? `${code} · 그림 없음` : "그림 없음");
}

// 마우스를 올리면: 창이 열려 있고 고정되지 않은 상태에서만 바뀐다
matchRows.addEventListener("mouseover", (e) => {
  if (hoverLocked || !hoverDoc()) return;
  const td = e.target.closest("td.c-text");
  if (!td) return; // 같은 행의 다른 칸으로 옮겨도 그대로 둔다
  showRowImage(td.closest("tr"));
});
// 작업내역을 클릭하면: 창을 열고(처음 한 번), 그 행의 그림으로 바뀌어 고정된다
matchRows.addEventListener("click", (e) => {
  const td = e.target.closest("td.c-text");
  if (!td || td.querySelector("input")) return; // 편집 중인 칸을 누르면 팝업을 띄우거나 포커스를 빼앗지 않는다
  const opened = openHoverWin();
  // 그림 창이 새로 열리면 포커스가 그쪽으로 가므로, 목록으로 되돌리고 이 칸을 잡아 둔다 (F2 편집이 바로 되도록)
  window.focus();
  td.focus({ preventScroll: true });
  if (!opened) return;
  hoverLocked = true;
  showRowImage(td.closest("tr"));
});

// ---------- (4) 공업사 등록 ----------

let shopRows = [];

async function loadShops() {
  const res = await api("api/shops");
  if (!res.ok) return;
  const data = await res.json();
  shopRows = data.shops || [];
  renderShops();
}

function renderShops() {
  const body = $("shop-rows");
  if (!body) return;
  body.innerHTML = "";
  shopRows.forEach((s, i) => {
    const tr = document.createElement("tr");
    const no = document.createElement("td");
    no.textContent = String(i + 1);
    const name = document.createElement("td");
    name.textContent = s.name;
    const id = document.createElement("td");
    id.textContent = s.loginId;
    const pw = document.createElement("td");
    const pwInput = document.createElement("input");
    pwInput.type = "password";
    pwInput.placeholder = "바꿀 때만 입력";
    pwInput.autocomplete = "new-password";
    const pwBtn = document.createElement("button");
    pwBtn.type = "button";
    pwBtn.className = "small-btn";
    pwBtn.textContent = "비밀번호 변경";
    pwBtn.addEventListener("click", async () => {
      if (pwInput.value.length < 8) { toast("비밀번호는 8자 이상이어야 합니다"); return; }
      const res = await api(`api/shops/${encodeURIComponent(s.id)}`, { method: "PATCH", ...jsonBody({ password: pwInput.value }) });
      toast(res.ok ? "비밀번호를 바꿨습니다" : "바꾸지 못했습니다");
      pwInput.value = "";
    });
    const pwWrap = document.createElement("div");
    pwWrap.className = "pw-cell";
    pwWrap.append(pwInput, pwBtn);
    pw.appendChild(pwWrap);
    const created = document.createElement("td");
    created.textContent = String(s.createdAt || "").slice(0, 10);
    const act = document.createElement("td");
    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "small-btn";
    nameBtn.textContent = "이름 변경";
    nameBtn.addEventListener("click", async () => {
      const next = prompt("새 공업사명", s.name);
      if (!next || next.trim() === s.name) return;
      const res = await api(`api/shops/${encodeURIComponent(s.id)}`, { method: "PATCH", ...jsonBody({ name: next.trim() }) });
      if (res.ok) await loadShops(); else toast("바꾸지 못했습니다");
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "small-btn";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`'${s.name}' 공업사를 삭제할까요? 이 공업사의 작업지시서 목록은 그대로 남습니다.`)) return;
      const res = await api(`api/shops/${encodeURIComponent(s.id)}`, { method: "DELETE" });
      if (res.ok) await loadShops(); else toast("삭제하지 못했습니다");
    });
    act.append(nameBtn, " ", delBtn);
    tr.append(no, name, id, pw, created, act);
    body.appendChild(tr);
  });
}

$("shop-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("shop-status");
  const name = $("shop-name").value.trim();
  const loginId = $("shop-id").value.trim();
  const password = $("shop-pw").value;
  const res = await api("api/shops", { method: "POST", ...jsonBody({ name, loginId, password }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    status.textContent = data.error || "등록하지 못했습니다";
    return;
  }
  status.textContent = `'${name}' 공업사를 등록했습니다.`;
  $("shop-form").reset();
  await loadShops();
});

// ---------- (5) 보험사·담보·도장코드 ----------

let optionLists = { insurers: [], coverages: [] };

async function loadOptions() {
  const res = await api("api/options");
  if (!res.ok) return;
  optionLists = await res.json();
  renderOptionList("insurer", optionLists.insurers || []);
  renderOptionList("coverage", optionLists.coverages || []);
}

function renderOptionList(kind, items) {
  const list = $(`${kind}-list`);
  if (!list) return;
  list.innerHTML = "";
  items.forEach((it) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = it.value;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "small-btn";
    del.textContent = "삭제";
    del.addEventListener("click", async () => {
      if (!confirm(`'${it.value}'을(를) 목록에서 지울까요?`)) return;
      const res = await api(`api/options/${it.id}`, { method: "DELETE" });
      if (res.ok) await loadOptions(); else toast("지우지 못했습니다");
    });
    li.append(text, " ", del);
    list.appendChild(li);
  });
  $(`${kind}-count`).textContent = String(items.length);
}

async function addOption(kind) {
  const input = $(`${kind}-new`);
  const value = input.value.trim();
  if (!value) return;
  const res = await api("api/options", { method: "POST", ...jsonBody({ kind, value }) });
  if (res.ok) {
    input.value = "";
    await loadOptions();
  } else {
    toast("추가하지 못했습니다");
  }
}

$("insurer-add").addEventListener("click", () => addOption("insurer"));
$("coverage-add").addEventListener("click", () => addOption("coverage"));

// 도장코드 목록
async function loadPaintCodes() {
  const res = await api("api/paintcodes");
  if (!res.ok) return;
  const { codes } = await res.json();
  const list = $("paint-list");
  list.innerHTML = "";
  codes.forEach((c) => {
    const li = document.createElement("li");
    const n = String(c.coats || "").replace(/(코트|코드)+$/, "").trim();
    li.textContent = n ? `${c.code} (${n}코트)` : c.code;
    list.appendChild(li);
  });
  $("paint-count").textContent = String(codes.length);
}

// 도장코드 엑셀 업로드: 첫 줄 머리글에서 번호·도장코드·코트수 열을 찾는다
$("paint-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const status = $("paint-status");
  try {
    await loadScript(XLSX_CDN);
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const head = (rows[0] || []).map((h) => cellText(h).replace(/\s/g, ""));
    const find = (words) => head.findIndex((h) => words.some((w) => h.includes(w)));
    const iNo = find(["NO", "번호"]);
    const iCode = find(["도장코드", "코드"]);
    const iCoats = find(["코트"]);
    if (iCode < 0) { status.textContent = "도장코드 열을 찾지 못했습니다."; return; }
    const body = rows.slice(1)
      .map((r) => ({ no: iNo >= 0 ? cellText(r[iNo]) : "", code: cellText(r[iCode]).trim(), coats: iCoats >= 0 ? cellText(r[iCoats]) : "" }))
      .filter((r) => r.code);
    const res = await api("api/paintcodes", { method: "POST", ...jsonBody({ rows: body }) });
    status.textContent = res.ok ? `${body.length}개 도장코드를 올렸습니다.` : "올리지 못했습니다.";
    await loadPaintCodes();
  } catch (err) {
    status.textContent = err.message;
  }
});

// ---------- 차량명정의 (CSV) ----------

let vehicleList = [];

// CSV 한 줄씩 나눈다 (큰따옴표 안의 쉼표는 칸이 아니다)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// UTF-8 으로 안 읽히면 EUC-KR(cp949) 로 읽는다
function decodeCsvBuffer(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
  } catch (err) {
    return new TextDecoder("euc-kr").decode(buffer);
  }
}

async function loadVehicles() {
  const res = await api("api/vehicles");
  if (!res.ok) return;
  const data = await res.json();
  vehicleList = data.vehicles || [];
  renderVehicleList();
}

function renderVehicleList() {
  const body = $("vehicle-rows");
  if (!body) return;
  body.innerHTML = "";
  vehicleList.forEach((v, i) => {
    const tr = document.createElement("tr");
    [String(i + 1), v.name, v.group, v.type, v.cls, v.maker, String(v.count ?? "")].forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text ?? "";
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  $("vehicle-count").textContent = String(vehicleList.length);
}

$("vehicle-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const status = $("vehicle-status");
  const rows = parseCsv(decodeCsvBuffer(await file.arrayBuffer()));
  if (rows.length < 2) { status.textContent = "차량명 자료가 비어 있습니다."; return; }
  const head = rows[0].map((h) => h.replace(/\s/g, ""));
  const col = (name) => head.indexOf(name);
  const iName = col("차량명");
  if (iName < 0) { status.textContent = "'차량명' 열을 찾지 못했습니다."; return; }
  const pick = (r, name) => (col(name) >= 0 ? cellText(r[col(name)]).trim() : "");
  const vehicles = rows.slice(1)
    .map((r) => ({
      name: cellText(r[iName]).trim(),
      group: pick(r, "그룹명"),
      category: pick(r, "유형"),
      type: pick(r, "탈부착"),
      cls: pick(r, "차량급"),
      maker: pick(r, "제작사"),
      count: Number(pick(r, "작업항목수")) || 0,
    }))
    .filter((v) => v.name);
  const res = await api("api/vehicles", { method: "PUT", ...jsonBody({ vehicles }) });
  if (!res.ok) { status.textContent = "올리지 못했습니다."; return; }
  status.textContent = `${vehicles.length}개 차량명을 올렸습니다.`;
  await loadVehicles();
});

$("vehicle-download").addEventListener("click", () => {
  const head = ["NO", "차량명", "그룹명", "유형", "차량급", "제작사", "작업항목수"];
  const esc = (t) => `"${String(t ?? "").replace(/"/g, '""')}"`;
  const lines = [head.join(",")].concat(vehicleList.map((v, i) =>
    [i + 1, v.name, v.group, v.type, v.cls, v.maker, v.count].map(esc).join(",")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "차량명정의.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- 기타메모사항 (전체 공업사 공통) ----------

let commonMemo = [];

async function loadCommonMemo() {
  const res = await api("api/memos");
  if (!res.ok) return;
  const data = await res.json();
  commonMemo = (data.global || []).map((x) => ({ value: x.value, category: x.category || "" }));
  renderCommonMemo();
}

// 주작업항목 이름 목록 (매칭 목록의 파트별 항목)
function fillMemoItemOptions() {
  const select = $("memo-new-item");
  if (!select) return;
  const byPart = new Map();
  for (const r of mapping) {
    if (!r.part || !r.item) continue;
    if (!byPart.has(r.part)) byPart.set(r.part, new Set());
    byPart.get(r.part).add(r.item);
  }
  select.innerHTML = "";
  select.appendChild(new Option("주작업항목 선택", ""));
  for (const [part, names] of byPart) {
    const group = document.createElement("optgroup");
    group.label = part;
    for (const name of names) group.appendChild(new Option(name, name));
    select.appendChild(group);
  }
}

// 설정된 주작업항목 이름 (줄 맨 앞의 주작업항목과 나머지 내용을 나눈다)
function splitCommonMemo(text) {
  let item = "";
  for (const r of mapping) {
    if (r.item && text.startsWith(r.item + " ") && r.item.length > item.length) item = r.item;
  }
  return { item, body: item ? text.slice(item.length + 1) : text };
}

function renderCommonMemo() {
  const body = $("memo-bank-rows");
  if (!body) return;
  body.innerHTML = "";
  commonMemo.forEach((draft, i) => {
    const tr = document.createElement("tr");
    const no = document.createElement("td");
    no.textContent = String(i + 1);
    const { item, body: text } = splitCommonMemo(draft.value || "");
    const itemCell = document.createElement("td");
    itemCell.textContent = item || "-";
    const input = document.createElement("td");
    const field = document.createElement("input");
    field.type = "text";
    field.value = text;
    field.placeholder = "기타메모 내용";
    field.addEventListener("input", () => {
      commonMemo[i].value = (item ? item + " " : "") + field.value;
    });
    input.appendChild(field);
    const del = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "small-btn";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", () => {
      commonMemo.splice(i, 1);
      renderCommonMemo();
    });
    del.appendChild(delBtn);
    tr.append(no, itemCell, input, del);
    body.appendChild(tr);
  });
}

$("memo-new-add").addEventListener("click", () => {
  const item = $("memo-new-item").value;
  const text = $("memo-new-text").value.trim();
  if (!text) return;
  commonMemo.push({ value: item ? `${item} ${text}` : text, category: "" });
  $("memo-new-text").value = "";
  renderCommonMemo();
});

$("memo-row-add").addEventListener("click", () => {
  commonMemo.push({ value: "", category: "" });
  renderCommonMemo();
});

$("memo-common-save").addEventListener("click", async () => {
  const values = commonMemo.map((d) => ({ value: String(d.value || "").trim(), category: d.category || "" })).filter((x) => x.value);
  const res = await api("api/memos", { method: "PUT", ...jsonBody({ values }) });
  $("memo-status").textContent = res.ok ? "저장했습니다. 모든 공업사에 적용됩니다." : "저장하지 못했습니다.";
  if (res.ok) await loadCommonMemo();
});


// ---------- 마스터 비밀번호 바꾸기 ----------
$("master-pw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("master-pw-status");
  const current = $("master-pw-current").value;
  const next = $("master-pw-next").value;
  const next2 = $("master-pw-next2").value;
  if (next.length < 8) { status.textContent = "새 비밀번호는 8자 이상이어야 합니다."; return; }
  if (next !== next2) { status.textContent = "새 비밀번호 두 칸이 서로 다릅니다."; return; }
  const res = await api("api/master/password", { method: "POST", ...jsonBody({ current, next }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { status.textContent = data.error || "바꾸지 못했습니다."; return; }
  status.textContent = "비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰세요.";
  $("master-pw-form").reset();
});

// ---------- 화면 열기: 마스터만 설정 본문을 보인다 (로그인 안 되어 있으면 로그인 창을 띄운다) ----------
async function gateSettings() {
  let session = await getSession();
  if (!session.ok && typeof ensureLogin === "function") {
    if (await ensureLogin()) session = await getSession();
  }
  if (session.ok && session.role === "master") {
    $("settings-body").hidden = false;
    $("denied").hidden = true;
    $("who").textContent = "마스터";
    return true;
  }
  $("denied").hidden = false;
  return false;
}

gateSettings().then(async (ok) => {
  try {
    if (ok) {
      // 주작업항목 목록과 그림 목록을 먼저 받아 그린 뒤에 화면을 보인다 (중간 화면이 보이지 않게)
      await Promise.all([loadMapping(), loadImages()]);
      loadShops();
      loadVehicles();
      loadOptions();
      loadPaintCodes();
      loadCommonMemo();
    }
  } finally {
    document.documentElement.classList.remove("booting");
  }
});
$("match-filter").addEventListener("change", renderMatchRows);
// 구분·파트·주작업항목 선택: 목록에 있는 값만 골라 걸러 본다
["group-filter", "part-filter", "item-filter"].forEach((id) => $(id).addEventListener("change", renderMatchRows));

// 파트·주작업항목 선택: 글자를 치면 목록이 줄어드는 검색 칸. 실제 값은 숨은 select에 들어가므로 아래 필터 로직은 그대로 쓴다.
const SEARCH_FILTER_IDS = ["part-filter", "item-filter"];
const searchFilters = new Map();
function searchFilterLabel(sel) {
  return sel.value || "전체";
}
function setSearchFilterText(id) {
  const f = searchFilters.get(id);
  if (f) f.input.value = searchFilterLabel(f.sel);
}
function buildSearchFilter(id) {
  const sel = $(id);
  if (!sel || searchFilters.has(id)) return;
  const wrap = document.createElement("span");
  wrap.className = "sf-wrap";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "sf-input";
  input.autocomplete = "off";
  input.placeholder = "검색";
  input.setAttribute("aria-label", `${sel.getAttribute("aria-label")} 검색`);
  const list = document.createElement("div");
  list.className = "sf-list";
  list.hidden = true;
  wrap.append(input, list);
  sel.parentNode.insertBefore(wrap, sel);
  sel.hidden = true;
  searchFilters.set(id, { sel, input, list });

  const choose = (value) => {
    sel.value = value;
    input.value = searchFilterLabel(sel);
    list.hidden = true;
    sel.dispatchEvent(new Event("change"));
  };
  const draw = () => {
    const typed = input.value.trim().toLowerCase().replace(/\s+/g, "");
    const showAll = typed === "" || input.value === searchFilterLabel(sel);
    list.innerHTML = "";
    [...sel.options].forEach((o) => {
      const key = o.textContent.toLowerCase().replace(/\s+/g, "");
      if (!showAll && !key.includes(typed)) return;
      const item = document.createElement("div");
      item.textContent = o.textContent;
      item.dataset.value = o.value;
      if (o.value === sel.value) item.classList.add("on");
      // mousedown에서 막아 두면 입력칸의 focus가 빠지지 않아서, 목록을 누르면 바로 고른다
      item.addEventListener("mousedown", (e) => { e.preventDefault(); choose(o.value); });
      list.appendChild(item);
    });
    if (!list.children.length) {
      const none = document.createElement("div");
      none.className = "sf-empty";
      none.textContent = "맞는 항목이 없습니다";
      list.appendChild(none);
    }
    list.hidden = false;
  };
  input.addEventListener("focus", () => { input.select(); draw(); });
  input.addEventListener("click", draw);
  input.addEventListener("input", draw);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = list.querySelector("[data-value]");
      if (first) choose(first.dataset.value);
    } else if (e.key === "Escape") {
      input.value = searchFilterLabel(sel);
      list.hidden = true;
      input.blur();
    }
  });
  input.addEventListener("blur", () => {
    list.hidden = true;
    input.value = searchFilterLabel(sel);
  });
}
SEARCH_FILTER_IDS.forEach(buildSearchFilter);
// 작업내역 검색: 글자를 입력하는 대로 목록이 줄어든다
$("text-q").addEventListener("input", renderMatchRows);
$("no-q").addEventListener("input", renderMatchRows);

// ---------- 목록 숨기기: 숨길 열을 고른다 (기억해서 다음에도 같다) ----------
const MATCH_COLS = [
  "NO", "구분", "파트", "주작업항목", "NO", "작업내역", "작업", "수량/시간", "부품액", "공임",
  "그림이미지코드", "이미지존재여부", "이미지보기", "선택",
];
const HIDDEN_COLS_KEY = "settings-match-hidden-cols";

function loadHiddenCols() {
  try {
    const list = JSON.parse(localStorage.getItem(HIDDEN_COLS_KEY) || "[]");
    return Array.isArray(list) ? list.filter((i) => Number.isInteger(i) && i >= 0 && i < MATCH_COLS.length) : [];
  } catch (err) {
    return [];
  }
}

function saveHiddenCols(list) {
  try { localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify(list)); } catch (err) { /* 저장을 못 해도 화면은 바뀐다 */ }
}

// 숨긴 열을 표에 적용한다
function applyHiddenCols() {
  const table = $("match-table");
  if (!table) return;
  const list = loadHiddenCols();
  table.className = "orders match-table" + list.map((i) => ` hide-c${i}`).join("");
  const btn = $("list-toggle");
  if (btn) btn.classList.toggle("on", list.length > 0); // 숨긴 열이 있으면 녹색
}

// 열 목록 선택창을 연다 (체크한 열은 숨긴다)
let colDraft = [];
function openColumnChooser() {
  colDraft = loadHiddenCols();
  const box = $("col-list");
  box.innerHTML = "";
  MATCH_COLS.forEach((label, i) => {
    const row = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = colDraft.includes(i);
    cb.addEventListener("change", () => {
      colDraft = cb.checked ? [...new Set([...colDraft, i])] : colDraft.filter((x) => x !== i);
    });
    row.append(cb, document.createTextNode(label));
    box.appendChild(row);
  });
  $("col-modal").hidden = false;
}

function fitWorkTextColumn() {
  // 작업내역 칸의 폭은 CSS 에서 정한다 (표 안에서 줄바꿈)
}

$("list-toggle").addEventListener("click", openColumnChooser);
$("col-all").addEventListener("click", () => {
  colDraft = [];
  document.querySelectorAll("#col-list input").forEach((cb) => { cb.checked = false; });
});
$("col-cancel").addEventListener("click", () => { $("col-modal").hidden = true; });
$("col-apply").addEventListener("click", () => {
  saveHiddenCols(colDraft);
  applyHiddenCols();
  $("col-modal").hidden = true;
  toast(colDraft.length ? `${colDraft.length}개 열을 숨겼습니다` : "모든 열을 보입니다");
});
$("col-modal").addEventListener("click", (e) => {
  if (e.target === $("col-modal")) $("col-modal").hidden = true;
});

// ---------- 보기순서 변경: 별도 창에서 끌어서 순서를 정한다 ----------
function openOrderWindow() {
  // 창은 모니터 가운데에 뜬다 (주 모니터 기준). 높이는 화면 높이에 맞춘다.
  const scr = window.screen;
  const areaW = scr.availWidth || 1280;
  const areaH = scr.availHeight || 900;
  const width = Math.min(1600, Math.round(areaW * 0.95)); // 글씨가 한 줄로 다 보이도록 넓게
  const height = Math.min(Math.max(760, Math.round(areaH * 0.95)), areaH);
  const left = (scr.availLeft || 0) + Math.max(0, Math.round((areaW - width) / 2));
  const top = (scr.availTop || 0) + Math.max(0, Math.round((areaH - height) / 2));
  const win = window.open("order-sort.html?group=1", "tip-order-sort", `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`);
  if (win) win.focus();
  else location.href = "order-sort.html?group=1";
}
$("order-open").addEventListener("click", openOrderWindow);

// 엑셀·그림 업/다운로드 단추 연결 (이 연결이 빠져 있어서 누를 때 반응이 없었다)
$("mapping-download").addEventListener("click", downloadMappingFile);
$("mapping-file").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (file) uploadMappingFile(file);
});
// 업로드 단추: 누르면 파일 고르기 창을 연다 (단추를 직접 연결해 반응이 확실하도록)
$("mapping-upload-btn").addEventListener("click", () => {
  $("mapping-status").textContent = "엑셀 파일을 고르세요.";
  $("mapping-file").click();
});
$("image-upload-btn").addEventListener("click", () => {
  $("image-status").textContent = "그림 파일을 고르세요 (여러 개 선택 가능).";
  $("image-files").click();
});
$("image-download").addEventListener("click", downloadImagesZip);
$("image-files").addEventListener("change", (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = "";
  if (files.length) uploadImageFiles(files);
});

applyHiddenCols();

