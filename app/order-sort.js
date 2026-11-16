// 보기순서 변경 (별도 창): 착안점(복원수리) 행을 끌어서 순서를 정하고 저장한다.
const GROUP_KEY = { "1": "1", "2": "2" };
const GROUP_NAME = { "1": "1. 승용, RV1, RV2", "2": "2. 화물1, 화물2" };
const $ = (id) => document.getElementById(id);
const groupSel = $("group");
const listEl = $("list");
const statusEl = $("status");
let all = [];          // 서버의 전체 착안점 행
let customOrder = {};  // 구분별로 마스터가 보기순서를 저장했는지
// 보기순서 키 (app.js 와 같은 규칙): 저장한 구분은 저장된 순서, 아직 안 한 구분은 작업지시서 샘플 순서
function orderKeyOf(group, item, sort) {
  const s = Number.isFinite(sort) ? sort : 0;
  if (customOrder[group]) return s;
  const list = group === "2" ? window.SAMPLE_ORDER.right : window.SAMPLE_ORDER.left;
  const name = String(item || "").split(",")[0].trim();
  const at = list.indexOf(name);
  return (at < 0 ? 99999 : at) * 1000000 + s;
}
let dirty = false;     // 끌어서 바꾼 뒤 아직 저장하지 않았는지

const groupOf = (r) => (String(r.group || "").match(/^\s*(\d+)/) || [])[1] || "";
const setStatus = (text) => { statusEl.textContent = text; };

function renumber() {
  [...listEl.children].forEach((el, i) => { el.querySelector(".no").textContent = String(i + 1); });
}

function render() {
  const g = groupSel.value;
  const rows = all
    .filter((r) => groupOf(r) === g)
    .map((r) => ({ r, key: orderKeyOf(g, r.item, r.sort ?? r.id) }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.r);
  listEl.innerHTML = "";
  if (rows.length === 0) {
    listEl.textContent = "이 구분에 입력된 착안점(복원수리)이 없습니다.";
    return;
  }
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "row";
    row.dataset.id = String(r.id);
    const grip = document.createElement("span");
    grip.className = "grip";
    grip.textContent = "⋮⋮";
    grip.title = "끌어서 순서 바꾸기";
    const no = document.createElement("span");
    no.className = "no";
    const item = document.createElement("span");
    item.className = "item";
    item.textContent = r.item || "";
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = r.text || "";
    row.append(grip, no, item, text);
    listEl.appendChild(row);
  }
  renumber();
  dirty = false;
}

async function load() {
  setStatus("불러오는 중...");
  try {
    const res = await fetch("api/mapping", { credentials: "same-origin" });
    if (!res.ok) throw new Error("load");
    const body = await res.json();
    all = body.rows || [];
    customOrder = body.customOrder || {};
    render();
    setStatus("");
  } catch (err) {
    setStatus("목록을 불러오지 못했습니다. 작업지시서 창에서 로그인했는지 확인하세요.");
  }
}

// ---- 끌어서 순서 바꾸기 (마우스 왼쪽 버튼) ----
let dragEl = null;
listEl.addEventListener("pointerdown", (e) => {
  const grip = e.target.closest(".grip");
  if (!grip || e.button !== 0) return;
  dragEl = grip.closest(".row");
  dragEl.classList.add("dragging");
  grip.setPointerCapture(e.pointerId);
  e.preventDefault();
});
listEl.addEventListener("pointermove", (e) => {
  if (!dragEl) return;
  const over = document.elementFromPoint(e.clientX, e.clientY);
  const row = over && over.closest(".row");
  if (!row || row === dragEl || row.parentElement !== listEl) return;
  const box = row.getBoundingClientRect();
  if (e.clientY < box.top + box.height / 2) listEl.insertBefore(dragEl, row);
  else listEl.insertBefore(dragEl, row.nextSibling);
  dirty = true;
  renumber();
  setStatus("순서가 바뀌었습니다. '순서 저장'을 누르세요.");
});
function endDrag() {
  if (!dragEl) return;
  dragEl.classList.remove("dragging");
  dragEl = null;
}
listEl.addEventListener("pointerup", endDrag);
listEl.addEventListener("pointercancel", endDrag);

// ---- 저장 ----
$("save").addEventListener("click", async () => {
  const ids = [...listEl.children].map((el) => Number(el.dataset.id)).filter((id) => Number.isInteger(id));
  if (ids.length === 0) { setStatus("저장할 착안점이 없습니다."); return; }
  setStatus("저장하는 중...");
  try {
    const res = await fetch("api/mapping/order", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group: GROUP_NAME[groupSel.value], ids }),
    });
    if (!res.ok) throw new Error("save");
    ids.forEach((id, i) => {
      const r = all.find((x) => x.id === id);
      if (r) r.sort = i + 1;
    });
    customOrder[GROUP_KEY[groupSel.value]] = true;
    dirty = false;
    setStatus(`${ids.length}행의 순서를 저장했습니다.`);
  } catch (err) {
    setStatus("순서를 저장하지 못했습니다. 마스터 계정으로 로그인했는지 확인하세요.");
  }
});

groupSel.addEventListener("change", () => {
  if (dirty && !confirm("저장하지 않은 순서가 있습니다. 구분을 바꾸면 사라집니다. 바꿀까요?")) {
    groupSel.value = groupSel.value === "1" ? "2" : "1";
    return;
  }
  render();
  setStatus("");
});
$("close").addEventListener("click", () => window.close());
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

const initial = new URLSearchParams(location.search).get("group");
groupSel.value = initial === "2" ? "2" : "1";
load();
