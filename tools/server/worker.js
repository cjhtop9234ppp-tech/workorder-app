// 작업지시서 저장 API (Cloudflare Worker + D1).
// /api/* 만 이 파일이 처리하고, 나머지는 app 폴더의 정적 파일을 그대로 보낸다.
//
// 계정
//   마스터: 아이디 "master", 비밀번호 = Worker secret WORKORDER_PASSWORD. 공업사 계정을 만들고 전체 목록을 본다.
//   공업사: 마스터가 만든 아이디·비밀번호. 자기 작업지시서만 저장·조회한다.
//
// API
//   POST /api/login              {id, password}              → 로그인 쿠키
//   POST /api/logout                                         → 로그아웃
//   GET  /api/session                                        → {ok, role, shopId, name}
//   GET  /api/shops                                          (마스터) 공업사 목록
//   POST /api/shops              {name, loginId, password}   (마스터) 공업사 등록
//   POST /api/orders             {vehicle, plate, rows}      (공업사) 저장
//   GET  /api/orders                                         목록 (공업사: 자기 것, 마스터: 전체)
//   GET  /api/orders?vehicle=&plate=[&shop=]                 한 건 (마스터는 shop 지정)

const COOKIE = "wo_session";
const SESSION_HOURS = 24 * 14;
const MAX_ROWS = 400;
const MAX_TEXT = 200;
const PBKDF2_ITER = 100000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      console.error("server error", request.method, url.pathname, String(err && err.message || err));
      return json({ error: "서버 오류" }, 500);
    }
  },
};

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/login" && method === "POST") return login(request, env);
  if (path === "/api/logout" && method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }
  if (path === "/api/session" && method === "GET") {
    const s = await readSession(request, env);
    return json(s ? { ok: true, role: s.role, shopId: s.sid, name: s.name } : { ok: false });
  }

  const session = await readSession(request, env);
  if (!session) return json({ error: "로그인이 필요합니다" }, 401);

  if (path === "/api/master/password" && method === "POST") return changeMasterPassword(request, env, session);

  if (path === "/api/shops" && method === "GET") {
    if (session.role !== "master") return json({ error: "마스터만 볼 수 있습니다" }, 403);
    const { results } = await env.DB.prepare(
      "SELECT id, name, login_id, created_at FROM shops WHERE id != 'legacy' ORDER BY created_at"
    ).all();
    return json({ shops: results.map((r) => ({ id: r.id, name: r.name, loginId: r.login_id, createdAt: r.created_at })) });
  }

  if (path === "/api/shops" && method === "POST") {
    if (session.role !== "master") return json({ error: "마스터만 등록할 수 있습니다" }, 403);
    return createShop(request, env);
  }

  if (path === "/api/orders" && method === "POST") {
    if (session.role !== "shop") return json({ error: "공업사 계정으로 로그인해야 저장할 수 있습니다" }, 403);
    return saveOrder(request, env, session);
  }

  if (path === "/api/orders" && method === "GET") {
    return listOrders(env, session, url);
  }

  if (path === "/api/orders/ack" && method === "POST") {
    if (session.role !== "shop") return json({ error: "공업사 계정만 수정 확인을 할 수 있습니다" }, 403);
    const body = await readJson(request);
    const id = orderId(session.sid, cleanText(body.vehicle), cleanText(body.plate));
    await env.DB.prepare("UPDATE orders SET revised = 0 WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  // 목록에서 고친 내용 (생성일·입고일·출고일·보험사·담보·차량번호·차량명·도장코드). 공업사는 자기 것만, 마스터는 모두
  if (path === "/api/orders/edit" && method === "POST") return editOrder(request, env, session);
  // 부서 저장 (마스터): 부서 읽기 폴더에서 읽은 값을 차량번호별로 저장한다. 목록에 계속 보인다
  if (path === "/api/orders/dept" && method === "POST") {
    // 공업사는 자기 작업지시서만, 마스터는 모든 작업지시서의 부서를 저장한다
    if (session.role !== "master" && session.role !== "shop") return json({ error: "로그인이 필요합니다" }, 403);
    const body = await readJson(request);
    if (!Array.isArray(body.updates) || body.updates.length > 500) return json({ error: "부서 목록이 올바르지 않습니다" }, 400);
    // 부서가 처음이면 바로 적용, 이미 있던 부서와 다르면 '변경(녹색)'으로 두고 갱신 단추를 누를 때 적용한다
    const scoped = session.role === "shop";
    const sql = `UPDATE orders SET dept = CASE WHEN dept = '' THEN ? ELSE dept END,
                   dept_new = CASE WHEN dept = '' OR dept = ? THEN '' ELSE ? END
                 WHERE plate = ?${scoped ? " AND shop_id = ?" : ""}`;
    const binds = body.updates
      .map((u) => ({ plate: cleanText(String(u.plate || "")), dept: cleanText(String(u.dept || "")).slice(0, 20) }))
      .filter((u) => u.plate && u.dept)
      .map((u) => env.DB.prepare(sql).bind(...[u.dept, u.dept, u.dept, u.plate, ...(scoped ? [session.sid] : [])]));
    // 폴더 안 사진 개수 (차량번호별, 목록 부서 칸 아래에 표시)
    const countSql = `UPDATE orders SET photo_count = ? WHERE plate = ?${scoped ? " AND shop_id = ?" : ""}`;
    const countBinds = (Array.isArray(body.counts) ? body.counts : [])
      .map((c) => ({ plate: cleanText(String(c.plate || "")), count: Math.max(0, Math.min(9999, Math.floor(Number(c.count) || 0))) }))
      .filter((c) => c.plate)
      .slice(0, 500)
      .map((c) => env.DB.prepare(countSql).bind(...[c.count, c.plate, ...(scoped ? [session.sid] : [])]));
    if (binds.length || countBinds.length) await env.DB.batch([...binds, ...countBinds]);
    return json({ ok: true, count: binds.length });
  }
  // 일괄갱신: 공업사의 녹색 음영(부서 변경)을 모두 갱신된 것으로 본다
  if (path === "/api/orders/dept-ack-all" && method === "POST") {
    if (session.role !== "shop") return json({ error: "공업사 계정만 일괄 갱신할 수 있습니다" }, 403);
    await env.DB.prepare(
      "UPDATE orders SET dept = dept_new, dept_new = '' WHERE dept_new != '' AND shop_id = ?"
    ).bind(session.sid).run();
    return json({ ok: true });
  }
  // 녹색 음영(부서 변경)을 갱신: 바뀐 부서를 현재 부서로 적용하고 녹색을 지운다
  if (path === "/api/orders/dept-ack" && method === "POST") {
    if (session.role !== "master" && session.role !== "shop") return json({ error: "로그인이 필요합니다" }, 403);
    const body = await readJson(request);
    const plate = cleanText(String(body.plate || ""));
    if (!plate) return json({ error: "차량번호가 올바르지 않습니다" }, 400);
    const scoped = session.role === "shop";
    await env.DB.prepare(
      `UPDATE orders SET dept = dept_new, dept_new = '' WHERE plate = ? AND dept_new != ''${scoped ? " AND shop_id = ?" : ""}`
    ).bind(...[plate, ...(scoped ? [session.sid] : [])]).run();
    return json({ ok: true });
  }
  if (path === "/api/orders/delete" && method === "POST") return deleteOrder(request, env, session);

  // ---------- 주작업항목 그림이미지 매칭 / 그림 파일 ----------
  // 선택한 매칭 행을 한 번에 지운다 (행 하나씩 요청하지 않도록)
  if (path === "/api/mapping/delete" && method === "POST") {
    if (session.role !== "master") return json({ error: "마스터만 지울 수 있습니다" }, 403);
    const body = await request.json().catch(() => ({}));
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger))];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const marks = chunk.map(() => "?").join(",");
      await env.DB.prepare(`DELETE FROM repair_items WHERE id IN (${marks})`).bind(...chunk).run();
    }
    return json({ ok: true, count: ids.length });
  }
  // 그림이미지를 여러 개 한 번에 지운다 (서버 그림 저장소와 목록 기록을 함께 지운다)
  if (path === "/api/images/delete" && method === "POST") {
    if (session.role !== "master") return json({ error: "마스터만 지울 수 있습니다" }, 403);
    const body = await request.json().catch(() => ({}));
    const codes = [...new Set((Array.isArray(body.codes) ? body.codes : []).map(String))]
      .filter((c) => /^[A-Za-z0-9_\-]{1,40}$/.test(c));
    await Promise.all(codes.map((c) => env.IMAGES.delete(c)));
    for (let i = 0; i < codes.length; i += 90) {
      const chunk = codes.slice(i, i + 90);
      const marks = chunk.map(() => "?").join(",");
      await env.DB.prepare(`DELETE FROM images WHERE code IN (${marks})`).bind(...chunk).run();
    }
    return json({ ok: true, count: codes.length });
  }
  if (path === "/api/mapping" && method === "GET") return listMapping(env);
  if (path === "/api/mapping" && method === "POST") {
    if (session.role !== "master") return json({ error: "마스터만 바꿀 수 있습니다" }, 403);
    return replaceMapping(request, env);
  }
  if (path === "/api/mapping/row" && method === "POST") {
    if (session.role !== "master") return json({ error: "마스터만 추가할 수 있습니다" }, 403);
    return addMappingRow(request, env);
  }
  if (path === "/api/mapping/order" && method === "POST") {
    if (session.role !== "master") return json({ error: "마스터만 바꿀 수 있습니다" }, 403);
    return saveMappingOrder(request, env);
  }
  if (path.startsWith("/api/mapping/") && method === "PATCH") {
    if (session.role !== "master") return json({ error: "마스터만 바꿀 수 있습니다" }, 403);
    return patchMapping(request, env, Number(path.slice("/api/mapping/".length)));
  }
  if (path.startsWith("/api/mapping/") && method === "DELETE") {
    if (session.role !== "master") return json({ error: "마스터만 지울 수 있습니다" }, 403);
    const id = Number(path.slice("/api/mapping/".length));
    if (!Number.isInteger(id)) return json({ error: "행 번호가 올바르지 않습니다" }, 400);
    await env.DB.prepare("DELETE FROM repair_items WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  // ---------- 공업사 계정 수정·삭제 (마스터) ----------
  if (path.startsWith("/api/shops/") && (method === "PATCH" || method === "DELETE")) {
    if (session.role !== "master") return json({ error: "마스터만 바꿀 수 있습니다" }, 403);
    return changeShop(request, env, decodeURIComponent(path.slice("/api/shops/".length)), method);
  }
  if (path === "/api/options" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, kind, value FROM options ORDER BY kind, id").all();
    return json({
      insurers: results.filter((r) => r.kind === "insurer").map((r) => ({ id: r.id, value: r.value })),
      coverages: results.filter((r) => r.kind === "coverage").map((r) => ({ id: r.id, value: r.value })),
    });
  }
  if (path === "/api/options" && method === "POST") {
    if (session.role !== "master") return json({ error: "마스터만 추가할 수 있습니다" }, 403);
    const body = await readJson(request);
    const kind = body.kind === "coverage" ? "coverage" : "insurer";
    const value = cleanText(body.value || "");
    if (!value) return json({ error: "내용을 입력하세요" }, 400);
    await env.DB.prepare("INSERT INTO options (kind, value) VALUES (?, ?)").bind(kind, value).run();
    return json({ ok: true });
  }
  if (path.startsWith("/api/options/") && method === "DELETE") {
    if (session.role !== "master") return json({ error: "마스터만 지울 수 있습니다" }, 403);
    const id = Number(path.slice("/api/options/".length));
    if (!Number.isInteger(id)) return json({ error: "번호가 올바르지 않습니다" }, 400);
    await env.DB.prepare("DELETE FROM options WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  // 차량명 정의 (마스터가 CSV 로 올린 목록. 모든 계정이 읽는다)
  if (path === "/api/vehicles" && method === "GET") return listVehicles(env);
  if (path === "/api/vehicles" && method === "PUT") {
    if (session.role !== "master") return json({ error: "마스터만 바꿀 수 있습니다" }, 403);
    return replaceVehicles(request, env);
  }

  if (path === "/api/paintcodes" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, no, code, coats FROM paint_codes ORDER BY id").all();
    return json({ codes: results.map((r) => ({ id: r.id, no: r.no || "", code: r.code, coats: r.coats || "" })) });
  }
  if (path === "/api/paintcodes" && method === "POST") {
    if (session.role !== "master") return json({ error: "마스터만 올릴 수 있습니다" }, 403);
    const body = await readJson(request);
    if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 20000) {
      return json({ error: "도장코드 행이 올바르지 않습니다" }, 400);
    }
    const rows = body.rows
      .map((r) => ({ no: cleanText(String(r.no ?? "")), code: cleanText(String(r.code ?? "")), coats: cleanText(String(r.coats ?? "")) }))
      .filter((r) => r.code);
    const stmt = env.DB.prepare("INSERT INTO paint_codes (no, code, coats) VALUES (?, ?, ?)");
    await env.DB.batch([env.DB.prepare("DELETE FROM paint_codes")]);
    for (let i = 0; i < rows.length; i += 50) {
      await env.DB.batch(rows.slice(i, i + 50).map((r) => stmt.bind(r.no, r.code, r.coats)));
    }
    return json({ ok: true, count: rows.length });
  }

  // ---------- 기타메모사항 목록 ----------
  // 마스터: 공통 목록(shop_id = all) 을 고친다. 공업사: 자기 목록만 고친다. 둘 다 볼 때는 공통 + 자기 목록.
  if (path === "/api/memos" && method === "GET") {
    const scopes = session.role === "master" ? ["all"] : ["all", session.sid];
    const { results } = await env.DB.prepare(
      `SELECT id, shop_id, value, category FROM memos WHERE shop_id IN (${scopes.map(() => "?").join(",")}) ORDER BY shop_id = 'all' DESC, sort, id`
    ).bind(...scopes).all();
    const pick = (r) => ({ id: r.id, value: r.value, category: r.category || "" });
    return json({
      global: results.filter((r) => r.shop_id === "all").map(pick),
      own: session.role === "master" ? [] : results.filter((r) => r.shop_id === session.sid).map(pick),
    });
  }
  if (path === "/api/memos" && method === "PUT") {
    const scope = session.role === "master" ? "all" : session.sid;
    const body = await readJson(request);
    if (!Array.isArray(body.values) || body.values.length > 200) return json({ error: "기타메모 목록이 올바르지 않습니다" }, 400);
    // 값은 {value, category}(구분 포함) 또는 글자만 올 수 있다. 글자만 오면 기존 구분을 그대로 이어 준다.
    const before = await env.DB.prepare("SELECT value, category FROM memos WHERE shop_id = ?").bind(scope).all();
    const oldCat = new Map(before.results.map((r) => [r.value, r.category || ""]));
    const values = body.values
      .map((v) => {
        if (typeof v === "string") { const value = cleanText(v); return { value, category: oldCat.get(value) || "" }; }
        return { value: cleanText(String(v && v.value || "")), category: cleanText(String(v && v.category || "")).slice(0, 20) };
      })
      .filter((x) => x.value);
    const stmt = env.DB.prepare("INSERT INTO memos (shop_id, value, sort, category) VALUES (?, ?, ?, ?)");
    await env.DB.prepare("DELETE FROM memos WHERE shop_id = ?").bind(scope).run();
    if (values.length) await env.DB.batch(values.map((v, i) => stmt.bind(scope, v.value, i, v.category)));
    return json({ ok: true, count: values.length });
  }

  if (path === "/api/images" && method === "GET") {
    if (session.role !== "master") return json({ error: "마스터만 볼 수 있습니다" }, 403);
    const { results } = await env.DB.prepare("SELECT code, uploaded_at FROM images ORDER BY code").all();
    return json({ images: results.map((r) => ({ code: r.code, uploadedAt: r.uploaded_at })) });
  }
  // 부서 사진: 차량번호별로 작업 사진을 모두 저장한다.
  //   GET  /api/deptphoto/:key            → 사진 이름 목록 {names}
  //   PUT  /api/deptphoto/:key  (JSON)    → 사진 이름 목록 저장 {names}
  //   PUT  /api/deptphoto/:key/:name      → 사진 한 장 저장
  //   GET  /api/deptphoto/:key/:name      → 사진 한 장
  // 부서 사진 변경 표시: 휴대폰 업로드마다 바뀌는 값 (PC가 가볍게 확인하는 용도)
  if (path === "/api/deptver" && method === "GET") {
    let changes = [];
    try { changes = JSON.parse((await env.IMAGES.get("deptchg")) || "[]"); } catch (e) { changes = []; }
    // 변경 표시는 한 곳(deptchg)에만 적는다 (저장 횟수를 줄여 하루 저장 한도를 아낀다)
    const v = changes[0] ? String(changes[0].t) : "0";
    return json({ v, changes }, 200, { "Cache-Control": "no-store" });
  }
  if (path.startsWith("/api/deptphoto/")) {
    const parts = path.slice("/api/deptphoto/".length).split("/");
    const key = decodeURIComponent(parts[0] || "");
    if (!/^[0-9A-Za-z가-힣_\-]{1,40}$/.test(key)) return json({ error: "차량번호가 올바르지 않습니다" }, 400);
    const manifestKey = `deptmf:${key}`;
    if (parts.length === 1) {
      if (method === "GET") {
        const text = await env.IMAGES.get(manifestKey);
        return json({ names: text ? JSON.parse(text) : [] }, 200, { "Cache-Control": "private, max-age=120" });
      }
      if (method === "PUT") {
        if (session.role !== "master" && session.role !== "shop") return json({ error: "로그인이 필요합니다" }, 403);
        const body = await readJson(request);
        // 사진 수는 제한하지 않는다 (차량 한 대의 사진 이름을 모두 보관한다)
        const names = Array.isArray(body.names) ? body.names.map((n) => cleanText(String(n))).filter(Boolean).slice(0, 100000) : [];
        await env.IMAGES.put(manifestKey, JSON.stringify(names));
        // 사진이 바뀌었음을 알린다 (PC 화면이 10초마다 이 값만 보고 바뀌었을 때만 내려받는다)
        // 어느 차량이 바뀌었는지도 기록한다 (PC가 그 차량 폴더만 갱신하도록). 최근 40건만 보관한다
        let changes = [];
        try { changes = JSON.parse((await env.IMAGES.get("deptchg")) || "[]"); } catch (e) { changes = []; }
        changes = [{ k: key, t: Date.now() }, ...changes.filter((c) => c && c.k !== key)].slice(0, 40);
        await env.IMAGES.put("deptchg", JSON.stringify(changes));
        return json({ ok: true, count: names.length });
      }
    }
    // 미리보기 묶음: 차량 한 대의 미리보기를 한 번에 받는다 (휴대폰 격자가 한 번의 요청으로 뜨도록)
    if (parts.length === 2 && parts[1] === "bundle") {
      const bKey = `deptbundle:${key}`;
      if (method === "GET") {
        const text = await env.IMAGES.get(bKey);
        return json({ thumbs: text ? JSON.parse(text) : {} }, 200, { "Cache-Control": "private, max-age=300" });
      }
      if (method === "PUT") {
        if (session.role !== "master" && session.role !== "shop") return json({ error: "로그인이 필요합니다" }, 403);
        const body = await readJson(request);
        const thumbs = {};
        if (body.thumbs && typeof body.thumbs === "object") {
          for (const [n, v] of Object.entries(body.thumbs)) {
            if (typeof v === "string" && v.startsWith("data:image/") && v.length < 120000 && n.length <= 160) thumbs[n] = v;
          }
        }
        await env.IMAGES.put(bKey, JSON.stringify(thumbs));
        return json({ ok: true, count: Object.keys(thumbs).length });
      }
    }
    if (parts.length === 2) {
      const name = decodeURIComponent(parts[1] || "");
      if (!name || name.length > 160 || name.includes("/")) return json({ error: "사진 이름이 올바르지 않습니다" }, 400);
      // ?thumb=1 이면 작은 미리보기 (목록 격자용). 미리보기가 없으면 원래 사진을 준다
      const thumbParam = url.searchParams.get("thumb");
      const isThumb = thumbParam === "1" || thumbParam === "only";
      const photoKey = `deptph:${key}/${name}`;
      const thumbKey = `deptth:${key}/${name}`;
      if (method === "GET") {
        let got = isThumb ? await env.IMAGES.getWithMetadata(thumbKey, "arrayBuffer") : { value: null };
        // thumb=only: 미리보기가 있는지만 확인한다 (없으면 404)
        if (!got.value && thumbParam !== "only") got = await env.IMAGES.getWithMetadata(photoKey, "arrayBuffer");
        if (!got.value) return json({ error: "사진이 없습니다" }, 404);
        return new Response(got.value, {
          headers: {
            "Content-Type": (got.metadata && got.metadata.type) || "image/jpeg",
            "Cache-Control": "private, max-age=86400",
          },
        });
      }
      if (method === "PUT") {
        if (session.role !== "master" && session.role !== "shop") return json({ error: "로그인이 필요합니다" }, 403);
        const type = request.headers.get("Content-Type") || "image/jpeg";
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength === 0 || bytes.byteLength > 15 * 1024 * 1024) {
          return json({ error: "사진 크기가 올바르지 않습니다 (15MB 이하)" }, 400);
        }
        // 저장소가 잠깐 실패해도 다시 저장한다 (3번까지)
        let saved = false;
        for (let attempt = 0; attempt < 3 && !saved; attempt++) {
          try {
            await env.IMAGES.put(isThumb ? thumbKey : photoKey, bytes, { metadata: { type } });
            saved = true;
          } catch (err) {
            console.error("deptphoto put failed", attempt, String(err && err.message || err));
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
        }
        if (!saved) return json({ error: "잠시 후 다시 올려 주세요" }, 503);
        return json({ ok: true });
      }
    }
  }

  if (path.startsWith("/api/img/")) {
    const code = decodeURIComponent(path.slice("/api/img/".length));
    if (!/^[A-Za-z0-9_\-]{1,40}$/.test(code)) return json({ error: "그림코드가 올바르지 않습니다" }, 400);
    if (method === "GET") {
      const got = await env.IMAGES.getWithMetadata(code, "arrayBuffer");
      if (!got.value) return json({ error: "그림이 없습니다" }, 404);
      return new Response(got.value, {
        headers: {
          "Content-Type": (got.metadata && got.metadata.type) || "image/jpeg",
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
    if (method === "DELETE") {
      if (session.role !== "master") return json({ error: "마스터만 지울 수 있습니다" }, 403);
      await env.IMAGES.delete(code);
      await env.DB.prepare("DELETE FROM images WHERE code = ?").bind(code).run();
      return json({ ok: true, code });
    }
    if (method === "PUT") {
      if (session.role !== "master") return json({ error: "마스터만 올릴 수 있습니다" }, 403);
      const type = request.headers.get("Content-Type") || "image/jpeg";
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) {
        return json({ error: "그림 파일 크기가 올바르지 않습니다 (8MB 이하)" }, 400);
      }
      await env.IMAGES.put(code, bytes, { metadata: { type } });
      await env.DB.prepare(
        "INSERT INTO images (code, uploaded_at) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET uploaded_at = excluded.uploaded_at"
      ).bind(code, new Date().toISOString()).run();
      return json({ ok: true, code });
    }
  }

  return json({ error: "없는 주소입니다" }, 404);
}

// ---------- 로그인 · 세션 ----------

async function login(request, env) {
  const body = await readJson(request);
  const id = cleanText(body.id).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!id || !password) return json({ error: "아이디와 비밀번호를 입력하세요" }, 400);

  let session = null;
  if (id === "master") {
    if (await masterPasswordOk(password, env)) {
      session = { sid: "master", role: "master", name: "마스터" };
    }
  } else {
    const shop = await env.DB.prepare(
      "SELECT id, name, pw_salt, pw_hash FROM shops WHERE login_id = ? AND id != 'legacy'"
    ).bind(id).first();
    if (shop && (await verifyPassword(password, shop.pw_salt, shop.pw_hash))) {
      session = { sid: shop.id, role: "shop", name: shop.name };
    }
  }
  if (!session) return json({ error: "아이디 또는 비밀번호가 맞지 않습니다" }, 401);

  const token = await makeToken(env, { ...session, exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
  return json({ ok: true, role: session.role, name: session.name }, 200, {
    "Set-Cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`,
  });
}

// 마스터 비밀번호: 웹에서 바꾼 값(DB)이 있으면 그것을, 없으면 Worker secret WORKORDER_PASSWORD 를 쓴다
async function masterPasswordOk(password, env) {
  const row = await env.DB.prepare("SELECT pw_salt, pw_hash FROM master_auth WHERE id = 1").first();
  if (row) return verifyPassword(password, row.pw_salt, row.pw_hash);
  return Boolean(env.WORKORDER_PASSWORD) && (await safeEqual(password, env.WORKORDER_PASSWORD));
}

// 마스터 비밀번호 바꾸기 (마스터 로그인 후, 현재 비밀번호를 한 번 더 확인한다)
async function changeMasterPassword(request, env, session) {
  if (session.role !== "master") return json({ error: "마스터만 바꿀 수 있습니다" }, 403);
  const body = await readJson(request);
  const current = typeof body.current === "string" ? body.current : "";
  const next = typeof body.next === "string" ? body.next : "";
  if (!(await masterPasswordOk(current, env))) return json({ error: "현재 비밀번호가 맞지 않습니다" }, 400);
  if (next.length < 8) return json({ error: "새 비밀번호는 8자 이상이어야 합니다" }, 400);
  if (next === current) return json({ error: "현재 비밀번호와 다른 비밀번호를 쓰세요" }, 400);
  const salt = randomHex(16);
  const hash = await hashPassword(next, salt);
  await env.DB.prepare(
    "INSERT INTO master_auth (id, pw_salt, pw_hash, changed_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET pw_salt = excluded.pw_salt, pw_hash = excluded.pw_hash, changed_at = excluded.changed_at"
  ).bind(salt, hash, new Date().toISOString()).run();
  return json({ ok: true });
}

async function makeToken(env, payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = await hmacHex(env.SESSION_SECRET, body);
  return `${body}.${sig}`;
}

async function readSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_\\-]+)\\.([0-9a-f]+)`));
  if (!match) return null;
  const [, body, sig] = match;
  if (!(await safeEqual(sig, await hmacHex(env.SESSION_SECRET, body)))) return null;
  let payload;
  try {
    payload = JSON.parse(unb64url(body));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

// ---------- 공업사 등록 ----------

async function createShop(request, env) {
  const body = await readJson(request);
  const name = cleanText(body.name);
  const loginId = cleanText(body.loginId).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!name) return json({ error: "공업사명을 입력하세요" }, 400);
  if (!/^[a-z0-9_]{3,30}$/.test(loginId) || loginId === "master") {
    return json({ error: "아이디는 영문 소문자·숫자·_ 3~30자로 입력하세요 (master 는 사용할 수 없습니다)" }, 400);
  }
  if (password.length < 8) return json({ error: "비밀번호는 8자 이상 입력하세요" }, 400);

  const exists = await env.DB.prepare("SELECT id FROM shops WHERE login_id = ?").bind(loginId).first();
  if (exists) return json({ error: "이미 사용 중인 아이디입니다" }, 409);

  const id = crypto.randomUUID();
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  await env.DB.prepare(
    "INSERT INTO shops (id, name, login_id, pw_salt, pw_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, name, loginId, salt, hash, new Date().toISOString()).run();
  return json({ ok: true, shop: { id, name, loginId } });
}

// ---------- 작업지시서 ----------

async function saveOrder(request, env, session) {
  const body = await readJson(request);
  const vehicle = cleanText(body.vehicle);
  const plate = cleanText(body.plate);
  if (!vehicle) return json({ error: "차량명이 없습니다" }, 400);
  if (!Array.isArray(body.rows) || body.rows.length > MAX_ROWS) {
    return json({ error: "작업 내용이 올바르지 않습니다" }, 400);
  }
  const id = orderId(session.sid, vehicle, plate);
  const now = new Date().toISOString();
  // 생성일(created_at)은 처음 저장할 때만 정해지고, 다시 저장하면 내용과 수정일만 바뀐다
  // revised: 수정 중에 바뀐 내용을 저장했는지. 수정 확인을 누르기 전까지 목록에 갈색 음영으로 남는다.
  const revised = body.revised ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO orders (id, shop_id, vehicle, plate, created_at, updated_at, rows_json, revised) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET rows_json = excluded.rows_json, updated_at = excluded.updated_at,
       revised = MAX(orders.revised, excluded.revised)`
  ).bind(id, session.sid, vehicle, plate, now, now, JSON.stringify(packRows(body)), revised).run();
  return json({ ok: true, id, updatedAt: now });
}

// ---------- 차량명 정의 ----------

const VEHICLE_KEY = "vehicles.json";
const MAX_VEHICLES = 5000;

async function listVehicles(env) {
  const text = await env.IMAGES.get(VEHICLE_KEY);
  // 차량명 목록은 자주 바뀌지 않으므로 2분 동안 이 기기에 남겨 두고 쓴다 (작업지시서 창을 열 때마다 큰 목록을 다시 받지 않도록)
  return json({ vehicles: text ? JSON.parse(text) : [] }, 200, { "Cache-Control": "private, max-age=120" });
}

async function replaceVehicles(request, env) {
  const body = await readJson(request);
  if (!Array.isArray(body.vehicles) || body.vehicles.length === 0 || body.vehicles.length > MAX_VEHICLES) {
    return json({ error: "차량명 자료가 올바르지 않습니다" }, 400);
  }
  const vehicles = [];
  for (const v of body.vehicles) {
    const name = cleanText(String(v && v.name || ""));
    if (!name) continue;
    vehicles.push({
      name,
      group: cleanText(String(v.group || "")),
      category: cleanText(String(v.category || v.group || "")),
      type: cleanText(String(v.type || "")),
      cls: cleanText(String(v.cls || "")),
      maker: cleanText(String(v.maker || "")),
      count: Math.max(0, Math.floor(Number(v.count) || 0)),
    });
  }
  if (vehicles.length === 0) return json({ error: "차량명이 하나도 없습니다" }, 400);
  await env.IMAGES.put(VEHICLE_KEY, JSON.stringify(vehicles));
  return json({ ok: true, count: vehicles.length });
}

// 날짜 한 칸(YYYY-MM-DD)을 한국 시각 기준의 저장 시각으로 바꾼다 (시·분·초는 원래 저장 시각을 그대로 쓴다)
function dayToIso(day, originalIso) {
  const orig = new Date(originalIso || Date.now());
  const kst = new Date(orig.getTime() + 9 * 3600 * 1000).toISOString().slice(11, 19);
  return new Date(`${day}T${kst}+09:00`).toISOString();
}

async function editOrder(request, env, session) {
  const body = await readJson(request);
  const shopId = session.role === "shop" ? session.sid : cleanText(body.shopId);
  const oldVehicle = cleanText(body.vehicle);
  const oldPlate = cleanText(body.plate);
  const oldId = orderId(shopId, oldVehicle, oldPlate);
  const row = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(oldId).first();
  if (!row) return json({ error: "작업지시서를 찾지 못했습니다" }, 404);

  const next = body.next && typeof body.next === "object" ? body.next : {};
  const newVehicle = cleanText(next.vehicle) || oldVehicle;
  const newPlate = cleanText(next.plate);
  if (!newVehicle) return json({ error: "차량명을 입력하세요" }, 400);
  if (!newPlate) return json({ error: "차량번호를 입력하세요" }, 400);
  const dayOk = (v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!dayOk(next.createdAt) || !dayOk(next.inDate) || !dayOk(next.outDate)) {
    return json({ error: "날짜 형식이 올바르지 않습니다" }, 400);
  }

  const parsed = JSON.parse(row.rows_json);
  const isOld = Array.isArray(parsed);
  const data = isOld ? { rows: parsed, extras: [], marks: {}, meta: {}, memoSel: [] } : parsed;
  const pick = (k) => cleanText(String(next[k] ?? ""));
  const meta = {
    ...(data.meta || {}),
    inDate: pick("inDate"), outDate: pick("outDate"), insurer: pick("insurer"),
    coverage: pick("coverage"), paintCode: pick("paintCode"), paintCoats: pick("paintCoats"),
  };
  const newData = { ...data, meta };
  const now = new Date().toISOString();
  const createdAt = next.createdAt ? dayToIso(next.createdAt, row.created_at) : row.created_at;
  const newId = orderId(shopId, newVehicle, newPlate);

  if (newId === oldId) {
    await env.DB.prepare("UPDATE orders SET created_at = ?, updated_at = ?, rows_json = ? WHERE id = ?")
      .bind(createdAt, now, JSON.stringify(newData), oldId).run();
  } else {
    const clash = await env.DB.prepare("SELECT id FROM orders WHERE id = ?").bind(newId).first();
    if (clash) return json({ error: "같은 차량명·차량번호의 작업지시서가 이미 있습니다" }, 409);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO orders (id, shop_id, vehicle, plate, created_at, updated_at, rows_json, revised)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(newId, row.shop_id, newVehicle, newPlate, createdAt, now, JSON.stringify(newData), row.revised),
      env.DB.prepare("DELETE FROM orders WHERE id = ?").bind(oldId),
    ]);
  }
  return json({ ok: true, id: newId });
}

