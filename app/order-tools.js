// 작업지시서 화면의 추가 기능: 보기/수정 잠금, 나가기 확인, 기타메모사항, 일반 작업.
// app.js 의 state 와 함수들을 쓰므로 app.js 보다 먼저 읽히고, 실행은 setupOrderTools() 를 app.js 가 부른다.

const GENERAL_ITEMS = [
  "전자제어시스템 진단 및 코팅",
  "휠얼라인먼트",
  "사전계측(일반)",
  "차량세팅(마루식)",
  "전측방센서 보정 및 시운전",
  "전방레이더센서 보정 및 시운전",
  "후측방센서 보정 및 시운전",
];

const MEMO_BANK_KEY = "memo-bank";

// ---------- 보기 잠금 · 변경 표시 ----------

// 잠겨 있으면 안내만 띄우고 막는다. 막았으면 true
function guardLocked(message) {
  if (!state.locked) return false;
  showNotice(message || (state.role === "master"
    ? "마스터 계정은 보기 전용입니다."
    : "수정 버튼을 클릭하여 수정해주세요"));
  return true;
}

function markDirty() {
  state.dirty = true;
}

// 수정 버튼은 공업사 계정이 잠긴 작업지시서를 볼 때만 보인다
function updateLockUI() {
  const editBtn = $("edit-order");
  const note = $("lock-note");
  if (editBtn) editBtn.hidden = !(state.locked && state.role === "shop");
  if (note) note.hidden = !state.locked;
  const ack = $("ack-order");
  if (ack) ack.hidden = !(state.revised && state.role === "shop");

  updateGeneralHelp();
}

const DEFAULT_HELP = "작업구분 클릭: 교환→판금→빈칸 · 도장구분 클릭: 교환도장→표면보수→표면판금보수→전면판금보수 · 우클릭/2초 누르기: 해제";

// 일반 버튼 오른쪽: 고른 일반 작업을 나열한다 (설명 문구는 버튼 앞에 그대로 있다)
function updateGeneralHelp() {
  const el = $("general-picked");
  if (!el) return;
  el.replaceChildren(joinSpans(state.extras.map((x) => ({ text: x, added: isExtraAdded(x) }))));
}

// 항목을 | 로 이어서 보여 준다 (작업 요약과 같은 구분선; 추가된 항목은 녹색 글씨)
function joinSpans(items) {
  const frag = document.createDocumentFragment();
  items.forEach((it, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "list-sep";
      sep.textContent = "|";
      frag.appendChild(sep);
    }
    const s = document.createElement("span");
    s.textContent = it.text;
    if (it.added) s.className = "added-text";
    frag.appendChild(s);
  });
  return frag;
}

// 쉼표로 이어 적은 보험사·담보 값을 나눈다 ("현대, 삼성" → ["현대", "삼성"])
function splitPair(value) {
  return String(value || "").split(",").map((t) => t.trim()).filter(Boolean);
}
function joinPair(first, second) {
  return [first, second].map((t) => String(t || "").trim()).filter(Boolean).join(", ");
}

// 추가된 일반·기타메모 항목인지 (수정 중에 더한 것, 또는 수정 확인 전까지 저장해 둔 것)
function isExtraAdded(name) {
  if (state.revised && ((state.marksMap && state.marksMap.get("__extras")) || []).includes(name)) return true;
  return Boolean(state.editBaseExtras && !state.editBaseExtras.has(name));
}
function isMemoTextAdded(text) {
  if (state.revised && ((state.marksMap && state.marksMap.get("__memo")) || []).includes(text)) return true;
  return Boolean(state.editBaseMemo && !state.editBaseMemo.has(text));
}

// 기타메모 표시 줄: 고른 값(주작업항목 이름 없이 내용만) + 칸에 직접 적은 줄 중 고른 값에 없는 것
function memoDisplayItems() {
  const selected = (state.memoSel || []).map(memoContent).filter(Boolean);
  const out = memoLines(selected).map((text) => ({ text, added: isMemoTextAdded(text) }));
  for (const row of state.rows) {
    String(row.memo || "").split("\n").forEach((line) => {
      const t = line.trim();
      if (!t) return;
      const body = splitMemoItem(t).body;
      const covered = selected.some((c) => body.includes(c) || c.includes(body));
      if (!covered && !out.some((o) => o.text === t)) out.push({ text: t, added: isMemoTextAdded(t) });
    });
  }
  return out;
}

// 예/아니오 확인창. 예면 true
function askConfirm(message) {
  return new Promise((resolve) => {
    const modal = $("confirm-modal");
    const yes = $("confirm-yes");
    const no = $("confirm-no");
    $("confirm-msg").textContent = message;
    const done = (answer) => {
      modal.hidden = true;
      yes.onclick = null;
      no.onclick = null;
      $("confirm-msg").textContent = "작업중이던 창을 닫겠습니까?";
      resolve(answer);
    };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    modal.hidden = false;
    no.focus();
  });
}

