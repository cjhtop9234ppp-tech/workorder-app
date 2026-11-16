// 날짜 달력 팝업 (작업지시서 입력·목록 검색에서 함께 쓴다). 누른 버튼 바로 아래에 뜬다.
// ---------- 날짜 달력 팝업 (누른 버튼 바로 아래에 뜬다) ----------
let calPop = null;

function closeDateCalendar() {
  if (calPop) calPop.remove();
  calPop = null;
}

function openDateCalendar(anchor, current, onPick) {
  closeDateCalendar();
  const today = new Date();
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(current || ""));
  let year = parsed ? Number(parsed[1]) : today.getFullYear();
  let month = parsed ? Number(parsed[2]) - 1 : today.getMonth();
  const selected = parsed ? `${parsed[1]}-${parsed[2]}-${parsed[3]}` : "";
  // 오늘 날짜 (한국 시각, 작업지시서의 입고일 기준과 같다)
  const todayValue = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const pop = document.createElement("div");
  pop.className = "cal-pop";
  pop.addEventListener("click", (e) => e.stopPropagation());
  document.body.appendChild(pop);
  calPop = pop;

  const render = () => {
    pop.innerHTML = "";
    const head = document.createElement("div");
    head.className = "cal-head";
    const prev = document.createElement("button");
    prev.type = "button"; prev.textContent = "‹";
    prev.addEventListener("click", () => { month -= 1; if (month < 0) { month = 11; year -= 1; } render(); });
    const next = document.createElement("button");
    next.type = "button"; next.textContent = "›";
    next.addEventListener("click", () => { month += 1; if (month > 11) { month = 0; year += 1; } render(); });
    const title = document.createElement("span");
    title.textContent = `${year}년 ${month + 1}월`;
    head.append(prev, title, next);
    pop.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "cal-grid";
    ["일", "월", "화", "수", "목", "금", "토"].forEach((d) => {
      const h = document.createElement("span");
      h.className = "cal-dow"; h.textContent = d;
      grid.appendChild(h);
    });
    const first = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < first; i++) grid.appendChild(document.createElement("span"));
    for (let d = 1; d <= days; d++) {
      const value = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day";
      if (value === selected) btn.classList.add("on");
      if (value === todayValue) btn.classList.add("today"); // 오늘 날짜 음영 (선택한 날짜와 겹치면 선택 표시가 우선)
      btn.textContent = String(d);
      btn.addEventListener("click", () => {
        onPick(value);
        closeDateCalendar();
      });
      grid.appendChild(btn);
    }
    pop.appendChild(grid);

    // 버튼 바로 아래(화면을 넘으면 위쪽)에 놓는다
    const r = anchor.getBoundingClientRect();
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    let top = r.bottom + 6;
    if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };
  render();
}

document.addEventListener("click", closeDateCalendar);