async function deleteOrder(request, env, session) {
  const body = await readJson(request);
  const shopId = session.role === "shop" ? session.sid : cleanText(body.shopId);
  const id = orderId(shopId, cleanText(body.vehicle), cleanText(body.plate));
  await env.DB.prepare("DELETE FROM orders WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// 작업요약 (화면의 작업 요약과 같은 기준): 항목·좌우별 작업, 파트별 개수로 대표 파트를 고른다
// 작업 내용(작업·도장·메모·착안점)이 한 칸이라도 저장되어 있는지
function workFilled(rowsJson) {
  let parsed = null;
  try { parsed = JSON.parse(rowsJson || "null"); } catch (err) { parsed = null; }
  const rows = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.rows) ? parsed.rows : []);
  const sides = ["L", "R", "C"];
  return rows.some((r) => r && (sides.some((k) => r.work && r.work[k]) || sides.some((k) => r.paint && r.paint[k])
    || r.memo || r.tip));
}

function summaryOf(rowsJson) {
  let parsed = null;
  try { parsed = JSON.parse(rowsJson || "null"); } catch (err) { parsed = null; }
  const rows = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.rows) ? parsed.rows : []);
  const summary = [];
  const partCount = new Map();
  for (const r of rows) {
    if (!r || !r.item) continue;
    // 가운데(C) 작업은 centerWork 표시가 없는 옛 저장본에도 잡히도록 값이 있으면 항상 센다
    // (14거2360 처럼 centerWork 가 빠진 저장본은 C 작업이 요약에서 빠져 대표정보가 비었다)
    const sides = r.centerWork ? ["C"] : ["L", "R", "C"];
    for (const side of sides) {
      const w = r.work && r.work[side];
      if (!w) continue;
      const suffix = side === "C" ? "" : side === "L" ? "(좌)" : "(우)";
      summary.push({ t: `${r.item}${suffix}`, w: String(w) });
      const part = String(r.part || "").trim();
      if (part) partCount.set(part, (partCount.get(part) || 0) + 1);
    }
  }
  let repPart = "";
  let best = 0;
  for (const [part, n] of partCount) {
    if (n > best) { best = n; repPart = part; }
  }
  // 대표정보보기 팝업용: 작업요약 종류별 건수, 일반 작업 항목, 기타메모 문장
  const counts = { 교환: 0, 판금: 0, 탈착: 0 };
  for (const s of summary) if (s.w in counts) counts[s.w] += 1;
  const general = Array.isArray(parsed && parsed.extras) ? parsed.extras.map((t) => String(t)).slice(0, 20) : [];
  // 기타메모: 작업지시서 화면과 같은 방식으로 보인다 (앞의 주작업항목 이름은 빼고, (좌)·(우)는 묶는다)
  const itemNames = [...new Set(rows.map((r) => (r && r.item ? String(r.item) : "")).filter(Boolean))];
  const bodyOf = (text) => {
    let item = "";
    for (const n of itemNames) if (text.startsWith(n + " ") && n.length > item.length) item = n;
    return item ? text.slice(item.length + 1) : text;
  };
  const selected = (Array.isArray(parsed && parsed.memoSel) ? parsed.memoSel : []).map((t) => bodyOf(String(t))).filter(Boolean);
  const memos = memoLinesOf(selected);
  for (const r of rows) {
    String(r && r.memo ? r.memo : "").split("\n").forEach((line) => {
      const t = line.trim();
      if (!t) return;
      const body = bodyOf(t);
      const covered = selected.some((c) => body.includes(c) || c.includes(body));
      if (!covered && !memos.includes(t)) memos.push(t);
    });
  }
  // 수정으로 더한 항목 (작업지시서 화면에서 녹색 글씨로 보이는 것과 같은 목록)
  const marks = parsed && parsed.marks && typeof parsed.marks === "object" ? parsed.marks : {};
  const addedGeneral = Array.isArray(marks.__extras) ? marks.__extras.map((t) => String(t)) : [];
  const addedMemos = Array.isArray(marks.__memo) ? marks.__memo.map((t) => String(t)) : [];
  return { repPart, repCount: summary.length, summary, counts, general, memos: memos.slice(0, 50), addedGeneral, addedMemos };
}