// ---------- 나가기 확인 ----------

function isOrderOpen() {
  return !$("screen-order").hidden;
}

// 작업 중인 내용이 저장되지 않았으면 물어본다. 예면 true
function confirmLeave() {
  if (!isOrderOpen() || !state.dirty) return Promise.resolve(true);
  return askConfirm("작업중이던 창을 닫겠습니까?");
}

// ---------- 기타메모사항 (저장 목록) ----------

// 기타메모사항 목록은 서버에 있다. 마스터는 공통 목록을, 공업사는 공통 + 자기 목록을 받는다.
async function loadMemoLists() {
  try {
    const res = await fetch("api/memos", { credentials: "same-origin" });
    if (!res.ok) return { global: [], own: [] };
    return await res.json();
  } catch (err) {
    return { global: [], own: [] };
  }
}

// 편집 화면에 나오는 목록: 마스터는 공통, 공업사는 자기 것
async function loadMemoBank() {
  const lists = await loadMemoLists();
  return (state.role === "master" ? lists.global : lists.own).map((x) => ({ value: x.value, category: x.category || "" }));
}

// 선택 화면에 나오는 전체: 공통 + 자기 것
async function loadMemoAll() {
  const lists = await loadMemoLists();
  return [...lists.global, ...lists.own].map((x) => x.value);
}

async function saveMemoBank(items) {
  const res = await fetch("api/memos", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ values: items }),
  });
  if (!res.ok) showNotice("기타메모사항을 저장하지 못했습니다.");
  return res.ok;
}

let memoDraft = [];

function openMemoBank() {
  // 공업사 계정: 로그인한 공업사명을 넣는다
  $("memo-bank-title").textContent = state.role === "master"
    ? "기타메모사항 입력 (전체 공업사 공통)"
    : `기타메모사항 입력 (${state.shopName || "이 공업사"})`;
  fillNewItemOptions();
  loadMemoBank().then((items) => {
    memoDraft = items.length ? items.map((x) => ({ value: x.value, category: x.category || "" })) : [{ value: "", category: "" }];
    renderMemoDraft();
    $("memo-bank-modal").hidden = false;
  });
}

// 신설(주작업항목) 선택지: 이 차량 구분의 주작업항목 전체를 파트별로 보여 준다
// 이 차량 구분의 주작업항목 이름 목록 (파트별)
function mainItemGroups() {
  const car = state.vehicle ? vehicleByName.get(state.vehicle) : null;
  const rows = car ? data[SAMPLE_KEY[vehicleCategory(car)]] || [] : [];
  const byPart = new Map();
  for (const r of rows) {
    if (!byPart.has(r.part)) byPart.set(r.part, new Set());
    byPart.get(r.part).add(baseName(r.item));
  }
  return byPart;
}

function fillNewItemOptions() {
  const select = $("memo-new-item");
  select.innerHTML = "";
  const placeholder = new Option("주작업항목 선택", "");
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);
  for (const [part, names] of mainItemGroups()) {
    const group = document.createElement("optgroup");
    group.label = part;
    for (const name of names) group.appendChild(new Option(name, name));
    select.appendChild(group);
  }
}

// 저장된 한 줄("주작업항목 내용")을 주작업항목과 내용으로 나눈다. 앞이 주작업항목 이름이 아니면 항목은 비운다.
function splitMemoItem(text) {
  let item = "";
  for (const names of mainItemGroups().values()) {
    for (const name of names) {
      if (name && text.startsWith(name + " ") && name.length > item.length) item = name;
    }
  }
  return { item, body: item ? text.slice(item.length + 1) : text };
}

// 구분 선택 값: 지금 고른 구분만 보인다 ("" 이면 전부)
let memoCatFilter = "";

// 목록에서 바로 바꾼 값은 곧바로 저장한다 (창을 닫지 않아도 된다)
async function saveMemoNow() {
  return saveMemoBank(memoDraftItems());
}

// 한 줄의 주작업항목을 바꾼다 (내용은 그대로 둔다)
function setDraftItem(i, item) {
  const { body } = splitMemoItem(memoDraft[i].value || "");
  memoDraft[i].value = (item ? item + " " : "") + body;
}

// 구분 칸을 누르면 입력 칸이 나오고, 나가거나 Enter 를 누르면 그 값이 적용·저장된다
function editCategory(i, td) {
  if (td.querySelector("input")) return;
  const input = document.createElement("input");
  input.type = "text";
  input.value = memoDraft[i].category || "";
  input.placeholder = "구분";
  input.className = "cat-input";
  td.textContent = "";
  td.appendChild(input);
  input.focus();
  let finished = false;
  const commit = async () => {
    if (finished) return;
    finished = true;
    memoDraft[i].category = input.value.trim();
    renderMemoDraft();
    await saveMemoNow();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { finished = true; renderMemoDraft(); }
  });
}

