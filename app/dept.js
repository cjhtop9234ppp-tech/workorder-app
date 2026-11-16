// 부서 읽기 지정폴더 (마스터, PC 크롬·엣지 전용)
// 지정한 폴더 안의 "차량번호 이름 폴더"를 작업지시서 목록의 차량번호와 맞춘다.
// 맞는 폴더의 사진 파일 이름을 순서대로 정렬해 마지막 파일을 고르고, 그 이름에 들어 있는 부서명을 목록에 저장한다.

const DEPT_NAMES = ["최초", "판금", "하체", "도장", "완료", "서류"];
const DEPT_DB = "dept-folder-db";
const DEPT_KEY = "folder";
const PHOTO_RE = /\.(jpe?g|png|webp|heic|gif)$/i;

const deptEl = (id) => document.getElementById(id);

// 폴더 핸들은 이 PC 브라우저 안(IndexedDB)에 기억한다
function openDeptDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DEPT_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deptDbGet(key) {
  const db = await openDeptDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("kv").objectStore("kv").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deptDbPut(key, value) {
  const db = await openDeptDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// 차량번호 비교: 띄어쓰기와 대소문자를 무시한다
function plateKey(text) {
  // 한글 자모가 다르게 저장된 경우도 같게 보도록 NFC 로 맞추고, 띄어쓰기·대소문자를 무시한다
  return String(text || "").normalize("NFC").replace(/\s+/g, "").toUpperCase();
}

// 부서 표기: 번호 뒤에 한 칸 띄운다 ("1.최초" → "1. 최초")
function deptLabel(value) {
  return String(value || "").replace(/^(\d+)\.\s*/, "$1. ");
}

// 파일 이름에서 부서를 읽는다.
// 예: "5.완료_261107174623a_3798700095.8_.jpg" → "5.완료" (첫 밑줄 앞의 "번호.부서" 부분)
// 그 형식이 아니면 이름 안에서 가장 뒤에 나온 부서명(최초·판금·하체·도장·완료·서류)을 쓴다
function deptFromName(fileName) {
  const head = fileName.split("_")[0].trim();
  if (/^\d+\.\S+/.test(head)) return head;
  let best = "";
  let bestAt = -1;
  for (const dept of DEPT_NAMES) {
    const at = fileName.lastIndexOf(dept);
    if (at > bestAt) { bestAt = at; best = dept; }
  }
  return best;
}

function setDeptStatus(text) {
  deptEl("dept-status").textContent = text;
}

async function pickDeptFolder() {
  if (!window.showDirectoryPicker) {
    setDeptStatus("이 브라우저는 폴더 읽기를 지원하지 않습니다. PC의 크롬 또는 엣지를 쓰세요.");
    return;
  }
  try {
    // 읽기·쓰기 권한으로 고른다 (휴대폰에서 올린 사진을 이 폴더에 내려받기 위해)
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await deptDbPut(DEPT_KEY, handle);
    deptEl("dept-folder").textContent = handle.name;
    setDeptStatus("폴더를 지정했습니다. '지금 읽기 · 저장'을 누르세요.");
  } catch (err) {
    if (err && err.name !== "AbortError") setDeptStatus("폴더를 지정하지 못했습니다.");
  }
}

// 목록의 모든 작업지시서 차량번호 (페이지를 나눠 모두 받는다)
async function fetchAllPlates() {
  const plates = new Map(); // 차량번호(비교용) → 원래 차량번호 목록
  for (let page = 1; page < 10000; page++) {
    const res = await fetch(`api/orders?page=${page}&size=100`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`목록을 받지 못했습니다 (${res.status})`);
    const data = await res.json();
    for (const o of data.orders || []) {
      const key = plateKey(o.plate);
      if (!key) continue;
      if (!plates.has(key)) plates.set(key, new Set());
      plates.get(key).add(o.plate);
    }
    if (page * 100 >= (data.total || 0) || (data.orders || []).length === 0) break;
  }
  return plates;
}

// 차량번호 목록은 1분 동안 저장해 두고 쓴다 (10초마다 확인해도 목록을 매번 다시 받지 않는다)
let platesCache = null;
let platesCachedAt = 0;
async function cachedPlates() {
  if (platesCache && Date.now() - platesCachedAt < 60 * 1000) return platesCache;
  platesCache = await fetchAllPlates();
  platesCachedAt = Date.now();
  return platesCache;
}

async function readDeptFolder(opts = {}) {
  const handle = await deptDbGet(DEPT_KEY).catch(() => null);
  if (!handle) {
    setDeptStatus("먼저 '폴더 지정'으로 폴더를 고르세요.");
    return;
  }
  let perm = await handle.queryPermission({ mode: "read" });
  // 자동 읽기(목록을 열 때)는 권한 창을 띄우지 않는다. 권한이 이미 있을 때만 읽는다
  if (perm !== "granted" && opts.silent) return false;
  // 읽기·쓰기 권한을 한 번에 묻는다 (창을 두 번 띄우지 않도록)
  if (perm !== "granted") perm = await handle.requestPermission({ mode: "readwrite" });
  if (perm !== "granted") {
    setDeptStatus("폴더를 읽을 권한이 없습니다. 다시 지정해 주세요.");
    return;
  }
  // 쓰기 권한: 버튼을 눌렀을 때만 묻는다 (자동 읽기는 묻지 않는다)
  let canWrite = (await handle.queryPermission({ mode: "readwrite" }).catch(() => "prompt")) === "granted";
  if (!canWrite && !opts.silent) {
    canWrite = (await handle.requestPermission({ mode: "readwrite" }).catch(() => "denied")) === "granted";
  }
  // 이미 본 사진 이름 (폴더에서 지운 사진을 다시 내려받지 않도록 기억한다)
  const seenSet = new Set((await deptDbGet("seen").catch(() => null)) || []);
  const seedDone = (await deptDbGet("seenInit").catch(() => null)) === true;

  setDeptStatus("목록과 폴더를 맞추는 중…");
  const body = deptEl("dept-rows");
  body.innerHTML = "";
  let plates;
  try {
    plates = await cachedPlates();
  } catch (err) {
    setDeptStatus(err.message);
    return;
  }

  const found = [];
  let pulledCount = 0;
  let blockedCount = 0;
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== "directory") continue;
    // 폴더 이름 안에 목록의 차량번호가 들어 있으면 맞는 것으로 본다 (예: "261107_12가4580" ⊃ "12가4580").
    // 여러 개가 들어 있으면 가장 긴 차량번호를 쓴다
    const folderKey = plateKey(name);
    const matches = [...plates.keys()].filter((p) => p && folderKey.includes(p));
    if (matches.length === 0) continue;
    const key = matches.sort((a, b) => b.length - a.length)[0];
    // 바뀐 차량만 읽을 때는 나머지 차량 폴더는 건너뛴다 (서버에 묻지 않으므로 빠르다)
    if (opts.onlyKeys && !opts.onlyKeys.has(key)) continue;
    const photos = [];
    for await (const [fileName, fh] of entry.entries()) {
      if (fh.kind === "file" && PHOTO_RE.test(fileName)) photos.push({ name: fileName, fh });
    }
    // 휴대폰에서 올린 사진: 서버에 있고 폴더에 없으며 아직 본 적 없는 것은 이 폴더에 내려받는다
    const serverNames = await fetchServerNames(key);
    const inFolder = new Set(photos.map((p) => p.name));
    // 안전: 휴대폰 사진은 폴더에 '복사'만 한다. 폴더의 기존 사진은 옮기거나 지우지 않고, 서버 사진도 지우지 않는다.
    // 처음 지정한 폴더라도 서버에 있는데 폴더에 없는 사진은 모두 내려받는다 (예전에는 처음 한 번을 건너뛰어 사진이 PC에서 사라져 보였다)
    if (canWrite) {
      // 내려받을 사진을 모은 뒤 4장씩 동시에 받는다 (한 장씩 기다리지 않는다)
      const todo = serverNames.filter((n) => !inFolder.has(n) && !seenSet.has(`${key}/${n}`));
      let idx = 0;
      const pullOne = async () => {
        while (idx < todo.length) {
          const n = todo[idx++];
          try {
            const blob = await (await fetch(`api/deptphoto/${encodeURIComponent(key)}/${encodeURIComponent(n)}`, { credentials: "same-origin" })).blob();
            const fh = await entry.getFileHandle(n, { create: true });
            const w = await fh.createWritable();
            await w.write(blob);
            await w.close();
            photos.push({ name: n, fh });
            inFolder.add(n);
            seenSet.add(`${key}/${n}`);
            pulledCount += 1;
          } catch (err) {
            // 못 내려받은 사진은 다음 읽기 때 다시 한다
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, todo.length) }, pullOne));
    } else {
      // 쓰기 권한이 없어서 내려받지 못한 사진 (권한을 허용하면 다음 읽기에 내려받는다)
      blockedCount += serverNames.filter((n) => !inFolder.has(n) && !seenSet.has(`${key}/${n}`)).length;
    }
    photos.forEach((p) => seenSet.add(`${key}/${p.name}`));
    photos.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    const lastPhoto = photos[photos.length - 1] || null;
    const last = lastPhoto ? lastPhoto.name : "";
    found.push({ folder: name, key, count: photos.length, last, dept: last ? deptFromName(last) : "", fh: lastPhoto ? lastPhoto.fh : null, photos });
  }

  // 찾은 값을 서버에 저장 (부서명이 있는 차량번호만)
  const updates = [];
  for (const f of found) {
    if (!f.dept) continue;
    for (const plate of plates.get(f.key)) updates.push({ plate, dept: f.dept });
  }
  // 폴더 안 사진 개수도 함께 저장한다 (목록 부서 칸 아래 "(개수)")
  const counts = [];
  for (const f of found) {
    for (const plate of plates.get(f.key)) counts.push({ plate, count: f.count });
  }
  let saved = true;
  let saveError = "";
  if (updates.length || counts.length) {
    const send = () => fetch("api/orders/dept", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates, counts }),
    });
    let res = await send();
    if (res.status === 401 && typeof ensureLogin === "function" && await ensureLogin()) res = await send();
    saved = res.ok;
    if (!saved) {
      const data = await res.json().catch(() => ({}));
      saveError = `(${res.status}${data.error ? ` ${data.error}` : ""})`;
    } else {
      deptChanged = true;
    }
  }

  if (opts.onSaved) opts.onSaved(saved, pulledCount);
  const withPhotos = found.filter((f) => f.photos && f.photos.length);
  for (const f of found.sort((a, b) => a.folder.localeCompare(b.folder, "ko"))) {
    const tr = document.createElement("tr");
    [f.folder, String(f.count), f.last || "-", deptLabel(f.dept) || "(부서명 없음)"].forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
  const matched = found.length;
  setDeptStatus(
    `차량번호 폴더 ${matched}개와 목록이 맞았습니다. ` +
    (saved ? `${updates.length}건 부서를 저장했습니다.` : `부서 저장에 실패했습니다. ${saveError}`) +
    (pulledCount ? ` 휴대폰에서 올린 사진 ${pulledCount}장을 폴더에 내려받았습니다.` : "") +
    (blockedCount ? ` 휴대폰에서 올린 사진 ${blockedCount}장을 폴더에 쓰려면 '지금 읽기 · 저장'을 눌러 쓰기 권한을 허용하세요.` : "")
  );
  deptBlockedCount = blockedCount;
  updatePullButton();
  // 사진은 뒤에서 올린다 (목록 갱신을 기다리게 하지 않는다)
  if (withPhotos.length) uploadDeptPhotos(withPhotos);
  // 본 사진 이름을 기억해 둔다 (다음 읽기에서 쓴다)
  await deptDbPut("seen", [...seenSet]).catch(() => {});
  await deptDbPut("seenInit", true).catch(() => {});
  return saved;
}