// (좌)·(우)가 같은 문장이면 "(좌, 우)"로 묶는다 (작업지시서 화면의 기타메모 표시와 같다)
function memoLinesOf(texts) {
  const SIDE_ORDER = ["좌", "우"];
  const slots = [];
  const groups = new Map();
  for (const text of texts) {
    const m = text.match(/^(.*)\((좌|우)\)(.*)$/);
    if (!m) { slots.push(text); continue; }
    const key = `${m[1]}\u0000${m[3]}`;
    if (!groups.has(key)) {
      const group = { prefix: m[1], suffix: m[3], sides: [] };
      groups.set(key, group);
      slots.push(group);
    }
    groups.get(key).sides.push(m[2]);
  }
  return slots.map((slot) => {
    if (typeof slot === "string") return slot;
    const sides = [...slot.sides].sort((a, b) => SIDE_ORDER.indexOf(a) - SIDE_ORDER.indexOf(b));
    return `${slot.prefix}(${sides.join(", ")})${slot.suffix}`;
  });
}

async function listOrders(env, session, url) {
  const vehicle = url.searchParams.get("vehicle");
  const plate = url.searchParams.get("plate");
  // 공업사는 항상 자기 것만, 마스터는 shop 으로 골라 볼 수 있다
  const shopId = session.role === "shop" ? session.sid : url.searchParams.get("shop");

  const select = `SELECT o.shop_id, o.vehicle, o.plate, o.created_at, o.updated_at, o.rows_json, o.revised, s.name AS shop_name
                  FROM orders o LEFT JOIN shops s ON s.id = o.shop_id`;

  if (vehicle !== null) {
    if (!shopId) return json({ error: "공업사를 지정하세요" }, 400);
    const row = await env.DB.prepare(`${select} WHERE o.id = ?`).bind(orderId(shopId, vehicle, plate || "")).first();
    if (!row) return json({ error: "저장된 작업지시서가 없습니다" }, 404);
    return json({ ...toOrder(row), createdAt: row.created_at });
  }

  // 목록: 요약만 보낸다 (작업 내용 rows_json 은 제외). 검색과 페이지 나누기는 서버에서 한다.
  const size = Math.min(Math.max(Number(url.searchParams.get("size")) || 50, 1), 100);
  const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
  const conds = [];
  const binds = [];
  if (shopId) { conds.push("o.shop_id = ?"); binds.push(shopId); }
  const from = toIsoStart(url.searchParams.get("from"));
  const to = toIsoEnd(url.searchParams.get("to"));
  if (from) { conds.push("o.created_at >= ?"); binds.push(from); }
  if (to) { conds.push("o.created_at <= ?"); binds.push(to); }
  const plateQ = cleanText(url.searchParams.get("plate") || "");
  if (plateQ) { conds.push("o.plate LIKE ?"); binds.push(`%${plateQ}%`); }
  const vehicleQ = cleanText(url.searchParams.get("q_vehicle") || "");
  if (vehicleQ) { conds.push("o.vehicle LIKE ?"); binds.push(`%${vehicleQ}%`); }
  const shopQ = cleanText(url.searchParams.get("q_shop") || "");
  if (shopQ) { conds.push("s.name LIKE ?"); binds.push(`%${shopQ}%`); }
  // 입고일·출고일·보험사·담보·도장코드: 저장된 작업 내용의 meta 값으로 찾는다 (키는 아래 고정 이름만 쓴다)
  const metaDay = (key, from, to) => {
    if (from) { conds.push(`json_extract(o.rows_json, '$.meta.${key}') >= ?`); binds.push(from); }
    if (to) { conds.push(`json_extract(o.rows_json, '$.meta.${key}') <= ?`); binds.push(to); }
  };
  const metaText = (key, value) => {
    if (!value) return;
    conds.push(`json_extract(o.rows_json, '$.meta.${key}') LIKE ?`);
    binds.push(`%${value}%`);
  };
  metaDay("inDate", toDay(url.searchParams.get("in_from")), toDay(url.searchParams.get("in_to")));
  metaDay("outDate", toDay(url.searchParams.get("out_from")), toDay(url.searchParams.get("out_to")));
  metaText("insurer", cleanText(url.searchParams.get("q_insurer") || ""));
  metaText("coverage", cleanText(url.searchParams.get("q_coverage") || ""));
  metaText("paintCode", cleanText(url.searchParams.get("q_paint") || ""));
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  // 정렬: 생성일(기본) · 입고일 · 출고일. 입고·출고일은 빈 값을 맨 뒤로 보낸다. 값은 고정된 목록에서만 고른다.
  const SORT_KEYS = {
    created: "o.created_at",
    inDate: "json_extract(o.rows_json, '$.meta.inDate')",
    outDate: "json_extract(o.rows_json, '$.meta.outDate')",
  };
  const sortField = Object.prototype.hasOwnProperty.call(SORT_KEYS, url.searchParams.get("sort")) ? url.searchParams.get("sort") : "created";
  const sortDir = url.searchParams.get("dir") === "asc" ? "ASC" : "DESC";
  const orderBy = sortField === "created"
    ? `o.created_at ${sortDir}`
    : `(${SORT_KEYS[sortField]} IS NULL OR ${SORT_KEYS[sortField]} = '') ASC, ${SORT_KEYS[sortField]} ${sortDir}, o.created_at DESC`;

  const listSql = `SELECT o.shop_id, o.vehicle, o.plate, o.created_at, o.updated_at, o.revised, s.name AS shop_name,
                          json_extract(o.rows_json, '$.meta.inDate') AS in_date,
                          json_extract(o.rows_json, '$.meta.outDate') AS out_date,
                          json_extract(o.rows_json, '$.meta.insurer') AS insurer,
                          json_extract(o.rows_json, '$.meta.coverage') AS coverage,
                          json_extract(o.rows_json, '$.meta.paintCode') AS paint_code,
                          o.dept AS dept, o.dept_new AS dept_new, o.photo_count AS photo_count, json_extract(o.rows_json, '$.meta.paintCoats') AS paint_coats, o.rows_json AS rows_json
                   FROM orders o LEFT JOIN shops s ON s.id = o.shop_id ${where}
                   ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS n FROM orders o LEFT JOIN shops s ON s.id = o.shop_id ${where}`;
  const [list, count] = await Promise.all([
    env.DB.prepare(listSql).bind(...binds, size, (page - 1) * size).all(),
    env.DB.prepare(countSql).bind(...binds).first(),
  ]);
  return json({
    orders: list.results.map((r) => ({
      shopId: r.shop_id,
      shopName: r.shop_name || "",
      vehicle: r.vehicle,
      plate: r.plate,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      revised: Boolean(r.revised),
      inDate: r.in_date || "",
      outDate: r.out_date || "",
      insurer: r.insurer || "",
      coverage: r.coverage || "",
      paintCode: r.paint_code || "",
      dept: r.dept || "",
      deptNew: r.dept_new || "",
      photoCount: r.photo_count || 0,
      paintCoats: r.paint_coats || "",
      ...summaryOf(r.rows_json),
      hasWork: workFilled(r.rows_json), // 작업 내용이 한 칸이라도 있으면 '보기', 없으면 '작성'
    })),
    total: count ? count.n : 0,
    page,
    size,
  });
}