// '선택'을 누르면 주작업항목 선택 칸이 나오고, 고르면 그 줄의 주작업항목이 바로 바뀌어 저장된다
function editItem(i, td) {
  if (td.querySelector("select")) return;
  const sel = document.createElement("select");
  sel.className = "item-select";
  sel.appendChild(new Option("(없음)", ""));
  for (const [part, names] of mainItemGroups()) {
    const group = document.createElement("optgroup");
    group.label = part;
    for (const name of names) group.appendChild(new Option(name, name));
    sel.appendChild(group);
  }
  sel.value = splitMemoItem(memoDraft[i].value || "").item;
  td.textContent = "";
  td.appendChild(sel);
  sel.focus();
  let changed = false;
  sel.addEventListener("change", async () => {
    changed = true;
    setDraftItem(i, sel.value);
    renderMemoDraft();
    await saveMemoNow();
  });
  sel.addEventListener("blur", () => { if (!changed) renderMemoDraft(); });
}

function memoDraftItems() {
  return memoDraft
    .map((d) => ({ value: String(d.value || "").trim(), category: String(d.category || "").trim() }))
    .filter((x) => x.value);
}

function renderMemoDraft() {
  const body = $("memo-bank-rows");
  body.innerHTML = "";
  // '선택' 목록: 위에서 입력한 구분 값들
  const cats = [...new Set(memoDraft.map((d) => String(d.category || "").trim()).filter(Boolean))];
  if (memoCatFilter && !cats.includes(memoCatFilter)) memoCatFilter = "";
  const sel = $("memo-cat-filter");
  sel.innerHTML = "";
  sel.appendChild(new Option("선택", ""));
  cats.forEach((c) => sel.appendChild(new Option(c, c)));
  sel.value = memoCatFilter;

  memoDraft.forEach((draft, i) => {
    const cat = String(draft.category || "").trim();
    if (memoCatFilter && cat !== memoCatFilter) return; // 구분을 골랐을 때는 그 구분만 보인다
    const tr = document.createElement("tr");
    tr.dataset.index = String(i);

    const grip = document.createElement("td");
    grip.className = "grip-col";
    grip.textContent = "⋮⋮";
    grip.title = "끌어서 순서 바꾸기";
    grip.addEventListener("mousedown", () => { tr.draggable = true; });
    grip.addEventListener("mouseup", () => { tr.draggable = false; });
    tr.appendChild(grip);

    const no = document.createElement("td");
    no.className = "no-col";
    no.textContent = String(i + 1);
    tr.appendChild(no);

    // 순서: NO · 구분 · 내용 · 설정된 주작업항목 · 삭제
    const catCell = document.createElement("td");
    catCell.className = "cat-col cat-edit";
    catCell.textContent = cat || "-";
    catCell.title = "누르면 구분 값을 입력";
    catCell.addEventListener("click", () => editCategory(i, catCell));
    tr.appendChild(catCell);

    const { item, body: bodyText } = splitMemoItem(draft.value || "");
    const prefix = item ? item + " " : "";
    const cellInput = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.value = bodyText;
    input.placeholder = "기타메모 내용";
    input.addEventListener("input", () => { memoDraft[i].value = prefix + input.value; });
    cellInput.appendChild(input);
    tr.appendChild(cellInput);

    const itemCell = document.createElement("td");
    itemCell.className = "item-col";
    const itemWrap = document.createElement("div");
    itemWrap.className = "item-wrap";
    const itemText = document.createElement("span");
    itemText.className = "item-name";
    itemText.textContent = item || "-";
    const pickBtn = document.createElement("button");
    pickBtn.type = "button";
    pickBtn.className = "item-pick";
    pickBtn.textContent = "선택";
    pickBtn.addEventListener("click", () => editItem(i, itemCell));
    itemWrap.append(itemText, pickBtn);
    itemCell.appendChild(itemWrap);
    tr.appendChild(itemCell);

    const del = document.createElement("td");
    del.className = "del-col";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", () => {
      memoDraft.splice(i, 1);
      if (memoDraft.length === 0) memoDraft.push({ value: "", category: "" });
      renderMemoDraft();
    });
    del.appendChild(delBtn);
    tr.appendChild(del);

    tr.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(i));
      e.dataTransfer.effectAllowed = "move";
    });
    tr.addEventListener("dragover", (e) => e.preventDefault());
    tr.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData("text/plain"));
      if (Number.isNaN(from) || from === i) return;
      const [moved] = memoDraft.splice(from, 1);
      memoDraft.splice(i, 0, moved);
      renderMemoDraft();
    });
    tr.addEventListener("dragend", () => { tr.draggable = false; });

    body.appendChild(tr);
  });
}

async function saveMemoDraft() {
  const items = memoDraftItems();
  if (!(await saveMemoBank(items))) return;
  $("memo-bank-modal").hidden = true;
  openMemoView(items.map((x) => x.value));
}