// 서버에 올라가 있는 사진 이름 (휴대폰에서 올린 사진 확인용)
async function fetchServerNames(key) {
  try {
    const res = await fetch(`api/deptphoto/${encodeURIComponent(key)}`, { credentials: "same-origin" });
    if (!res.ok) return [];
    return (await res.json()).names || [];
  } catch (err) {
    return [];
  }
}

// 사진을 차량번호 폴더의 부서 사진으로 올린다 (휴대폰 업로드·카톡 공유 공통).
// 이름은 "부서_시각_번호.jpg"로 붙여서 PC 지정폴더 읽기에서도 같은 부서로 읽힌다 (부서가 없으면 "업로드")
async function uploadPhotosForPlate(plate, deptRaw, files) {
  const key = plateKey(plate);
  const dept = String(deptRaw || "").replace(/\s+/g, "");
  const prefix = /^\d+\.\S+$/.test(dept) ? dept : "업로드";
  const stamp = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace(/\D/g, "").slice(0, 14);
  const mRes = await fetch(`api/deptphoto/${encodeURIComponent(key)}`, { credentials: "same-origin" });
  const have = new Set((mRes.ok ? (await mRes.json()).names : []) || []);
  const bRes = await fetch(`api/deptphoto/${encodeURIComponent(key)}/bundle`, { credentials: "same-origin" });
  const bundle = bRes.ok ? ((await bRes.json()).thumbs || {}) : {};
  // 이름은 먼저 정하고, 사진은 3장씩 동시에 줄여서 올린다 (한 장씩 기다리던 시간을 줄인다)
  const names = files.map((_, i) => {
    let name = `${prefix}_${stamp}_${i + 1}.jpg`;
    for (let n = 1; have.has(name); n++) name = `${prefix}_${stamp}_${i + 1}_${n}.jpg`;
    have.add(name);
    return name;
  });
  let bundleChanged = false;
  let next = 0;
  // 서버가 잠깐 실패(500 등)해도 여러 번 다시 올린다. 끝까지 안 올라간 사진은 목록에 넣지 않고, 오류 글자는 띄우지 않는다
  const failedNames = [];
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const blob = await shrinkPhoto(files[i]);
      let ok = false;
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        let status = 0;
        try {
          const res = await fetch(`api/deptphoto/${encodeURIComponent(key)}/${encodeURIComponent(names[i])}`, {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": blob.type || "image/jpeg" },
            body: blob,
          });
          ok = res.ok;
          status = res.status;
        } catch (err) {
          ok = false;
        }
        // 4xx(크기·로그인 문제)는 다시 해도 소용없으므로 바로 그만둔다
        if (!ok && status >= 400 && status < 500) break;
        if (!ok) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
      if (!ok) { failedNames.push(names[i]); continue; }
      // 목록 격자용 작은 그림은 줄인 사진에서 만든다 (원본을 다시 풀지 않는다)
      const t = await makeThumb(blob);
      if (t) { bundle[names[i]] = await blobToDataUrl(t); bundleChanged = true; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
  // 올라가지 못한 이름은 사진 목록에서 뺀다 (목록에 있는데 파일이 없는 일을 막는다)
  failedNames.forEach((n) => { have.delete(n); delete bundle[n]; });
  // 묶음 그림과 사진 이름 목록은 한 번에 함께 저장한다
  await Promise.all([
    bundleChanged ? fetch(`api/deptphoto/${encodeURIComponent(key)}/bundle`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thumbs: bundle }),
    }).catch(() => null) : null,
    fetch(`api/deptphoto/${encodeURIComponent(key)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: [...have] }),
    }).catch(() => null),
  ]);
  return files.length - failedNames.length;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// 목록 격자용 작은 미리보기 (긴 쪽 300px JPEG)
async function makeThumb(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 300 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.65));
  } catch (err) {
    return null;
  }
}

// 차량별 사진을 서버에 올린다 (이미 올라간 사진은 건너뛴다)
async function uploadDeptPhotos(withPhotos) {
  for (let i = 0; i < withPhotos.length; i++) {
    const f = withPhotos[i];
    setDeptStatus(`사진 올리는 중… ${i + 1} / ${withPhotos.length} (${f.folder})`);
    try {
      const mfRes = await fetch(`api/deptphoto/${encodeURIComponent(f.key)}`, { credentials: "same-origin" });
      const mf = mfRes.ok ? await mfRes.json() : { names: [] };
      const have = new Set(mf.names || []);
      // 미리보기 묶음: 이미 있는 것은 그대로, 없는 것만 새로 만든다
      const bRes = await fetch(`api/deptphoto/${encodeURIComponent(f.key)}/bundle`, { credentials: "same-origin" });
      const bundle = bRes.ok ? ((await bRes.json()).thumbs || {}) : {};
      let bundleChanged = false;
      for (const ph of f.photos) {
        if (!bundle[ph.name]) {
          const t = await makeThumb(await ph.fh.getFile());
          if (t) { bundle[ph.name] = await blobToDataUrl(t); bundleChanged = true; }
        }
        if (have.has(ph.name)) continue;
        const file = await ph.fh.getFile();
        const blob = await shrinkPhoto(file);
        const base = `api/deptphoto/${encodeURIComponent(f.key)}/${encodeURIComponent(ph.name)}`;
        const res = await fetch(base, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": blob.type || "image/jpeg" },
          body: blob,
        });
        if (res.ok) have.add(ph.name);
      }
      if (bundleChanged) {
        await fetch(`api/deptphoto/${encodeURIComponent(f.key)}/bundle`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thumbs: bundle }),
        });
      }
      const names = f.photos.map((p) => p.name).filter((n) => have.has(n));
      await fetch(`api/deptphoto/${encodeURIComponent(f.key)}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
      });
    } catch (err) {
      // 한 차량의 사진을 못 올려도 부서 저장은 그대로 둔다
    }
  }
  setDeptStatus("사진 올리기 완료");
}