// 날짜 검색: 입력은 한국 날짜(YYYY-MM-DD). 저장 시각은 UTC 이므로 한국 시각 기준으로 바꿔 비교한다.
function toIsoStart(day) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return new Date(`${day}T00:00:00+09:00`).toISOString();
}

// 날짜 조건(meta 의 YYYY-MM-DD 와 비교): 형식이 맞지 않으면 무시한다
function toDay(day) {
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function toIsoEnd(day) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return new Date(`${day}T23:59:59.999+09:00`).toISOString();
}

function orderId(shopId, vehicle, plate) {
  return `${shopId}|${vehicle}|${plate}`;
}

// 저장 형식: {rows, extras}. 예전에 저장된 배열(rows 만 있던 형식)도 그대로 읽는다.
function packRows(body) {
  // meta: 입고일·출고일·보험사·담보·도장코드 (작은 값만 저장)
  const meta = body.meta && typeof body.meta === "object" ? body.meta : {};
  const pick = (k) => cleanText(String(meta[k] ?? ""));
  const extras = Array.isArray(body.extras)
    ? body.extras.slice(0, 20).map((t) => String(t).slice(0, 80))
    : [];
  // marks: 수정 중 바뀐 칸 (주작업항목 키 → {work, paint, memo}). 수정 확인 전까지 녹색 음영으로 보인다
  const marks = body.marks && typeof body.marks === "object" && !Array.isArray(body.marks) ? body.marks : {};
  const metaOut = {
    inDate: pick("inDate"), outDate: pick("outDate"), insurer: pick("insurer"),
    coverage: pick("coverage"), paintCode: pick("paintCode"), paintCoats: pick("paintCoats"),
  };
  const memoSel = Array.isArray(body.memoSel) ? body.memoSel.slice(0, 50).map((t) => String(t).slice(0, 200)) : [];
  return { rows: body.rows, extras, marks, meta: metaOut, memoSel };
}