// 닫기: 입력한 내용은 항상 저장하고 닫는다 (저장이 실패하면 창을 그대로 둔다)
async function closeMemoBank() {
  const items = memoDraftItems();
  if (!(await saveMemoBank(items))) return;
  $("memo-bank-modal").hidden = true;
}

function openMemoView(items) {
  const body = $("memo-view-rows");
  body.innerHTML = "";
  if (items.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 2;
    td.textContent = "저장된 기타메모사항이 없습니다.";
    tr.appendChild(td);
    body.appendChild(tr);
  }
  items.forEach((text, i) => {
    const tr = document.createElement("tr");
    const no = document.createElement("td");
    no.className = "no-col";
    no.textContent = String(i + 1);
    const cellText = document.createElement("td");
    cellText.textContent = text;
    tr.append(no, cellText);
    body.appendChild(tr);
  });
  $("memo-view-modal").hidden = false;
}

// ---------- 기타메모사항 선택 (다중) ----------

// 선택한 기타메모 문장을 주작업항목 이름이 들어 있는 항목의 기타메모에 넣는다
// 예) "프런트펜더몰딩(좌) 교환" → 주작업항목 "프런트펜더"의 기타메모
function matchMainItem(text) {
  let best = null;
  let bestLen = 0;
  for (const row of state.rows) {
    const name = baseName(row.item);
    if (name && text.includes(name) && name.length > bestLen) {
      best = row;
      bestLen = name.length;
    }
  }
  return best;
}

// 고른 문장을 화면과 기타메모 칸에 넣을 줄로 바꾼다. 좌·우만 다른 문장은 한 줄로 합친다.
// 예) "프런트펜더몰딩(좌) 교환" + "프런트펜더몰딩(우) 교환" → "프런트펜더몰딩(좌, 우) 교환"
function memoLines(texts) {
  const SIDE_ORDER = ["좌", "우"];
  const slots = [];
  const groups = new Map();
  texts.forEach((text) => {
    const m = text.match(/^(.*)\((좌|우)\)(.*)$/);
    if (!m) {
      slots.push(text);
      return;
    }
    const key = `${m[1]}\u0000${m[3]}`;
    if (!groups.has(key)) {
      const group = { prefix: m[1], suffix: m[3], sides: [] };
      groups.set(key, group);
      slots.push(group);
    }
    groups.get(key).sides.push(m[2]);
  });
  return slots.map((slot) => {
    if (typeof slot === "string") return slot;
    const sides = [...slot.sides].sort((a, b) => SIDE_ORDER.indexOf(a) - SIDE_ORDER.indexOf(b));
    return `${slot.prefix}(${sides.join(", ")})${slot.suffix}`;
  });
}

// 이전에 자동으로 넣었던 문장은 빼고, 지금 고른 문장을 다시 넣는다 (직접 쓴 줄은 남긴다)
// 기타메모 칸에는 내용만 넣는다 (앞의 주작업항목 이름은 빼고, 그 항목의 칸에 넣는다)
function memoContent(text) {
  return splitMemoItem(text).body;
}

function applyMemoSelection(texts) {
  const prev = memoLines(state.memoSel || []).map(memoContent);
  state.rows.forEach((row) => {
    row.memo = (row.memo || "").split("\n").filter((line) => line !== "" && !prev.includes(line)).join("\n");
  });
  memoLines(texts).forEach((text) => {
    const target = matchMainItem(text);
    if (!target) return;
    const content = memoContent(text);
    const lines = target.memo ? target.memo.split("\n") : [];
    if (!lines.includes(content)) lines.push(content);
    target.memo = lines.join("\n");
  });
  state.memoSel = texts;
  markDirty();
  saveOrder();
  renderOrder();
  renderMemoPicked();
}

// 기타메모사항 버튼 오른쪽: 고른 값을 일반 목록과 같이 · 로 이어서 한 줄에 보인다 (값이 있을 때만)
function renderMemoPicked() {
  const box = $("memo-picked");
  if (!box) return;
  // 주작업항목 이름은 빼고 내용만 보인다 (칸에 들어가는 것과 같다)
  const items = memoDisplayItems();
  box.replaceChildren(joinSpans(items));
  box.hidden = items.length === 0;
}