// 사진을 올리기 전에 줄인다 (긴 쪽 1600px JPEG)
async function shrinkPhoto(file) {
  // 종류를 못 알아보는 사진(형식 이름이 비어 있는 경우)도 사진으로 보고 줄인다
  const looksImage = (file.type && file.type.startsWith("image/")) || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name || "");
  if (!looksImage || file.size < 600 * 1024) return file;
  let source = null;
  try {
    source = await createImageBitmap(file);
  } catch (err) {
    // 브라우저가 바로 못 읽는 형식이면 그림 요소로 읽어 본다
    source = await new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  if (!source) return file;
  try {
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    const scale = Math.min(1, 1600 / Math.max(sw, sh));
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return out && out.size < file.size ? out : file;
  } catch (err) {
    return file;
  }
}

// 목록의 부서 값을 누르면 그 차량의 작업 사진을 모두 본다
async function openDeptPhoto(plate, dept = "") {
  const key = plateKey(plate);
  let names = [];
  let thumbs = {};
  try {
    const [mRes, bRes] = await Promise.all([
      fetch(`api/deptphoto/${encodeURIComponent(key)}`, { credentials: "same-origin" }),
      fetch(`api/deptphoto/${encodeURIComponent(key)}/bundle`, { credentials: "same-origin" }),
    ]);
    if (mRes.ok) names = (await mRes.json()).names || [];
    if (bRes.ok) thumbs = (await bRes.json()).thumbs || {};
  } catch (err) {
    names = [];
  }
  const overlay = document.createElement("div");
  overlay.className = "dept-photo-overlay dept-gallery";
  const head = document.createElement("p");
  head.className = "gallery-head";
  head.textContent = names.length ? `${plate} · 작업 사진 ${names.length}장` : `${plate} · 저장된 사진이 없습니다`;
  // 선택 모드: "선택"을 누르면 사진을 여러 장 고를 수 있고, 골라서 한 번에 보낸다 (카톡 등)
  const bar = document.createElement("div");
  bar.className = "gallery-bar";
  const selBtn = document.createElement("button");
  selBtn.type = "button";
  selBtn.textContent = "선택";
  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.textContent = "전체 선택";
  allBtn.hidden = true;
  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "gb-send";
  sendBtn.hidden = true;
  // 업로드: 휴대폰 갤러리에서 고른 사진을 이 차량의 부서 사진으로 올린다
  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.textContent = "업로드";
  const upInput = document.createElement("input");
  upInput.type = "file";
  upInput.accept = "image/*";
  upInput.multiple = true;
  upInput.hidden = true;
  upBtn.addEventListener("click", (e) => { e.stopPropagation(); upInput.click(); });
  upInput.addEventListener("click", (e) => e.stopPropagation());
  upInput.addEventListener("change", async () => {
    const files = [...upInput.files];
    upInput.value = "";
    if (!files.length) return;
    note.textContent = `사진 ${files.length}장을 올리는 중…`;
    try {
      const n = await uploadPhotosForPlate(plate, dept, files);
      closeGallery();
      openDeptPhoto(plate, dept);
      return;
    } catch (err) {
      note.textContent = `올리지 못했습니다: ${err.message || err}`;
    }
  });
  bar.append(selBtn, upBtn, allBtn, sendBtn, upInput);
  const note = document.createElement("p");
  note.className = "gallery-note";
  note.addEventListener("click", (e) => e.stopPropagation());
  const grid = document.createElement("div");
  grid.className = "gallery-grid";
  const picked = new Set();
  let selecting = false;
  const imgs = [];
  // 10장을 넘으면 10장씩 나눠서 보낸다 (sendPos: 다음에 보낼 첫 번째 위치)
  const SHARE_BATCH = 10;
  let sendPos = 0;
  const updateSend = () => {
    const n = picked.size;
    if (n > SHARE_BATCH) {
      const to = Math.min(sendPos + SHARE_BATCH, n);
      sendBtn.textContent = `${sendPos + 1}~${to}번 사진 보내기 (${n}장 중)`;
    } else {
      sendBtn.textContent = `선택한 사진 ${n}장 보내기`;
    }
    sendBtn.disabled = n === 0;
  };
  // 선택 중에는 안내문을 계속 보여 준다
  const GUIDE = "사진은 파일로 한 번에 10장까지 보낼 수 있어서, 10장씩 나눠서 보냅니다. 10장을 넘으면 보내기 버튼을 여러 번 눌러 주세요.";
  const showGuide = () => { note.textContent = selecting ? GUIDE : ""; };
  // 원본 사진은 고를 때 미리 받아 둔다 (같은 사진은 한 번만 받는다)
  // 여러 장 공유는 전체 용량이 크면 브라우저가 막는다 → 보낼 때는 긴 쪽 1000px, 용량을 줄인 사본을 쓴다
  const shrinkForShare = async (blob) => {
    try {
      const bmp = await createImageBitmap(blob);
      // 보낼 사진은 긴 쪽 1000px의 사본 (10장씩 보내므로 화질은 그대로 둔다)
      const scale = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
      const out = await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.85));
      return out || blob;
    } catch (err) {
      return blob;
    }
  };
  const blobCache = new Map();
  const blobReady = new Map(); // 받아 둔 사진 (보내기 버튼은 이 값을 바로 쓴다)
  const loadBlob = (n) => {
    if (!blobCache.has(n)) {
      const p = fetch(`api/deptphoto/${encodeURIComponent(key)}/${encodeURIComponent(n)}`, { credentials: "same-origin" })
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
        .then(shrinkForShare)
        .then((b) => { blobReady.set(n, b); return b; })
        .catch((err) => { blobCache.delete(n); throw err; });
      blobCache.set(n, p);
    }
    return blobCache.get(n);
  };
  const pick = (idx, img) => {
    picked.add(idx);
    img.classList.add("picked");
    loadBlob(names[idx]).catch(() => {});
  };
  const toggleImg = (idx, img) => {
    if (picked.has(idx)) { picked.delete(idx); img.classList.remove("picked"); }
    else pick(idx, img);
    sendPos = 0;
    updateSend();
  };
  names.forEach((n, idx) => {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = n;
    img.title = n;
    // 미리보기 묶음에 있으면 그대로 쓰고(요청 없음), 없으면 미리보기 주소를 쓴다
    img.src = thumbs[n] || `api/deptphoto/${encodeURIComponent(key)}/${encodeURIComponent(n)}?thumb=1`;
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      if (selecting) { toggleImg(idx, img); return; }
      openPhotoViewer(key, names, idx);
    });
    imgs.push(img);
    grid.appendChild(img);
  });
  selBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    selecting = !selecting;
    selBtn.textContent = selecting ? "선택 끝" : "선택";
    allBtn.hidden = !selecting;
    sendBtn.hidden = !selecting;
    sendPos = 0;
    if (!selecting) {
      picked.clear();
      imgs.forEach((i) => i.classList.remove("picked"));
    }
    updateSend();
    showGuide();
  });
  allBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const all = picked.size < names.length;
    imgs.forEach((img, idx) => {
      if (all) pick(idx, img);
      else { picked.delete(idx); img.classList.remove("picked"); }
    });
    allBtn.textContent = all ? "전체 해제" : "전체 선택";
    sendPos = 0;
    updateSend();
  });
  // 보내기: 사진은 파일 그대로 보낸다. 공유는 한 번에 10장까지 되므로 10장씩 나눠서 보낸다 (sendPos: 다음에 보낼 첫 위치)
  sendBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (picked.size === 0) return;
    const chosen = [...picked].sort((a, b) => a - b).map((i) => names[i]);
    const batch = chosen.slice(sendPos, sendPos + SHARE_BATCH);
    note.textContent = "";
    if (!navigator.share || !navigator.canShare) {
      note.textContent = "이 기기에서는 공유를 지원하지 않습니다.";
      return;
    }
    try {
      if (batch.some((n) => !blobReady.has(n))) {
        sendBtn.disabled = true;
        sendBtn.textContent = "사진 준비 중…";
        await Promise.all(batch.map((n) => loadBlob(n)));
      }
      const files = batch.map((n) => {
        const b = blobReady.get(n);
        return new File([b], n, { type: b.type || "image/jpeg" });
      });
      if (!navigator.canShare({ files })) {
        note.textContent = "이 기기에서는 사진 여러 장을 한 번에 보낼 수 없습니다.";
        return;
      }
      await navigator.share({ files, title: plate });
      // 이번 10장을 보냈으면 다음 10장으로 넘어간다 (끝까지 보냈으면 처음으로)
      sendPos = sendPos + batch.length < chosen.length ? sendPos + batch.length : 0;
    } catch (err) {
      if (err && err.name !== "AbortError") note.textContent = "다시 한 번 눌러 주세요.";
    } finally {
      updateSend();
      showGuide();
    }
  });
  const close = document.createElement("button");
  close.type = "button";
  close.className = "gallery-close";
  close.textContent = "닫기";
  overlay.append(head, bar, note, grid, close);
  // 사진 목록 닫기: 닫기 단추, 바깥 누르기, ESC (사진 보기가 떠 있을 때의 ESC는 사진 보기가 먼저 받는다)
  const closeGallery = () => {
    document.removeEventListener("keydown", onGalleryKey);
    overlay.remove();
  };
  const onGalleryKey = (e) => {
    if (e.key === "Escape" && !document.querySelector(".photo-viewer")) closeGallery();
  };
  close.addEventListener("click", (e) => { e.stopPropagation(); closeGallery(); });
  overlay.addEventListener("click", () => closeGallery());
  document.addEventListener("keydown", onGalleryKey);
  document.body.appendChild(overlay);
}

