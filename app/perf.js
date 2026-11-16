// 속도 진단용 (평소에는 아무것도 하지 않는다).
// 주소 끝에 ?perf=1 을 한 번 붙여 열면 이 기기(브라우저)에서 켜지고, 같은 탭 안에서는 계속 켜진 상태로 남는다.
// 화면 왼쪽 아래에 페이지 로딩, 탭(페이지) 이동, 50ms 이상 걸린 파일(그림·자료) 시간을 적어 준다.
(function () {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get("perf") === "1") sessionStorage.setItem("perf", "1");
    if (q.get("perf") === "0") sessionStorage.removeItem("perf");
    if (sessionStorage.getItem("perf") !== "1") return;
  } catch (err) {
    return;
  }

  const lines = [];
  let box = null;
  const log = (text) => {
    lines.push(`${new Date().toLocaleTimeString("ko-KR")} ${text}`);
    if (!box) {
      box = document.createElement("div");
      box.style.cssText = "position:fixed;left:4px;bottom:4px;z-index:9999;max-width:94vw;max-height:38vh;overflow:auto;background:rgba(0,0,0,.82);color:#fff;font:11px/1.4 monospace;padding:6px 8px;border-radius:6px;white-space:pre-wrap;pointer-events:auto";
      const off = document.createElement("button");
      off.textContent = "끄기";
      off.style.cssText = "display:block;margin-bottom:4px;font-size:11px";
      off.onclick = () => { sessionStorage.removeItem("perf"); box.remove(); box = null; };
      box.appendChild(off);
      const body = document.createElement("span");
      box.appendChild(body);
      box.bodyEl = body;
      document.body.appendChild(box);
    }
    box.bodyEl.textContent = lines.slice(-40).join("\n");
  };

  // 탭(페이지) 이동 시간: 링크를 누른 시각을 기억해 두었다가, 다음 페이지가 뜨면 차이를 적는다
  document.addEventListener("click", (e) => {
    const a = e.target && e.target.closest && e.target.closest("a[href]");
    if (a) sessionStorage.setItem("perfClickAt", String(Date.now()));
  }, true);

  const start = () => {
    const nav = performance.getEntriesByType("navigation")[0];
    const clicked = Number(sessionStorage.getItem("perfClickAt") || 0);
    sessionStorage.removeItem("perfClickAt");
    const page = location.pathname.split("/").pop() || "index.html";
    if (nav) log(`[${page}] 화면 준비 ${Math.round(nav.domContentLoadedEventEnd)}ms · 전체 로딩 ${Math.round(nav.loadEventEnd)}ms`);
    if (clicked && Date.now() - clicked < 60000) log(`[${page}] 탭 이동(누른 뒤 화면 뜰 때까지) ${Date.now() - clicked}ms`);
  };
  if (document.readyState === "complete") setTimeout(start, 0);
  else window.addEventListener("load", () => setTimeout(start, 0));

  // 50ms 이상 걸린 파일 (자료 data.js, 그림 api/img 등)
  if ("PerformanceObserver" in window) {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration < 50) continue;
        const name = decodeURIComponent(e.name.replace(location.origin + "/", "")).split("?")[0].slice(0, 50);
        const size = e.transferSize ? `${Math.round(e.transferSize / 1024)}KB` : "캐시";
        log(`${Math.round(e.duration)}ms ${e.initiatorType} ${name} (${size})`);
      }
    }).observe({ type: "resource", buffered: true });
  }
})();