async function openMemoPick() {
  if (guardLocked()) return;
  const items = await loadMemoAll();
  const body = $("memo-pick-rows");
  body.innerHTML = "";
  if (items.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "저장된 기타메모사항이 없습니다. '기타메모사항 입력'에서 먼저 저장하세요.";
    tr.appendChild(td);
    body.appendChild(tr);
  }
  const picked = new Set(state.memoSel || []);
  items.forEach((text, i) => {
    const tr = document.createElement("tr");
    tr.className = "pick-row";
    const check = document.createElement("td");
    check.className = "check-col";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = picked.has(text);
    box.dataset.text = text;
    check.appendChild(box);
    const no = document.createElement("td");
    no.className = "no-col";
    no.textContent = String(i + 1);
    // 주작업항목 이름이 앞에 붙은 줄이면 항목과 내용을 나눠 보인다
    const { item, body: bodyText } = splitMemoItem(text);
    const itemCell = document.createElement("td");
    itemCell.className = "item-col";
    itemCell.textContent = item || "-";
    const cellText = document.createElement("td");
    cellText.textContent = bodyText;
    tr.append(check, no, cellText, itemCell);
    tr.addEventListener("click", (e) => {
      if (e.target !== box) box.checked = !box.checked;
    });
    body.appendChild(tr);
  });
  $("memo-pick-modal").hidden = false;
}

// ---------- 일반 작업 ----------

function openGeneral() {
  const list = $("general-list");
  list.innerHTML = "";
  GENERAL_ITEMS.forEach((name) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "general-item";
    btn.textContent = name;
    btn.classList.toggle("on", state.extras.includes(name));
    btn.addEventListener("click", () => {
      state.extras = state.extras.includes(name)
        ? state.extras.filter((n) => n !== name)
        : GENERAL_ITEMS.filter((n) => n === name || state.extras.includes(n));
      btn.classList.toggle("on", state.extras.includes(name));
      markDirty();
      updateGeneralHelp();
      saveOrder();
    });
    list.appendChild(btn);
  });
  $("general-modal").hidden = false;
}

// ---------- 연결 ----------

// 수정 중에 입력이 남아 있는지 (수정을 누르고 값이 바뀌었는지)
function hasPendingEdit() {
  return Boolean(state.editBase) && Boolean(state.dirty);
}

// 다른 탭으로 가기 전: "이전작업은 자동으로 저장하시겠습니까?" 예 → 저장 후 진행, 아니오 → 저장하지 않고 저장본으로 되돌린 뒤 진행
async function resolvePendingEdit() {
  const save = await askConfirm("이전작업은 자동으로 저장하시겠습니까?");
  if (save) return Boolean(await saveToServer());
  await revertToSavedOrder();
  return true;
}

// 마지막으로 저장한 값으로 화면을 되돌린다. 저장본이 없으면 false
async function revertToSavedOrder() {
  const saved = await fetchServerOrder();
  if (!saved) return false;
    state.rows.forEach((row) => {
      const old = saved.rows.find((o) => o.item === row.item && o.part === row.part);
      if (!old) {
        row.work = { L: null, R: null, C: null };
        row.paint = { L: null, R: null, C: null };
        row.memo = "";
        row.tip = null;
        return;
      }
      row.work = old.work;
      row.paint = old.paint;
      row.memo = old.memo || "";
      row.tip = old.tip || null;
    });
    state.extras = saved.extras || [];
    if (saved.meta) state.meta = { ...newOrderMeta(), ...saved.meta };
    state.editBase = null;
    state.editBaseMemo = null;
    state.editBaseExtras = null;
    state.marksMap = saved.revised ? new Map(Object.entries(saved.marks || {})) : null;
    state.revised = Boolean(saved.revised);
    state.locked = true;
    state.dirty = false;
    renderOrder();
    return true;
}

