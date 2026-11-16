// 계정 로그인 (아이디 + 비밀번호). 서버 API 가 401(로그인 필요)을 돌려주면 ensureLogin() 이 입력창을 띄운다.
// 로그인 결과(역할, 공업사명)는 getSession() 으로 확인한다.

async function getSession() {
  // 응답이 멈춰도 기다리지 않도록 8초 뒤에는 '로그인 안 됨'으로 본다
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("api/session", { credentials: "same-origin", signal: controller.signal });
    if (!res.ok) return { ok: false };
    return await res.json();
  } catch (err) {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// 로그인 되어 있으면 true, 아니면 입력창을 띄워 로그인이 끝날 때까지 기다린다
function ensureLogin() {
  return getSession().then((s) => (s.ok ? true : askLogin()));
}

function askLogin() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:100;padding:16px;";

    const box = document.createElement("form");
    box.style.cssText = "background:var(--card,#fff);color:var(--text,#1d2430);border-radius:10px;padding:20px;width:min(320px,100%);font-family:inherit;";

    const title = document.createElement("p");
    title.textContent = "로그인";
    title.style.cssText = "margin:0 0 12px;font-weight:700;font-size:16px;";

    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.placeholder = "아이디";
    idInput.autocomplete = "username";
    idInput.style.cssText = "width:100%;padding:10px;font-size:15px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px;";

    const pwInput = document.createElement("input");
    pwInput.type = "password";
    pwInput.placeholder = "비밀번호";
    pwInput.autocomplete = "current-password";
    pwInput.style.cssText = "width:100%;padding:10px;font-size:15px;border:1px solid #ccc;border-radius:8px;";

    const error = document.createElement("p");
    error.style.cssText = "margin:8px 0 0;color:#b00020;font-size:13px;min-height:1em;";

    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "로그인";
    button.style.cssText = "margin-top:12px;width:100%;padding:10px;font-size:15px;border-radius:8px;";

    box.append(title, idInput, pwInput, error, button);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    idInput.focus();

    box.addEventListener("submit", async (e) => {
      e.preventDefault();
      button.disabled = true;
      error.textContent = "";
      try {
        const res = await fetch("api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ id: idInput.value, password: pwInput.value }),
        });
        if (res.ok) {
          overlay.remove();
          resolve(true);
          return;
        }
        const body = await res.json().catch(() => ({}));
        error.textContent = body.error || "로그인하지 못했습니다";
      } catch (err) {
        error.textContent = "서버에 연결하지 못했습니다";
      }
      button.disabled = false;
      pwInput.select();
    });
  });
}

async function logout() {
  await fetch("api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  location.reload();
}