// 사진 보기: 좌우 버튼, 키보드 방향키, 휴대폰은 밀어서 이전·다음 사진
function openPhotoViewer(key, names, start) {
  let index = start;
  const overlay = document.createElement("div");
  overlay.className = "photo-viewer";
  const stage = document.createElement("div");
  stage.className = "pv-stage";
  const img = document.createElement("img");
  img.alt = "";
  const counter = document.createElement("p");
  counter.className = "pv-count";
  const btnPrev = document.createElement("button");
  btnPrev.type = "button";
  btnPrev.className = "pv-btn pv-prev";
  btnPrev.textContent = "◀ 이전";
  const btnNext = document.createElement("button");
  btnNext.type = "button";
  btnNext.className = "pv-btn pv-next";
  btnNext.textContent = "다음 ▶";
  const btnClose = document.createElement("button");
  btnClose.type = "button";
  btnClose.className = "pv-close";
  btnClose.textContent = "닫기";
  stage.append(img);
  overlay.append(btnPrev, stage, btnNext, counter, btnClose);

  const fullUrl = (i) => `api/deptphoto/${encodeURIComponent(key)}/${encodeURIComponent(names[i])}`;
  const show = () => {
    const n = names[index];
    img.src = fullUrl(index);
    // 앞뒤 사진을 미리 받아 두면 넘길 때 바로 뜬다
    [index - 1, index + 1].forEach((i) => { if (i >= 0 && i < names.length) new Image().src = fullUrl(i); });
    img.alt = n;
    counter.textContent = `${index + 1} / ${names.length} · ${n}`;
    btnPrev.disabled = index <= 0;
    btnNext.disabled = index >= names.length - 1;
  };
  const go = (d) => {
    const next = index + d;
    if (next < 0 || next >= names.length) return;
    index = next;
    show();
  };
  // 닫기: 사진 보기만 닫고 사진 목록(격자)으로 돌아간다
  const closeViewer = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  // ESC: 사진 보기만 닫고 바로 앞 단계인 사진 목록(격자)으로 돌아간다
  const onKey = (e) => {
    if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "Escape") closeViewer();
  };
  btnPrev.addEventListener("click", (e) => { e.stopPropagation(); go(-1); });
  btnNext.addEventListener("click", (e) => { e.stopPropagation(); go(1); });
  btnClose.addEventListener("click", (e) => { e.stopPropagation(); closeViewer(); });
  // 카톡 등으로 보내기: 휴대폰 공유창을 연다 (지원하는 기기에서만 보인다)
  if (navigator.share && navigator.canShare) {
    const btnShare = document.createElement("button");
    btnShare.type = "button";
    btnShare.className = "pv-share";
    btnShare.textContent = "공유";
    btnShare.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const res = await fetch(fullUrl(index));
        const blob = await res.blob();
        const file = new File([blob], names[index], { type: blob.type || "image/jpeg" });
        if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: names[index] });
      } catch (err) {
        // 공유를 취소하거나 실패하면 그냥 닫지 않고 그대로 둔다
      }
    });
    overlay.appendChild(btnShare);
  }
  overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target === stage) closeViewer(); });

  // 밀기: 왼쪽으로 밀면 다음, 오른쪽으로 밀면 이전
  let x0 = null;
  let y0 = null;
  overlay.addEventListener("touchstart", (e) => {
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  overlay.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  show();
}

// 부서·대표정보보기 칸, 사진 목록·사진 보기, 작업요약 팝업: 길게 누르기·선택·우클릭으로
// 크롬 검색창(하단 "Google 검색")이나 메뉴가 뜨지 않게 막는다 (캡처 단계에서 가장 먼저 막는다)
const NO_SEARCH_SEL = ".c-dept, .c-rep, .c-paint, .rep-popup, .dept-gallery, .photo-viewer, .dept-photo-overlay";
document.addEventListener("contextmenu", (e) => {
  if (e.target && e.target.closest && e.target.closest(NO_SEARCH_SEL)) e.preventDefault();
}, true);
document.addEventListener("selectstart", (e) => {
  if (e.target && e.target.closest && e.target.closest(NO_SEARCH_SEL)) e.preventDefault();
}, true);
document.addEventListener("dragstart", (e) => {
  if (e.target && e.target.closest && e.target.closest(NO_SEARCH_SEL)) e.preventDefault();
}, true);
// 두 번 누르기로 글자가 선택되었다면 선택을 푼다 (검색창이 뜨는 원인)
document.addEventListener("dblclick", (e) => {
  if (e.target && e.target.closest && e.target.closest(NO_SEARCH_SEL)) {
    const sel = window.getSelection && window.getSelection();
    if (sel) sel.removeAllRanges();
  }
}, true);

// 저장된 부서는 닫기를 누를 때 목록에 적용된다
let deptChanged = false;
// 마지막 읽기에서 쓰기 권한이 없어 폴더에 못 내려받은 휴대폰 사진 수
let deptBlockedCount = 0;
// 못 내려받은 사진이 있으면 목록 상단에 'PC 폴더에 사진 내려받기' 단추를 보인다 (누르면 쓰기 권한을 묻고 바로 내려받는다)
// connectNeeded: 브라우저를 다시 연 뒤 폴더 권한을 한 번 허용해야 할 때 ("PC 폴더 연결")
function updatePullButton(connectNeeded = false) {
  const b = document.getElementById("dept-pull");
  if (!b) return;
  if (connectNeeded) {
    b.textContent = "PC 폴더 연결 (한 번 누르세요)";
    b.hidden = false;
  } else {
    b.textContent = "PC 폴더에 사진 내려받기";
    b.hidden = !deptBlockedCount;
  }
}
const pullBtn = document.getElementById("dept-pull");
if (pullBtn) {
  pullBtn.addEventListener("click", async () => {
    pullBtn.disabled = true;
    deptLive("PC 폴더에 사진을 내려받는 중…");
    // 단추를 누른 것이므로 권한을 물을 수 있다 (쓰기 권한이 있어야 내려받는다)
    await readDeptFolder({}).catch(() => {});
    pullBtn.disabled = false;
    deptLive(deptBlockedCount ? "아직 쓰기 권한이 없습니다. 창의 허용을 눌러 주세요" : "PC 폴더 확인 완료");
    if (typeof load === "function") load(typeof listPage === "number" ? listPage : 1);
  });
}

function closeDeptModal() {
  deptEl("dept-modal").hidden = true;
  deptEl("dept-modal").style.display = "none";
  if (deptChanged) {
    deptChanged = false;
    if (typeof load === "function") load(1);
  }
}

function openDeptModal() {
  deptEl("dept-modal").hidden = false;
  deptEl("dept-modal").style.display = "flex";
}

// 마스터에게만 단추를 보인다
// 목록 화면 상단의 부서 확인 상태 글자
function deptLive(text) {
  const el = document.getElementById("dept-live");
  if (el) el.textContent = text;
}

// 목록을 열 때 폴더를 읽어 부서를 갱신한다. 권한이 없을 때 gesture 가 있으면 권한을 묻는다
async function autoDeptRead(opts = {}) {
  const reload = () => { if (typeof load === "function") load(typeof listPage === "number" ? listPage : 1); };
  const ok = await readDeptFolder({ silent: !opts.gesture, onSaved: (saved) => { if (saved) reload(); } }).catch((err) => {
    deptLive(`부서 확인 실패: ${err && err.message ? err.message : err}`);
    return false;
  });
  if (ok) {
    // "부서 확인 완료" 글자는 화면에 보이지 않는다 (쓰기 권한이 없어 폴더에 못 내려받은 사진이 있을 때만 안내한다)
    deptLive(deptBlockedCount ? "휴대폰 사진을 PC 폴더에 내려받으려면 부서 읽기 지정폴더에서 '지금 읽기 · 저장'을 누르세요" : "");
    reload();
  } else if (ok === false && !opts.gesture) {
    deptLive("부서 확인: 목록 화면을 한 번 눌러 주세요 (폴더 읽기 허용)");
  }
}

// 지정 폴더를 계속 확인한다: 권한이 살아 있으면 10분마다, 화면으로 돌아올 때마다 다시 읽는다.
// 새로 찾은 부서가 있을 때만 목록을 다시 그리고, 수정 중인 줄이 있으면 다시 그리지 않는다 (수정이 닫히지 않도록)
let deptWatchStarted = false;
// 휴대폰에서 바뀌었지만 아직 PC에서 읽지 않은 차량번호들 (읽기가 바쁠 때 밀려도 놓치지 않는다)
let pendingKeys = new Set();
function startDeptWatch(h) {
  if (deptWatchStarted) return;
  deptWatchStarted = true;
  let busy = false;
  const tick = async (extra = {}) => {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const perm = await h.queryPermission({ mode: "read" }).catch(() => "prompt");
      if (perm !== "granted") return;
      await readDeptFolder({
        silent: true,
        onlyKeys: extra.onlyKeys,
        onSaved: (saved, pulled) => {
          // 새로 내려받은 사진이 있을 때만 목록을 다시 그린다 (아무 변화가 없는데 다시 그리면 '불러오는 중'이 수시로 뜬다)
          if (saved && pulled > 0 && !document.querySelector(".edit-input") && typeof load === "function") {
            load(typeof listPage === "number" ? listPage : 1);
          }
        },
      });
      if (extra.onlyKeys) extra.onlyKeys.forEach((k) => pendingKeys.delete(k));
    } catch (err) {
      // 읽기에 실패해도 다음 주기에 다시 시도한다
    } finally {
      busy = false;
    }
  };
  // 10초마다 '사진이 바뀌었나?'만 가볍게 확인한다. 바뀌었을 때만 폴더를 읽어 내려받는다
  let lastVer = null;
  let lastT = 0;
  const checkVersion = async () => {
    if (document.hidden) return;
    try {
      const res = await fetch("api/deptver", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return;
      const { v, changes = [] } = await res.json();
      const newest = changes.reduce((m, c) => Math.max(m, Number(c.t) || 0), 0);
      if (lastVer === null) { lastVer = v; lastT = newest; return; }
      if (v === lastVer) {
        // 바뀌지 않았어도, 밀려 있는 차량이 있으면 이어서 읽는다
        if (pendingKeys.size) await tick({ onlyKeys: new Set(pendingKeys) });
        return;
      }
      lastVer = v;
      changes.filter((c) => (Number(c.t) || 0) > lastT).forEach((c) => pendingKeys.add(c.k));
      lastT = newest;
      // 바뀐 차량 폴더만 읽는다
      if (pendingKeys.size) await tick({ onlyKeys: new Set(pendingKeys) });
    } catch (err) {
      // 연결이 잠깐 끊겨도 다음 10초에 다시 확인한다
    }
  };
  setInterval(checkVersion, 10 * 1000);
  // 안전장치: 바뀐 표시와 상관없이 10분마다 한 번 전체를 읽는다
  setInterval(tick, 10 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  window.addEventListener("focus", tick);
}

// 저장된 폴더 이름은 모든 계정(마스터 포함)에서 화면에 바로 보인다.
// 폴더 정보는 이 PC 브라우저(IndexedDB)에 남아 있으므로, 업데이트·재시작 뒤에도 '지정하지 않음'으로 되돌아가지 않는다
getSession().then((s) => {
  if (s && s.ok) {
    deptDbGet(DEPT_KEY).then((h) => {
      if (h && h.name) deptEl("dept-folder").textContent = h.name;
    }).catch(() => {});
  }
  if (s && s.ok && s.role === "shop") {
    deptEl("dept-open").hidden = false;
    deptEl("dept-ack-all").hidden = false;
    deptEl("dept-ack-all").addEventListener("click", async () => {
      const res = await fetch("api/orders/dept-ack-all", { method: "POST", credentials: "same-origin" });
      if (res.ok && typeof load === "function") load(typeof listPage === "number" ? listPage : 1);
    });
    deptDbGet(DEPT_KEY).then(async (h) => {
      // 공업사 계정에는 폴더 안내 글자를 보이지 않는다 (폴더 지정은 마스터 몫)
      if (!h) { deptLive(""); return; }
      deptEl("dept-folder").textContent = h.name;
      // 저장된 폴더는 삭제하거나 위치를 바꾸기 전까지 계속 확인한다
      startDeptWatch(h);
      const perm = await h.queryPermission({ mode: "read" }).catch(() => "prompt");
      if (perm === "granted") {
        await autoDeptRead();
      } else {
        // 브라우저를 새로 열면 권한을 다시 물어야 한다. 화면을 한 번 누르면 그때 권한을 묻고 바로 읽는다
        deptLive("부서 확인: 목록 화면을 한 번 눌러 주세요 (폴더 읽기 허용)");
        updatePullButton(true); // 'PC 폴더 연결' 단추로도 한 번에 허용할 수 있다
        document.addEventListener("pointerdown", async () => {
          deptLive("부서 확인 중…");
          await autoDeptRead({ gesture: true });
        }, { once: true });
      }
    }).catch(() => deptLive("부서 확인을 하지 못했습니다"));
  }
});

deptEl("dept-open").addEventListener("click", openDeptModal);
deptEl("dept-close").addEventListener("click", closeDeptModal);
deptEl("dept-modal").addEventListener("click", (e) => {
  if (e.target === deptEl("dept-modal")) closeDeptModal();
});
deptEl("dept-pick").addEventListener("click", pickDeptFolder);
deptEl("dept-read").addEventListener("click", readDeptFolder);