function setupOrderTools() {
  setupMeta();
  $("edit-order").addEventListener("click", () => {
    // 수정을 누른 순간의 값을 기억해 두고, 바뀐 칸만 녹색으로 표시한다
    state.editBase = new Map(state.rows.map((r) => [r, { work: { ...r.work }, paint: { ...r.paint }, memo: r.memo }]));
    // 기타메모·일반에서 수정 전 값 (수정 중 추가된 항목을 녹색으로 보이기 위해)
    state.editBaseMemo = new Set([
      ...(state.memoSel || []).map(memoContent),
      ...state.rows.flatMap((r) => String(r.memo || "").split("\n").map((t) => t.trim()).filter(Boolean)),
    ]);
    state.editBaseExtras = new Set(state.extras || []);
    state.locked = false;
    renderOrder();
  });

  // 수정 확인: 목록의 갈색 음영을 지운다
  $("ack-order").addEventListener("click", async () => {
    const res = await fetch("api/orders/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ vehicle: state.vehicle, plate: state.plate }),
    });
    if (res.ok) {
      state.revised = false;
      state.editBase = null;
      state.editBaseMemo = null;
      state.editBaseExtras = null;
      state.marksMap = null;
      renderOrder();
      showNotice("수정 확인되었습니다. 목록의 갈색 음영이 지워집니다.");
    } else {
      showNotice("수정 확인을 하지 못했습니다.");
    }
  });

  // 작업 요약: Shift+Enter 로 항목을 한 줄씩(위아래 한 칸 띄움) 보기와 한 줄 이어 보기를 바꾼다
  const summaryBox = $("summary");
  summaryBox.tabIndex = 0;
  summaryBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      $("summary-list").classList.toggle("stacked");
      layoutSummarySeparators();
    }
  });
  // '누르면 전체 보기' 단추(제목 줄의 빈 곳)만 누르면 펼치고 접는다. 항목 글자는 눌러도 아무 일도 없다
  const summaryHead = summaryBox.querySelector(".sum-head");
  summaryHead.addEventListener("click", (e) => {
    if (e.target !== summaryHead) return;
    summaryBox.classList.toggle("expanded");
    layoutSummaryCollapse();
  });

  // 저장값 불러오기: 잘못 입력했을 때 마지막으로 저장한 값으로 되돌린다
  $("reload-saved").addEventListener("click", async () => {
    const ok = await askConfirm("마지막으로 저장한 값으로 되돌릴까요? 저장하지 않은 입력은 사라집니다.");
    if (!ok) return;
    if (!(await revertToSavedOrder())) {
      showNotice("저장된 작업지시서가 없습니다.");
      return;
    }
    showNotice("저장값을 불러왔습니다.");
  });

  // 수정 중 입력이 남아 있을 때 다른 탭(인쇄, 목록, 설정, 새작업)으로 가면 먼저 묻는다
  document.addEventListener("click", async (e) => {
    // '새작업지시서 작업'은 자체 확인("작업중이던 창을 닫겠습니까?")이 있어서 여기서 빼 둔다
    const target = e.target.closest && e.target.closest("#print-order, a.list-link, #settings-icon, #settings-link");
    if (!target || !hasPendingEdit()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!(await resolvePendingEdit())) return;
    if (target.id === "print-order") printOrder();
    else location.href = target.getAttribute("href");
  }, true);

  // 수정 버튼을 누르기 전에는 일반 목록을 열지 않고 안내만 한다
  $("general-btn").addEventListener("click", () => { if (guardLocked()) return; openGeneral(); });
  $("general-close").addEventListener("click", () => { $("general-modal").hidden = true; });

  $("memo-bank-btn").addEventListener("click", () => { if (guardLocked()) return; openMemoBank(); });
  $("memo-bank-add").addEventListener("click", () => {
    memoDraft.push({ value: "", category: memoCatFilter });
    renderMemoDraft();
  });
  $("memo-new-add").addEventListener("click", () => {
    const item = $("memo-new-item").value;
    const text = $("memo-new-text").value.trim();
    if (!item || !text) return;
    const category = $("memo-new-cat").value.trim(); // 구분(신규): 이 줄의 구분 값
    memoDraft.push({ value: `${item} ${text}`, category }); // 앞에 주작업항목 이름을 붙여 그 항목에 연결한다
    $("memo-new-text").value = "";
    renderMemoDraft();
  });
  // 구분 선택: 고른 구분만 보인다. '구분'을 누르면 전부 보인다
  $("memo-cat-filter").addEventListener("change", () => {
    memoCatFilter = $("memo-cat-filter").value;
    renderMemoDraft();
  });
  $("memo-cat-all").addEventListener("click", () => {
    memoCatFilter = "";
    renderMemoDraft();
  });
  $("memo-bank-save").addEventListener("click", saveMemoDraft);
  $("memo-bank-cancel").addEventListener("click", closeMemoBank);
  $("memo-view-close").addEventListener("click", () => { $("memo-view-modal").hidden = true; });
  $("memo-pick-close").addEventListener("click", () => { $("memo-pick-modal").hidden = true; });
  $("memo-pick-apply").addEventListener("click", () => {
    const texts = [...document.querySelectorAll("#memo-pick-rows input[type=checkbox]:checked")].map((b) => b.dataset.text);
    $("memo-pick-modal").hidden = true;
    applyMemoSelection(texts);
  });
  $("memo-pick-btn").addEventListener("click", () => { if (guardLocked()) return; openMemoPick(); });

  // 목록 보기 링크: 저장하지 않은 내용이 있으면 먼저 묻는다
  document.querySelector("a.list-link").addEventListener("click", (e) => {
    if (!isOrderOpen() || !state.dirty) return;
    e.preventDefault();
    const href = e.currentTarget.getAttribute("href");
    confirmLeave().then((ok) => { if (ok) location.href = href; });
  });

  // 브라우저 뒤로가기·창 닫기: 저장하지 않은 내용이 있으면 브라우저가 확인 창을 띄운다
  window.addEventListener("beforeunload", (e) => {
    if (!isOrderOpen() || !state.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

// ---------- 입고일 · 출고일 · 보험사 · 담보 · 도장코드 ----------

let paintCoatsByCode = new Map();
let paintCodeList = []; // 도장코드 목록 (자동검색에 쓴다)

// 도장코드 값이 정해졌을 때: 코트수 표시와 저장값
function applyPaintCode(code) {
  const coats = paintCoatsByCode.get(code) || "";
  $("paint-coats").textContent = coats ? `코트수 ${coats}` : "";
  setMeta({ paintCode: code, paintCoats: coats });
}

// 도장코드 자동검색: 입력 칸 바로 아래에 후보가 뜨고, 누르면 그 값이 들어간다
function setupPaintSuggest() {
  const input = $("paint-code");
  const list = $("paint-suggest");
  const hide = () => { list.hidden = true; list.innerHTML = ""; };
  const pick = (code) => {
    input.value = code;
    hide();
    applyPaintCode(code);
  };
  const render = () => {
    const q = input.value.trim().toUpperCase();
    list.innerHTML = "";
    if (!q || paintCodeList.length === 0) { hide(); return; }
    const hits = paintCodeList.filter((c) => String(c.code).toUpperCase().includes(q)).slice(0, 12);
    if (hits.length === 0) { hide(); return; }
    hits.forEach((c) => {
      const li = document.createElement("li");
      li.dataset.code = c.code;
      li.textContent = c.coats ? `${c.code} · ${c.coats}` : c.code;
      li.addEventListener("mousedown", (e) => { e.preventDefault(); pick(c.code); });
      li.addEventListener("touchstart", (e) => { e.preventDefault(); pick(c.code); }, { passive: false });
      list.appendChild(li);
    });
    list.hidden = false;
  };
  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("blur", () => setTimeout(hide, 150));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = list.querySelector("li");
      if (!list.hidden && first) { e.preventDefault(); pick(first.dataset.code); }
    }
    if (e.key === "Escape") hide();
  });
}