function toOrder(row) {
  const parsed = JSON.parse(row.rows_json);
  const isOld = Array.isArray(parsed);
  return {
    shopId: row.shop_id,
    shopName: row.shop_name || "",
    vehicle: row.vehicle,
    plate: row.plate,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rows: isOld ? parsed : parsed.rows,
    extras: isOld ? [] : parsed.extras || [],
    marks: isOld ? {} : parsed.marks || {},
    meta: isOld ? {} : parsed.meta || {},
    memoSel: isOld ? [] : parsed.memoSel || [],
    revised: Boolean(row.revised),
  };
}

// ---------- 공통 도구 ----------

function cleanText(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(text) {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmacHex(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 비밀번호는 PBKDF2-SHA256 으로 저장한다 (평문 저장 없음)
async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(password, saltHex, hashHex) {
  return safeEqual(await hashPassword(password, saltHex), hashHex);
}

// 시간이 같은 길이로 걸리는 비교 (추측 공격 완화)
async function safeEqual(a, b) {
  const x = await hmacHex("compare", String(a));
  const y = await hmacHex("compare", String(b));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// ---------- 매칭 목록 ----------

const MAPPING_FIELDS = ["seq", "group", "part", "item", "no", "text", "workKind", "qty", "partPrice", "labor", "code"];
const MAPPING_COLUMNS = {
  seq: "seq", group: "grp", part: "part", item: "item", no: "no", text: "text",
  workKind: "work_kind", qty: "qty", partPrice: "part_price", labor: "labor", code: "code",
};

async function listMapping(env) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.seq, r.grp, r.part, r.item, r.no, r.text, r.work_kind, r.qty, r.part_price, r.labor, r.code,
            r.sort_no, (i.code IS NOT NULL) AS has_image
     FROM repair_items r LEFT JOIN images i ON i.code = r.code ORDER BY r.id`
  ).all();
  return json({
    rows: results.map((r) => ({
      id: r.id, seq: r.seq, group: r.grp, part: r.part, item: r.item, no: r.no, text: r.text,
      workKind: r.work_kind, qty: r.qty, partPrice: r.part_price, labor: r.labor,
      code: r.code, hasImage: Boolean(r.has_image), sort: r.sort_no ?? r.id,
    })),
    customOrder: await loadCustomOrder(env),
  });
}

// 구분별로 마스터가 보기순서를 저장했는지 ("1": true/false, "2": true/false)
const TIP_ORDER_KEY = "tip_order_custom.json";
async function loadCustomOrder(env) {
  const text = await env.IMAGES.get(TIP_ORDER_KEY);
  return text ? JSON.parse(text) : {};
}

// 보기순서 변경: 한 구분(group)의 착안점 행에 순서 번호(sort_no)를 1부터 매긴다
async function saveMappingOrder(request, env) {
  const body = await readJson(request);
  const group = cleanText(String(body.group || ""));
  const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
  if (!group || ids.length === 0 || ids.length > 5000 || ids.some((id) => !Number.isInteger(id))) {
    return json({ error: "보기순서 자료가 올바르지 않습니다" }, 400);
  }
  // 구분 문자열이 행마다 조금 달라도 되도록, 행 번호(id)로 순서만 바꾼다. group 은 기록용 확인값이다.
  const stmt = env.DB.prepare("UPDATE repair_items SET sort_no = ? WHERE id = ?");
  const statements = ids.map((id, i) => stmt.bind(i + 1, id));
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
  // 이 구분은 마스터가 순서를 정했다고 표시한다 (기본 샘플 순서 대신 이 순서를 쓴다)
  const key = (group.match(/^\s*(\d+)/) || [])[1];
  if (key === "1" || key === "2") {
    const custom = await loadCustomOrder(env);
    custom[key] = true;
    await env.IMAGES.put(TIP_ORDER_KEY, JSON.stringify(custom));
  }
  return json({ ok: true, count: ids.length });
}

async function replaceMapping(request, env) {
  const body = await readJson(request);
  if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 5000) {
    return json({ error: "매핑 행이 올바르지 않습니다" }, 400);
  }
  const stmt = env.DB.prepare(
    `INSERT INTO repair_items (seq, grp, part, item, no, text, work_kind, qty, part_price, labor, code, sort_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const statements = body.rows.map((r, i) =>
    stmt.bind(...MAPPING_FIELDS.map((f) => cleanText(String(r[f] ?? ""))), i + 1));
  // 전체를 새로 채운다: 지우고 넣는다 (한 번에 묶어서 중간 상태가 남지 않게 한다)
  const chunks = [];
  for (let i = 0; i < statements.length; i += 50) chunks.push(statements.slice(i, i + 50));
  await env.DB.batch([env.DB.prepare("DELETE FROM repair_items")]);
  for (const chunk of chunks) await env.DB.batch(chunk);
  // 새로 올린 목록은 보기순서 저장이 없는 상태다 (샘플 순서로 다시 보인다)
  await env.IMAGES.delete(TIP_ORDER_KEY);
  return json({ ok: true, count: body.rows.length });
}

async function patchMapping(request, env, id) {
  if (!Number.isInteger(id)) return json({ error: "행 번호가 올바르지 않습니다" }, 400);
  const body = await readJson(request);
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(MAPPING_COLUMNS)) {
    if (typeof body[key] === "string") {
      sets.push(`${column} = ?`);
      values.push(cleanText(body[key]));
    }
  }
  if (sets.length === 0) return json({ error: "바꿀 값이 없습니다" }, 400);
  await env.DB.prepare(`UPDATE repair_items SET ${sets.join(", ")} WHERE id = ?`).bind(...values, id).run();
  return json({ ok: true });
}

async function addMappingRow(request, env) {
  const body = await readJson(request);
  const values = MAPPING_FIELDS.map((f) => cleanText(String(body[f] ?? "")));
  // 새 행은 같은 구분의 맨 끝 순서에 붙는다
  const res = await env.DB.prepare(
    `INSERT INTO repair_items (seq, grp, part, item, no, text, work_kind, qty, part_price, labor, code, sort_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       (SELECT COALESCE(MAX(sort_no), 0) + 1 FROM repair_items WHERE grp = ?))`
  ).bind(...values, values[1]).run();
  return json({ ok: true, id: res.meta?.last_row_id ?? null });
}

// 공업사 수정: 이름, 아이디, 비밀번호 / 삭제: 계정만 지운다 (저장된 작업지시서는 남는다)
async function changeShop(request, env, id, method) {
  if (method === "DELETE") {
    await env.DB.prepare("DELETE FROM shops WHERE id = ? AND id != 'legacy'").bind(id).run();
    return json({ ok: true });
  }
  const body = await readJson(request);
  const shop = await env.DB.prepare("SELECT id FROM shops WHERE id = ? AND id != 'legacy'").bind(id).first();
  if (!shop) return json({ error: "공업사를 찾을 수 없습니다" }, 404);
  const sets = [];
  const values = [];
  if (typeof body.name === "string" && cleanText(body.name)) {
    sets.push("name = ?");
    values.push(cleanText(body.name));
  }
  if (typeof body.loginId === "string") {
    const loginId = cleanText(body.loginId).toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(loginId) || loginId === "master") {
      return json({ error: "아이디는 영문 소문자·숫자·_ 3~30자로 입력하세요 (master 는 사용할 수 없습니다)" }, 400);
    }
    const dup = await env.DB.prepare("SELECT id FROM shops WHERE login_id = ? AND id != ?").bind(loginId, id).first();
    if (dup) return json({ error: "이미 사용 중인 아이디입니다" }, 409);
    sets.push("login_id = ?");
    values.push(loginId);
  }
  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 8) return json({ error: "비밀번호는 8자 이상 입력하세요" }, 400);
    const salt = randomHex(16);
    sets.push("pw_salt = ?", "pw_hash = ?");
    values.push(salt, await hashPassword(body.password, salt));
  }
  if (sets.length === 0) return json({ error: "바꿀 값이 없습니다" }, 400);
  await env.DB.prepare(`UPDATE shops SET ${sets.join(", ")} WHERE id = ?`).bind(...values, id).run();
  return json({ ok: true });
}