async function loadMetaOptions() {
  try {
    const res = await fetch("api/options", { credentials: "same-origin" });
    if (res.ok) {
      const data = await res.json();
      fillSelect($("insurer"), data.insurers);
      // 담보 선택지에서 '쌍방'은 뺀다 (자차·대물만 고른다)
      const coverages = (data.coverages || []).filter((it) => it.value !== "쌍방");
      fillSelect($("coverage"), coverages);
      fillSelect($("insurer2"), data.insurers);
      fillSelect($("coverage2"), coverages);
    }
    const codesRes = await fetch("api/paintcodes", { credentials: "same-origin" });
    if (codesRes.ok) {
      const { codes } = await codesRes.json();
      paintCoatsByCode = new Map(codes.map((c) => [c.code, c.coats]));
      paintCodeList = codes;
    }
  } catch (err) {
    // 목록을 못 읽으면 입력만 가능하다
  }
}

function fillSelect(select, items) {
  const keep = select.value;
  select.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "선택";
  select.appendChild(blank);
  (items || []).forEach((it) => {
    const opt = document.createElement("option");
    opt.value = it.value;
    opt.textContent = it.value;
    select.appendChild(opt);
  });
  select.value = keep;
}

// 저장된 메타 값을 화면에 채운다
function showMeta() {
  const m = state.meta || newOrderMeta();
  $("in-date").value = m.inDate || "";
  $("out-date").value = m.outDate || "";
  const ins = splitPair(m.insurer);
  const cov = splitPair(m.coverage);
  $("insurer").value = ins[0] || "";
  $("insurer2").value = ins[1] || "";
  $("coverage").value = cov[0] || "";
  $("coverage2").value = cov[1] || "";
  $("ins-cov-2").hidden = !(ins[1] || cov[1]);
  $("paint-code").value = m.paintCode || "";
  $("paint-coats").textContent = m.paintCoats ? `코트수 ${m.paintCoats}` : "";
}

// 차량 입력 화면의 값을 읽는다 (작업지시서를 새로 만들 때 이 값이 들어간다)
function readMetaFromInput() {
  return {
    inDate: $("in-date").value.trim() || newOrderMeta().inDate,
    outDate: $("out-date").value,
    insurer: joinPair($("insurer").value, $("insurer2").value),
    coverage: joinPair($("coverage").value, $("coverage2").value),
    paintCode: $("paint-code").value.trim(),
    paintCoats: paintCoatsByCode.get($("paint-code").value.trim()) || "",
  };
}

// 입력 화면의 값은 언제나 고칠 수 있다. 저장된 작업지시서의 값은 열 때 이 칸에 채워진다.
function setMeta(patch) {
  state.meta = { ...(state.meta || newOrderMeta()), ...patch };
}

// 반대 담보: 자차 ↔ 대물. 둘째 담보 줄이 열려 있으면 첫째 담보의 반대 값을 둘째에 넣는다.
const OPPOSITE_COVERAGE = { "자차": "대물", "대물": "자차" };
function syncOppositeCoverage() {
  if ($("ins-cov-2").hidden) return;
  const opposite = OPPOSITE_COVERAGE[$("coverage").value];
  if (opposite) $("coverage2").value = opposite;
}

function setupMeta() {
  // 입고일: 직접 고친다 (2026-11-06 형식으로 맞춘다)
  $("in-date").addEventListener("blur", () => {
    const value = normalizeDateText($("in-date").value);
    $("in-date").value = value;
    setMeta({ inDate: value });
  });
  $("in-date").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("in-date").blur(); }
  });
  $("out-date").addEventListener("blur", () => {
    const value = normalizeDateText($("out-date").value);
    $("out-date").value = value;
    setMeta({ outDate: value });
  });
  $("out-date").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("out-date").blur(); }
  });
  // 달력 버튼: 누른 자리 주변에 달력이 뜨고, 날짜를 고르면 바로 확정된다
  $("out-cal").addEventListener("click", (e) => {
    e.stopPropagation();
    openDateCalendar($("out-cal"), $("out-date").value, (value) => {
      $("out-date").value = value;
      setMeta({ outDate: value });
    });
  });
  // 달력에서 날짜를 고르면 그 날짜로 바로 확정된다 (별도 확인 단계 없음)
  const pickDate = (e) => {
    const value = e.target.value;
    if (!value) return;
    $("out-date").value = value;
    setMeta({ outDate: value });
    e.target.hidden = true;
  };
  $("out-date-picker").addEventListener("change", pickDate);
  $("out-date-picker").addEventListener("input", pickDate);
  const pairChanged = () => setMeta({
    insurer: joinPair($("insurer").value, $("insurer2").value),
    coverage: joinPair($("coverage").value, $("coverage2").value),
  });
  ["insurer", "insurer2", "coverage2"].forEach((id) => $(id).addEventListener("change", pairChanged));
  // 첫째 담보를 바꾸면 둘째 줄이 열려 있을 때 반대 담보를 자동으로 고른다
  $("coverage").addEventListener("change", () => {
    syncOppositeCoverage();
    pairChanged();
  });
  // 보험사·담보 하나 더: 누르면 밑에 두 번째 줄이 나오고, 다시 누르면 두 번째 값을 지우고 줄을 닫는다
  $("ins-cov-add").addEventListener("click", () => {
    const row = $("ins-cov-2");
    row.hidden = !row.hidden;
    if (row.hidden) {
      $("insurer2").value = "";
      $("coverage2").value = "";
    } else {
      syncOppositeCoverage();
    }
    pairChanged();
  });
  $("paint-code").addEventListener("change", () => applyPaintCode($("paint-code").value.trim()));
  setupPaintSuggest();
  loadMetaOptions();
  showMeta();
}

// 2026-05-02, 2026.5.2, 20260502 → 2026-05-02
function normalizeDateText(text) {
  const m = String(text || "").trim().match(/^(\d{4})\D?(\d{1,2})\D?(\d{1,2})$/);
  if (!m) return "";
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// 작업구분 설명 문구: 누르면 전체 내용을 팝업으로 보이고, 바깥이나 팝업 내용을 누르면 사라진다
function setupHelpPopup() {
  const help = document.getElementById("general-help");
  const pop = document.getElementById("help-pop");
  const text = document.getElementById("help-pop-text");
  if (!help || !pop || !text) return;
  help.addEventListener("click", () => showHelpPopup(help, help.textContent.trim()));
  pop.addEventListener("click", () => { pop.hidden = true; });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupHelpPopup);
else setupHelpPopup();

// 차량명 줄(1. 차량정보)도 같은 팝업으로 전체 내용을 보인다 (휴대폰에서 줄이 잘릴 때)
function setupVehiclePopup() {
  const info = document.getElementById("order-info");
  const pop = document.getElementById("help-pop");
  const text = document.getElementById("help-pop-text");
  if (!info || !pop || !text) return;
  info.addEventListener("click", () => {
    const value = info.textContent.trim();
    if (!value) return;
    showHelpPopup(info, value);
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupVehiclePopup);
else setupVehiclePopup();

// 팝업은 누른 항목 바로 아래에 뜬다 (화면 밖으로 나가지 않게 좌우를 맞춘다)
function showHelpPopup(anchor, value) {
  const pop = document.getElementById("help-pop");
  const box = document.getElementById("help-pop-text");
  if (!pop || !box) return;
  box.textContent = value;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const margin = 8;
  const width = Math.min(box.offsetWidth, window.innerWidth - margin * 2);
  let left = Math.min(Math.max(margin, r.left), window.innerWidth - width - margin);
  let top = r.bottom + 6;
  box.style.left = `${left}px`;
  box.style.top = `${Math.min(top, window.innerHeight - box.offsetHeight - margin)}px`;
}

// 수정 중에 새로 더한 일반·기타메모 항목 (저장할 때 녹색 표시용으로 함께 보낸다)
function currentAddedExtras() {
  if (!state.editBaseExtras) return [];
  return (state.extras || []).filter((x) => !state.editBaseExtras.has(x));
}
function currentAddedMemo() {
  if (!state.editBaseMemo) return [];
  return memoDisplayItems().map((i) => i.text).filter((t) => !state.editBaseMemo.has(t));
}
