'use strict';

/* =========================================================
   Data model (stored in localStorage under KEY)
   {
     version: 1,
     months: { "2026-11": { goals: [Goal] } },
     days:   { "2026-11-11": { note: "", hits: {goalId: true}, values: {goalId: number} } }
   }
   Goal = { id, name, type: "check" | "number", dir?: "atMost" | "atLeast", target?: number, unit?: string }
   Goals keep their id when copied to a new month, so trends can be compared across months.
   ========================================================= */

const KEY = 'daily-goals-v1'; // storage key: keep as-is so existing data survives the rename
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STARTER_GOALS = [
  { name: 'Screen time', type: 'number', dir: 'atMost', target: 4, unit: 'h' },
  { name: 'Exercise', type: 'check' },
  { name: 'Read Book of Mormon', type: 'check' },
  { name: 'Pray morning / evening', type: 'check' },
  { name: 'Conference talk', type: 'check' },
  { name: 'Meditation', type: 'check' },
  { name: '8 hours sleep', type: 'check' },
  { name: 'Up before 9', type: 'check' },
  { name: 'Clean something', type: 'check' },
  { name: 'No Monster', type: 'check' },
  { name: 'Talk to a stranger', type: 'check' },
];

/* ---------- utils ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ymOf = (date) => date.slice(0, 7);
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); };
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const pct = (x) => `${Math.round(x * 100)}%`;
const round1 = (x) => Math.round(x * 10) / 10;

/* ---------- state ---------- */
let state = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.months && s.days) return s;
  } catch (e) { /* fall through */ }
  const ym = ymOf(todayStr());
  return { version: 1, months: { [ym]: { goals: STARTER_GOALS.map((g) => ({ id: uid(), ...g })) } }, days: {} };
}

let saveTimer;
function save(immediate) {
  clearTimeout(saveTimer);
  const write = () => {
    localStorage.setItem(KEY, JSON.stringify(state));
    const el = document.querySelector('.saved');
    if (el) el.textContent = 'Saved';
    if (window.onTallySaved) window.onTallySaved(); // cloud sync (sync.js)
  };
  if (immediate) write(); else saveTimer = setTimeout(write, 300);
}

/** Goals for a month; creates the month by copying the most recent earlier month's goals. */
function monthGoals(ym, create = true) {
  if (state.months[ym]) return state.months[ym].goals;
  const earlier = Object.keys(state.months).filter((k) => k < ym).sort();
  const later = Object.keys(state.months).filter((k) => k > ym).sort();
  const src = earlier.length ? earlier[earlier.length - 1] : later[0];
  const goals = src ? state.months[src].goals.map((g) => ({ ...g })) : STARTER_GOALS.map((g) => ({ id: uid(), ...g }));
  if (create) { state.months[ym] = { goals }; save(); }
  return goals;
}

function dayEntry(date) {
  return state.days[date] || { note: '', hits: {}, values: {} };
}

function isHit(goal, entry) {
  if (goal.type === 'number') {
    const v = entry.values?.[goal.id];
    if (v === undefined || v === null || v === '' || Number.isNaN(Number(v))) return false;
    return goal.dir === 'atLeast' ? Number(v) >= goal.target : Number(v) <= goal.target;
  }
  return !!entry.hits?.[goal.id];
}

function isLogged(entry) {
  if (!entry) return false;
  return !!(entry.note && entry.note.trim()) ||
    Object.values(entry.hits || {}).some(Boolean) ||
    Object.values(entry.values || {}).some((v) => v !== '' && v !== null && v !== undefined);
}

function score(date) {
  const entry = state.days[date];
  if (!entry) return 0;
  return monthGoals(ymOf(date), false).filter((g) => isHit(g, entry)).length;
}

function targetText(g) {
  if (g.type !== 'number') return '';
  return `${g.dir === 'atLeast' ? '≥' : '≤'} ${g.target}${g.unit ? ' ' + g.unit : ''}`;
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------- routing ---------- */
function route() {
  const [tab = 'today', arg, arg2] = location.hash.replace(/^#\/?/, '').split('/');
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const view = document.getElementById('view');
  const today = todayStr();
  if (tab === 'month') renderMonth(view, arg || ymOf(today));
  else if (tab === 'insights') renderInsights(view, arg || ymOf(today));
  else if (tab === 'goals') renderGoals(view, arg || ymOf(today));
  else if (tab === 'review') { document.querySelector('.tabs [data-tab="insights"]').classList.add('active'); renderReview(view, arg || addMonths(ymOf(today), -1), +arg2 || 1); }
  else if (tab === 'import') { document.querySelector('.tabs [data-tab="goals"]').classList.add('active'); renderImport(view); }
  else renderToday(view, arg && arg <= today ? arg : today);
  window.scrollTo(0, 0);
}
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  // Keep the month you're looking at when switching tabs
  const [, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const ym = arg ? arg.slice(0, 7) : ymOf(todayStr());
  const t = b.dataset.tab;
  if (t === 'today') go('#today');
  else go(`#${t}/${ym}`);
}));
window.addEventListener('hashchange', route);

/* =========================================================
   TODAY
   ========================================================= */
function renderToday(view, date) {
  const today = todayStr();
  const ym = ymOf(date);
  const goals = monthGoals(ym);
  const entry = dayEntry(date);
  const d = parseDate(date);
  const label = date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : WEEKDAYS[d.getDay()];

  view.innerHTML = `
    <div class="row date-head">
      <button class="icon-btn" id="prev" aria-label="Previous day">‹</button>
      <div class="title">
        <h1>${label}</h1>
        <p class="sub">${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}</p>
      </div>
      <button class="icon-btn" id="next" aria-label="Next day" ${date >= today ? 'disabled' : ''}>›</button>
    </div>

    ${date === today ? todayBanners(today) : ''}

    <div class="score" aria-live="polite"><span class="n" id="score">0</span><span class="of">/ ${goals.length}</span></div>
    <div class="pips" id="pips">${goals.map(() => '<span class="pip"></span>').join('')}</div>
    <div class="streak-pill-wrap"><span class="streak-pill" id="logStreak" hidden></span></div>

    <label class="sr-only" for="note">One sentence for the day</label>
    <textarea class="note" id="note" maxlength="240" placeholder="One sentence for the day…">${esc(entry.note)}</textarea>

    <h2>Goals</h2>
    ${goals.length ? '' : `<div class="empty">No goals this month yet. <a href="#goals/${ym}">Add some</a>.</div>`}
    <div class="goal-list">
      ${goals.map((g) => g.type === 'number' ? `
        <label class="goal" data-id="${g.id}">
          <span class="box"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg></span>
          <span class="name">${esc(g.name)}<br><span class="meta">Goal ${esc(targetText(g))}<span class="gstreak"></span></span></span>
          <input class="num" type="number" inputmode="decimal" step="any" placeholder="${esc(g.unit || '—')}"
                 value="${esc(entry.values?.[g.id] ?? '')}" aria-label="${esc(g.name)} value">
        </label>` : `
        <button class="goal" data-id="${g.id}" aria-pressed="false">
          <span class="box"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg></span>
          <span class="name">${esc(g.name)}<span class="meta gstreak-line"><span class="gstreak"></span></span></span>
        </button>`).join('')}
    </div>
    <div class="saved"></div>
  `;

  const e = state.days[date] || (state.days[date] = { note: '', hits: {}, values: {} });
  e.hits = e.hits || {}; e.values = e.values || {};

  let last = -1;
  const refresh = () => {
    let n = 0;
    view.querySelectorAll('.goal').forEach((el) => {
      const g = goals.find((x) => x.id === el.dataset.id);
      const on = isHit(g, e);
      if (on) n++;
      el.classList.toggle('on', on);
      if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', on);
      // Per-goal streak (counts today once it's hit; otherwise shows the streak you can extend)
      const st = goalStreak(g.id, date);
      el.querySelector('.gstreak').textContent = st >= 2 ? `${g.type === 'number' ? ' · ' : ''}${st}-day streak${on ? '' : ', keep it going'}` : '';
      el.querySelector('.gstreak-line')?.classList.toggle('show', st >= 2);
    });
    updateLogStreak();
    const s = document.getElementById('score');
    s.textContent = n;
    if (last !== -1 && n !== last) { s.classList.add('bump'); setTimeout(() => s.classList.remove('bump'), 180); }
    if (last !== -1 && n > last && n === goals.length && goals.length) toast('Perfect day: every goal hit');
    last = n;
    view.querySelectorAll('.pip').forEach((p, i) => p.classList.toggle('on', i < n));
  };
  const updateLogStreak = () => {
    const pill = document.getElementById('logStreak');
    if (!pill) return;
    const n = logStreak(date);
    pill.hidden = n < 2;
    pill.textContent = `${n} ${date === today ? 'nights' : 'days'} logged in a row`;
  };
  refresh();

  view.querySelectorAll('button.goal').forEach((el) => el.addEventListener('click', () => {
    e.hits[el.dataset.id] = !e.hits[el.dataset.id];
    if (navigator.vibrate) navigator.vibrate(8);
    refresh(); save();
  }));
  view.querySelectorAll('label.goal input.num').forEach((inp) => inp.addEventListener('input', () => {
    const id = inp.closest('.goal').dataset.id;
    if (inp.value === '') delete e.values[id]; else e.values[id] = Number(inp.value);
    refresh(); save();
  }));
  document.getElementById('note').addEventListener('input', (ev) => { e.note = ev.target.value; save(); updateLogStreak(); });
  view.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => { if (el.dataset.slide) slideFrom = el.dataset.slide; go(el.dataset.go); }));
  document.getElementById('prev').addEventListener('click', () => { slideFrom = 'left'; go(`#today/${addDays(date, -1)}`); });
  document.getElementById('next').addEventListener('click', () => { slideFrom = 'right'; go(addDays(date, 1) >= today ? '#today' : `#today/${addDays(date, 1)}`); });

  // Slide the new day in from the side it came from (set by the arrows or a swipe)
  if (slideFrom) {
    view.classList.remove('slide-from-left', 'slide-from-right');
    void view.offsetWidth; // restart the animation
    view.classList.add(`slide-from-${slideFrom}`);
    slideFrom = null;
  }
}

/* ---------- swipe between days on the Today tab ----------
   Swipe right = previous day, swipe left = next day. Reuses the arrow buttons,
   so it behaves exactly like tapping them (including stopping at today). */
let slideFrom = null;
(function enableDaySwipe() {
  const view = document.getElementById('view');
  const onToday = () => !!document.getElementById('note'); // only the Today screen has the note field
  let startX = 0, startY = 0, dx = 0, tracking = false, horizontal = null;

  view.addEventListener('touchstart', (e) => {
    if (!onToday() || e.touches.length !== 1) return;
    // Leave text editing alone so selecting/moving the cursor never changes the day
    if (e.target.closest('textarea, input, select')) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    dx = 0; tracking = true; horizontal = null;
  }, { passive: true });

  view.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const mx = e.touches[0].clientX - startX, my = e.touches[0].clientY - startY;
    if (horizontal === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) horizontal = Math.abs(mx) > Math.abs(my) * 1.2;
    if (!horizontal) return;
    dx = mx;
    const atToday = document.getElementById('next')?.disabled;
    const resist = dx < 0 && atToday ? 0.15 : 0.45; // rubber-band when there's no next day
    view.style.transition = 'none';
    view.style.transform = `translateX(${dx * resist}px)`;
    view.style.opacity = String(1 - Math.min(Math.abs(dx) / 900, 0.25));
  }, { passive: true });

  const end = () => {
    if (!tracking) return;
    tracking = false;
    view.style.transition = 'transform .2s ease, opacity .2s ease';
    view.style.transform = ''; view.style.opacity = '';
    if (!horizontal || Math.abs(dx) < 60) return;
    const btn = document.getElementById(dx > 0 ? 'prev' : 'next');
    if (btn && !btn.disabled) { btn.click(); if (navigator.vibrate) navigator.vibrate(6); }
  };
  view.addEventListener('touchend', end);
  view.addEventListener('touchcancel', end);
})();

/* =========================================================
   MONTH
   ========================================================= */
function monthDays(ym) {
  const n = daysInMonth(ym);
  const today = todayStr();
  const out = [];
  for (let i = 1; i <= n; i++) {
    const date = `${ym}-${pad(i)}`;
    if (date > today) break;
    const entry = state.days[date];
    out.push({ day: i, date, entry, logged: isLogged(entry), score: entry ? score(date) : 0 });
  }
  return out;
}

function monthNav(ym, tab) {
  const next = addMonths(ym, 1);
  const canNext = next <= ymOf(todayStr());
  return `
    <div class="row date-head">
      <button class="icon-btn" onclick="location.hash='#${tab}/${addMonths(ym, -1)}'" aria-label="Previous month">‹</button>
      <div class="title"><h1>${monthLabel(ym)}</h1></div>
      <button class="icon-btn" ${canNext ? `onclick="location.hash='#${tab}/${next}'"` : 'disabled'} aria-label="Next month">›</button>
    </div>`;
}

function renderMonth(view, ym) {
  const goals = monthGoals(ym, false);
  const days = monthDays(ym);
  const logged = days.filter((d) => d.logged);
  const today = todayStr();

  view.innerHTML = `
    ${monthNav(ym, 'month')}
    <div class="row spread chart-head">
      <h2 id="chartTitle">Goals hit per day</h2>
      <div class="seg" role="tablist" aria-label="Chart type">
        ${['line', 'calendar', 'year'].map((v) => `<button role="tab" data-view="${v}" aria-selected="${chartView() === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}
      </div>
    </div>
    <div class="card chart-wrap" id="chart"></div>

    <h2>Memorable moments</h2>
    ${logged.some((d) => d.entry.note) ? '' : '<div class="empty">Nothing written yet this month.</div>'}
    <ol class="moments">
      ${logged.filter((d) => d.entry.note).map((d) => `
        <li data-date="${d.date}"><span class="d">${d.day}</span><span class="t">${esc(d.entry.note)}</span><span class="c">${d.score}/${goals.length}</span></li>`).join('')}
    </ol>

    <h2>Tracker</h2>
    <div class="card grid-table">
      <table class="tracker">
        <thead><tr><th></th>${goals.map((g) => `<th class="gname" title="${esc(g.name)}">${esc(g.name)}</th>`).join('')}<th class="gname">Total</th></tr></thead>
        <tbody>
          ${days.map((d) => `
            <tr data-date="${d.date}" class="${d.date === today ? 'today' : ''}">
              <td class="d">${d.day}</td>
              ${goals.map((g) => {
                if (!d.entry) return '<td></td>';
                if (g.type === 'number') {
                  const v = d.entry.values?.[g.id];
                  return `<td class="v ${isHit(g, d.entry) ? 'hit' : ''}">${v ?? ''}</td>`;
                }
                return `<td class="x">${isHit(g, d.entry) ? '✓' : ''}</td>`;
              }).join('')}
              <td class="tot">${d.logged ? d.score : ''}</td>
            </tr>`).join('')}
          <tr class="totals">
            <td class="d">Σ</td>
            ${goals.map((g) => `<td>${logged.filter((d) => isHit(g, d.entry)).length}</td>`).join('')}
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="help">Number goals show the value you entered; bold means it hit the target. Tap any day to edit it.</p>
  `;

  const drawChart = () => {
    const v = chartView(), host = document.getElementById('chart');
    view.querySelectorAll('.seg button').forEach((btn) => btn.setAttribute('aria-selected', btn.dataset.view === v));
    document.getElementById('chartTitle').textContent = v === 'year' ? `${ym.slice(0, 4)} at a glance` : 'Goals hit per day';
    if (v === 'calendar') drawCalendar(host, ym, days);
    else if (v === 'year') drawYear(host, ym.slice(0, 4));
    else drawLineChart(host, ym, days, goals.length);
  };
  view.querySelectorAll('.seg button').forEach((btn) => btn.addEventListener('click', () => {
    localStorage.setItem(CHART_KEY, btn.dataset.view); drawChart();
  }));
  drawChart();
  view.querySelectorAll('tr[data-date], li[data-date]').forEach((el) => el.addEventListener('click', () => go(`#today/${el.dataset.date}`)));
}

/* ---------- chart helpers ---------- */
const CHART_KEY = 'tally-chart-view'; // remembers Line / Calendar / Year (display preference only)
const chartView = () => (['line', 'calendar', 'year'].includes(localStorage.getItem(CHART_KEY)) ? localStorage.getItem(CHART_KEY) : 'line');

/** Share of that month's goals hit on a date (0–1), or null if the day wasn't logged. */
function dayFraction(date) {
  const e = state.days[date];
  if (!isLogged(e)) return null;
  const total = monthGoals(ymOf(date), false).length;
  return total ? score(date) / total : 0;
}

/** Heat level 0–4 used by the calendar and year views (same scale in both). */
const heatLevel = (frac) => (frac <= 0 ? 0 : Math.min(4, Math.ceil(frac * 4)));
const heatLegend = () => `
  <div class="heat-legend" aria-hidden="true">
    <span>Fewer</span>${[0, 1, 2, 3, 4].map((l) => `<i class="heat-${l}"></i>`).join('')}<span>More</span>
    <i class="heat-none" style="margin-left:10px"></i><span>Not logged</span>
  </div>`;

/** Trailing 7-day average of goals hit (logged days only; needs 3+ logged days in the window). */
function rollingAvg(date) {
  const vals = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(date, -i);
    if (isLogged(state.days[d])) vals.push(score(d));
  }
  return vals.length >= 3 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function drawCalendar(host, ym, days) {
  const first = parseDate(`${ym}-01`).getDay();
  const today = todayStr();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<div class="cal-cell blank"></div>');
  for (let n = 1; n <= daysInMonth(ym); n++) {
    const date = `${ym}-${pad(n)}`;
    if (date > today) { cells.push(`<div class="cal-cell future"><span class="cd">${n}</span></div>`); continue; }
    const frac = dayFraction(date);
    const s = frac === null ? null : score(date);
    const lvl = frac === null ? 'none' : heatLevel(frac);
    const note = state.days[date]?.note || '';
    cells.push(`<button class="cal-cell heat-${lvl} ${date === today ? 'is-today' : ''}" data-date="${date}"
      aria-label="${MONTHS[+ym.slice(5) - 1]} ${n}: ${s === null ? 'not logged' : s + ' goals hit'}${note ? '. ' + esc(note) : ''}" title="${esc(note)}">
      <span class="cd">${n}</span>${s === null ? '' : `<span class="cs">${s}</span>`}</button>`);
  }
  host.innerHTML = `
    <div class="cal">
      ${WEEKDAYS.map((w) => `<div class="cal-wd">${w[0]}</div>`).join('')}
      ${cells.join('')}
    </div>
    ${heatLegend()}
    <p class="help" style="margin:6px 0 0">Shade = share of that month's goals hit. Tap a day to open it.</p>`;
  host.querySelectorAll('button[data-date]').forEach((el) => el.addEventListener('click', () => go(`#today/${el.dataset.date}`)));
}

function drawYear(host, year) {
  const today = todayStr();
  const CELL = 10, GAP = 2, L = 30, T = 16;
  const W = L + 31 * (CELL + GAP), H = T + 12 * (CELL + GAP);
  let rects = '', logged = 0, sum = 0, n = 0;
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${pad(m)}`;
    for (let d = 1; d <= daysInMonth(ym); d++) {
      const date = `${ym}-${pad(d)}`;
      if (date > today) continue;
      const frac = dayFraction(date);
      if (frac !== null) { logged++; sum += frac; n++; }
      const lvl = frac === null ? 'none' : heatLevel(frac);
      rects += `<rect class="heat-${lvl}" data-date="${date}" x="${L + (d - 1) * (CELL + GAP)}" y="${T + (m - 1) * (CELL + GAP)}" width="${CELL}" height="${CELL}" rx="2"/>`;
    }
  }
  host.innerHTML = `
    <div class="chart year">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Every day of ${year}, shaded by goals hit">
        <g class="axis">
          ${MONTHS.map((mn, i) => `<text x="${L - 6}" y="${T + i * (CELL + GAP) + CELL - 1.5}" text-anchor="end">${mn.slice(0, 3)}</text>`).join('')}
          ${[1, 10, 20, 31].map((d) => `<text x="${L + (d - 1) * (CELL + GAP) + CELL / 2}" y="${T - 5}" text-anchor="middle">${d}</text>`).join('')}
        </g>
        ${rects}
      </svg>
    </div>
    ${heatLegend()}
    <p class="help" style="margin:6px 0 0">${logged ? `${logged} day${logged > 1 ? 's' : ''} logged in ${year} · ${Math.round((sum / n) * 100)}% of goals hit on average.` : `No days logged in ${year} yet.`} Tap a square for details.</p>`;

  const svg = host.querySelector('svg');
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.style.display = 'none';
  host.querySelector('.chart').appendChild(tip);
  let selected = null;
  const show = (rect) => {
    const date = rect.dataset.date, d = parseDate(date);
    const frac = dayFraction(date);
    const note = state.days[date]?.note || '';
    if (selected) selected.classList.remove('sel');
    selected = rect; rect.classList.add('sel');
    tip.innerHTML = `<b>${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()} · ${frac === null ? 'not logged' : `${score(date)} / ${monthGoals(ymOf(date), false).length}`}</b>${note ? `<br>${esc(note.length > 70 ? note.slice(0, 70) + '…' : note)}` : ''}`;
    const r = svg.getBoundingClientRect(), rr = rect.getBoundingClientRect();
    tip.style.display = '';
    tip.style.left = `${Math.min(Math.max(rr.left - r.left + rr.width / 2, 110), r.width - 110)}px`;
    tip.style.top = `${rr.top - r.top}px`;
  };
  svg.addEventListener('pointerdown', (e) => { if (e.target.dataset.date) show(e.target); });
  svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && e.target.dataset.date) show(e.target); });
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { tip.style.display = 'none'; selected?.classList.remove('sel'); } });
}

function drawLineChart(host, ym, days, maxY) {
  const n = daysInMonth(ym);
  const W = 520, H = 220, L = 26, R = 10, T = 12, B = 24;
  const ymax = Math.max(maxY, 1);
  const x = (day) => L + ((day - 1) / Math.max(n - 1, 1)) * (W - L - R);
  const y = (v) => T + (1 - v / ymax) * (H - T - B);
  const logged = days.filter((d) => d.logged);

  // Path with gaps where days weren't logged
  let path = '', prevDay = -10;
  logged.forEach((d) => {
    path += `${d.day === prevDay + 1 ? 'L' : 'M'}${x(d.day).toFixed(1)},${y(d.score).toFixed(1)} `;
    prevDay = d.day;
  });

  // 7-day rolling average (uses the previous month's days too, so day 1 isn't empty)
  const avgPts = days.map((d) => ({ day: d.day, v: rollingAvg(d.date) })).filter((p) => p.v !== null);
  let avgPath = '', prevAvg = -10;
  avgPts.forEach((p) => {
    avgPath += `${p.day === prevAvg + 1 ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.v).toFixed(1)} `;
    prevAvg = p.day;
  });
  const avgByDay = Object.fromEntries(avgPts.map((p) => [p.day, p.v]));

  const yTicks = [];
  const step = ymax > 8 ? 2 : 1;
  for (let v = 0; v <= ymax; v += step) yTicks.push(v);
  const xTicks = [1, 5, 10, 15, 20, 25, n].filter((v, i, a) => v <= n && a.indexOf(v) === i && !(v === 25 && n - 25 < 3));

  host.innerHTML = `
    <div class="chart">
      <div class="legend" aria-hidden="true">
        <span><i class="sw daily"></i>Daily</span>
        <span><i class="sw avg"></i>7-day average</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Goals hit each day in ${monthLabel(ym)}, with a 7-day average">
        <g class="grid">${yTicks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>
        <g class="axis">
          ${yTicks.map((v) => `<text x="${L - 8}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join('')}
          ${xTicks.map((v) => `<text x="${x(v)}" y="${H - 6}" text-anchor="middle">${v}</text>`).join('')}
        </g>
        <line class="cross" id="cross" y1="${T}" y2="${H - B}" style="display:none"/>
        <path class="series daily" d="${path}"/>
        ${logged.map((d) => `<circle class="pt" data-day="${d.day}" cx="${x(d.day)}" cy="${y(d.score)}" r="3.5"/>`).join('')}
        <path class="series avg" d="${avgPath}"/>
        <rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent" id="hit"/>
      </svg>
      ${logged.length ? '' : '<div class="empty" style="position:absolute;inset:0;display:grid;place-items:center">No days logged yet</div>'}
    </div>`;

  const svg = host.querySelector('svg');
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.style.display = 'none';
  host.appendChild(tip);
  const cross = host.querySelector('#cross');

  const show = (clientX) => {
    if (!logged.length) return;
    const r = svg.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    let best = logged[0];
    logged.forEach((d) => { if (Math.abs(x(d.day) - sx) < Math.abs(x(best.day) - sx)) best = d; });
    const px = (x(best.day) / W) * r.width, py = (y(best.score) / H) * r.height;
    cross.setAttribute('x1', x(best.day)); cross.setAttribute('x2', x(best.day)); cross.style.display = '';
    host.querySelectorAll('.pt').forEach((p) => p.classList.toggle('sel', +p.dataset.day === best.day));
    const note = best.entry.note ? `<br>${esc(best.entry.note.length > 70 ? best.entry.note.slice(0, 70) + '…' : best.entry.note)}` : '';
    const av = avgByDay[best.day];
    tip.innerHTML = `<b>${MONTHS[+ym.slice(5) - 1].slice(0, 3)} ${best.day} · ${best.score} / ${maxY}</b>${av !== undefined ? ` <span style="opacity:.8">· 7-day avg ${round1(av)}</span>` : ''}${note}`;
    tip.style.display = '';
    const pad = 14;
    tip.style.left = `${Math.min(Math.max(px + pad, 110), r.width - 110 + pad)}px`;
    tip.style.top = `${py + pad}px`;
  };
  const hide = () => { tip.style.display = 'none'; cross.style.display = 'none'; host.querySelectorAll('.pt.sel').forEach((p) => p.classList.remove('sel')); };
  svg.addEventListener('pointermove', (ev) => show(ev.clientX));
  svg.addEventListener('pointerdown', (ev) => show(ev.clientX));
  svg.addEventListener('pointerleave', hide);
}


/* =========================================================
   STREAKS, TRENDS, BANNERS
   ========================================================= */
const goalDefOn = (date, goalId) => (state.months[ymOf(date)]?.goals || []).find((g) => g.id === goalId);
const hitOn = (date, goalId) => { const g = goalDefOn(date, goalId), e = state.days[date]; return !!(g && e && isHit(g, e)); };

/** Consecutive days hitting a goal ending on `date` (or the day before, if `date` isn't hit yet). Spans months. */
function goalStreak(goalId, date) {
  let d = hitOn(date, goalId) ? date : addDays(date, -1), n = 0;
  while (n < 3660 && hitOn(d, goalId)) { n++; d = addDays(d, -1); }
  return n;
}

/** Consecutive logged days ending on `date` (or the day before, if `date` isn't logged yet). */
function logStreak(date) {
  let d = isLogged(state.days[date]) ? date : addDays(date, -1), n = 0;
  while (n < 3660 && isLogged(state.days[d])) { n++; d = addDays(d, -1); }
  return n;
}

/** Longest run of logged days inside a month. */
function bestLogStreakIn(ym) {
  let best = 0, cur = 0;
  monthDays(ym).forEach((d) => { cur = d.logged ? cur + 1 : 0; best = Math.max(best, cur); });
  return best;
}

/** One goal's hit rate in one month (matched by goal id), or null if it wasn't tracked / nothing logged. */
function goalMonthRate(ym, goalId) {
  const g = (state.months[ym]?.goals || []).find((x) => x.id === goalId);
  if (!g) return null;
  const logged = monthDays(ym).filter((d) => d.logged);
  if (!logged.length) return null;
  const hits = logged.filter((d) => isHit(g, d.entry)).length;
  return { rate: hits / logged.length, hits, n: logged.length };
}

/** Trend rows for the goals of `ym`: hit rate over the last `span` months. */
function goalTrends(ym, span = 6) {
  const months = Array.from({ length: span }, (_, i) => addMonths(ym, i - span + 1));
  return monthGoals(ym, false).map((g) => {
    const pts = months.map((m) => ({ ym: m, r: goalMonthRate(m, g.id) }));
    const cur = pts[pts.length - 1].r, prev = [...pts.slice(0, -1)].reverse().find((p) => p.r);
    return { g, pts, cur, delta: cur && prev ? cur.rate - prev.r.rate : null, months: pts.filter((p) => p.r).length };
  });
}

function trendsHTML(ym) {
  const rows = goalTrends(ym).filter((t) => t.cur);
  if (!rows.some((t) => t.months >= 2)) {
    return '<p class="help">Trends appear once a goal has been tracked for two or more months. Import past months from the Goals tab to fill this in.</p>';
  }
  return `<div class="card trends">
    ${rows.map((t) => `
      <div class="trend-row">
        <div class="trend-name">${esc(t.g.name)}</div>
        <div class="trend-bars" aria-label="${esc(t.g.name)} hit rate by month">
          ${t.pts.map((p) => `<div class="tb" title="${monthLabel(p.ym)}: ${p.r ? pct(p.r.rate) : 'not tracked'}">
            <div class="tb-fill ${p.ym === ym ? 'cur' : ''}" style="height:${p.r ? Math.max(4, p.r.rate * 100) : 0}%"></div>
            <span>${MONTHS[+p.ym.slice(5) - 1][0]}</span></div>`).join('')}
        </div>
        <div class="trend-val"><b>${pct(t.cur.rate)}</b>${t.delta === null ? '<span class="d">new</span>' : `<span class="d ${t.delta >= 0.05 ? 'up' : t.delta <= -0.05 ? 'down' : ''}">${t.delta >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(t.delta * 100))}</span>`}</div>
      </div>`).join('')}
  </div>
  <p class="help" style="margin-top:6px">Hit rate per month (share of logged days). ▲▼ = change in points vs the previous month tracked.</p>`;
}

/** Banners at the top of Today: missed days + monthly review prompt. */
function todayBanners(today) {
  const out = [];
  const ym = ymOf(today), prev = addMonths(ym, -1), dayN = +today.slice(8);
  if (state.months[prev] && !state.months[prev].reviewedAt && loggedDaysIn(prev) && dayN <= 14) {
    out.push(`<button class="banner review" data-go="#review/${prev}">${MONTHS[+prev.slice(5) - 1]} is done. <b>Review your month and set up ${MONTHS[+ym.slice(5) - 1]} →</b></button>`);
  } else if (dayN === daysInMonth(ym) && !state.months[ym]?.reviewedAt) {
    out.push(`<button class="banner review" data-go="#review/${ym}">Last day of ${MONTHS[+ym.slice(5) - 1]}. <b>Review your month tonight →</b></button>`);
  }
  const y = addDays(today, -1);
  const firstLogged = Object.keys(state.days).filter((d) => isLogged(state.days[d])).sort()[0];
  if (firstLogged && firstLogged < y && !isLogged(state.days[y])) {
    let missed = 0;
    for (let i = 1; i <= 7; i++) { const d = addDays(today, -i); if (d >= firstLogged && !isLogged(state.days[d])) missed++; }
    out.push(`<button class="banner missed" data-go="#today/${y}" data-slide="left">${missed > 1 ? `You missed ${missed} of the last 7 days.` : `You didn't log yesterday.`} <b>Fill in yesterday →</b></button>`);
  }
  return out.join('');
}

/* =========================================================
   MONTHLY REVIEW & RESET  (#review/YYYY-MM/step)
   1 Recap · 2 What the data says · 3 Set up next month
   ========================================================= */
let reviewDraft = null; // { ym, next, goals: [{...goal, keep, isNew}] }

function goalSuggestion(p, a) {
  if (!p) return { tag: 'New', tone: '', text: '' };
  const ks = a.keystones[0];
  if (p.g.type === 'number' && p.rate < 0.35 && p.valueAvg !== null) {
    const t = round1((p.valueAvg + p.g.target) / 2);
    return { tag: `Struggling · ${pct(p.rate)}`, tone: 'warn', text: `You averaged ${round1(p.valueAvg)}${p.g.unit || ''}. Try a stepping-stone target of ${t}${p.g.unit || ''}.`, target: t };
  }
  if (p.rate < 0.35) return { tag: `Struggling · ${pct(p.rate)}`, tone: 'warn', text: 'Make it smaller or more specific, or drop it if it no longer matters.' };
  if (p.rate >= 0.9) return { tag: `Automatic · ${pct(p.rate)}`, tone: 'good', text: 'Retire it to make room for something new, or raise the bar.' };
  if (ks && ks.g.id === p.g.id && ks.diff >= 1) return { tag: `Keystone · ${pct(p.rate)}`, tone: 'good', text: `On days you hit it, you hit ${round1(ks.diff)} more other goals. Keep it.` };
  return { tag: `On track · ${pct(p.rate)}`, tone: '', text: '' };
}

function renderReview(view, ym, step) {
  const a = analyze(ym);
  const next = addMonths(ym, 1);
  const mName = MONTHS[+ym.slice(5) - 1], nName = MONTHS[+next.slice(5) - 1];
  const steps = ['Recap', 'What the data says', `Set up ${nName}`];
  const nav = (n) => `#review/${ym}/${n}`;

  const head = `
    <div class="row date-head">
      <button class="icon-btn" data-go="#insights/${ym}" aria-label="Close review">✕</button>
      <div class="title"><h1>${mName} review</h1><p class="sub">Step ${step} of 3 · ${steps[step - 1]}</p></div>
      <span style="width:40px"></span>
    </div>
    <div class="steps-bar">${steps.map((_, i) => `<span class="${i < step ? 'on' : ''}"></span>`).join('')}</div>`;

  if (!a.N) {
    view.innerHTML = `${head}<div class="empty">No days logged in ${monthLabel(ym)}.</div>`;
    bindGo(view); return;
  }

  let body = '';
  if (step === 1) {
    const perfect = a.logged.filter((d) => d.score === a.goals.length && a.goals.length).length;
    const top = [...a.perGoal].sort((x, y) => y.rate - x.rate).slice(0, 3);
    const best = [...a.logged].sort((x, y) => y.score - x.score || y.day - x.day).filter((d) => d.entry.note).slice(0, 3);
    const improved = goalTrends(ym).filter((t) => t.delta !== null && t.delta >= 0.1).sort((x, y) => y.delta - x.delta).slice(0, 3);
    body = `
      <div class="stats">
        <div class="stat"><div class="k">Days logged</div><div class="v">${a.N}<span class="sub" style="font-size:13px;display:inline"> / ${a.days.length}</span></div></div>
        <div class="stat"><div class="k">Avg / day</div><div class="v">${round1(a.avg)}</div></div>
        <div class="stat"><div class="k">Perfect days</div><div class="v">${perfect}</div></div>
      </div>
      <h2>Your month</h2>
      <div class="card chart-wrap" id="reviewChart"></div>
      <h2>Best days</h2>
      <ol class="moments">${best.map((d) => `<li><span class="d">${d.day}</span><span class="t">${esc(d.entry.note)}</span><span class="c">${d.score}/${a.goals.length}</span></li>`).join('') || '<li><span class="t">No notes this month.</span></li>'}</ol>
      <h2>Wins</h2>
      <ul class="recs">
        ${top.map((p) => `<li><b>${esc(p.g.name)}</b> hit ${p.hits} of ${a.N} days (${pct(p.rate)})${p.bestStreak >= 3 ? `, with a best streak of ${p.bestStreak} days` : ''}.</li>`).join('')}
        ${improved.map((t) => `<li><b>${esc(t.g.name)}</b> improved ${Math.round(t.delta * 100)} points over the previous month.</li>`).join('')}
        <li>Longest logging streak: <b>${bestLogStreakIn(ym)} days</b> in a row.</li>
      </ul>`;
  } else if (step === 2) {
    body = `
      <h2>Recommendations</h2>
      <ul class="recs">${a.recs.map((r) => `<li>${r}</li>`).join('') || '<li>Nothing stands out. A steady month.</li>'}</ul>
      <h2>Goal trends</h2>
      ${trendsHTML(ym)}
      <h2>Want a second opinion?</h2>
      <p class="help">Copy this month's data and paste it into Claude for a written review.</p>
      <div class="actions"><button class="btn" id="copyAI">Copy month for AI review</button></div>`;
  } else {
    if (!reviewDraft || reviewDraft.ym !== ym) {
      const base = (state.months[next]?.goals?.length ? state.months[next].goals : a.goals);
      reviewDraft = { ym, next, goals: base.map((g) => ({ ...g, keep: true })) };
    }
    const nextLogged = loggedDaysIn(next);
    body = `
      <p class="help" style="margin-top:4px">Keep, drop or adjust each goal for ${monthLabel(next)}. Suggestions come from ${mName}'s data.${nextLogged ? ` You've already logged ${nextLogged} day${nextLogged > 1 ? 's' : ''} in ${nName}; their check marks stay.` : ''}</p>
      <div class="goal-edit">
        ${reviewDraft.goals.map((g, i) => {
          const sug = g.isNew ? { tag: 'New', tone: 'good', text: '' } : goalSuggestion(a.perGoal.find((p) => p.g.id === g.id), a);
          return `
          <div class="ge rv ${g.keep ? '' : 'dropped'}" data-i="${i}">
            <div class="row">
              <input class="name" value="${esc(g.name)}" aria-label="Goal name" placeholder="Goal name" ${g.keep ? '' : 'disabled'}>
              <button class="btn small keep-toggle" aria-pressed="${g.keep}">${g.keep ? 'Keep' : 'Dropped'}</button>
            </div>
            <div class="sug"><span class="tag ${sug.tone}">${esc(sug.tag)}</span>${sug.text ? ` ${esc(sug.text)}` : ''}</div>
            ${g.type === 'number' && g.keep ? `
              <div class="num-opts">
                <select class="dir" aria-label="Direction">
                  <option value="atMost" ${g.dir !== 'atLeast' ? 'selected' : ''}>at most</option>
                  <option value="atLeast" ${g.dir === 'atLeast' ? 'selected' : ''}>at least</option>
                </select>
                <input class="target" type="number" inputmode="decimal" step="any" value="${esc(g.target)}" aria-label="Target">
                <span>${esc(g.unit || '')}</span>
                ${sug.target !== undefined && sug.target !== g.target ? `<button class="btn small use-target" data-t="${sug.target}">Use ${sug.target}</button>` : ''}
              </div>` : ''}
          </div>`;
        }).join('')}
      </div>
      <form class="row" id="addGoal" style="margin-top:10px">
        <input id="newGoal" class="add-input" placeholder="Add a new goal…" aria-label="New goal name">
        <button class="btn" type="submit">Add</button>
      </form>`;
  }

  view.innerHTML = `${head}${body}
    <div class="review-nav">
      ${step > 1 ? `<button class="btn" data-go="${nav(step - 1)}">Back</button>` : '<span></span>'}
      ${step < 3 ? `<button class="btn primary" data-go="${nav(step + 1)}">Next</button>`
                 : `<button class="btn primary" id="finishReview">Start ${nName}</button>`}
    </div>`;
  bindGo(view);

  if (step === 1) drawLineChart(document.getElementById('reviewChart'), ym, a.days, a.goals.length);
  if (step === 2) document.getElementById('copyAI').addEventListener('click', async () => {
    const text = aiPrompt(ym, a);
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into Claude'); } catch { prompt('Copy this:', text); }
  });
  if (step === 3) {
    const redraw = () => { const y = window.scrollY; renderReview(view, ym, 3); window.scrollTo(0, y); };
    view.querySelectorAll('.ge.rv').forEach((el) => {
      const g = reviewDraft.goals[+el.dataset.i];
      el.querySelector('.name').addEventListener('input', (e) => { g.name = e.target.value; });
      el.querySelector('.keep-toggle').addEventListener('click', () => {
        if (g.isNew) reviewDraft.goals.splice(+el.dataset.i, 1); else g.keep = !g.keep;
        redraw();
      });
      el.querySelector('.dir')?.addEventListener('change', (e) => { g.dir = e.target.value; });
      el.querySelector('.target')?.addEventListener('input', (e) => { g.target = Number(e.target.value); });
      el.querySelector('.use-target')?.addEventListener('click', (e) => { g.target = Number(e.target.dataset.t); redraw(); });
    });
    document.getElementById('addGoal').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('newGoal').value.trim();
      if (!name) return;
      reviewDraft.goals.push({ id: uid(), name, type: 'check', keep: true, isNew: true });
      redraw();
    });
    document.getElementById('finishReview').addEventListener('click', () => {
      const kept = reviewDraft.goals.filter((g) => g.keep && g.name.trim());
      if (!kept.length) { toast('Keep at least one goal'); return; }
      state.months[next] = { ...(state.months[next] || {}), goals: kept.map(({ keep, isNew, ...g }) => ({ ...g, name: g.name.trim() })) };
      state.months[ym].reviewedAt = new Date().toISOString();
      save(true);
      reviewDraft = null;
      toast(`${nName} is set. ${kept.length} goals`);
      go(next <= ymOf(todayStr()) ? '#today' : `#goals/${next}`);
    });
  }
}

function bindGo(view) {
  view.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => go(el.dataset.go)));
}

/* =========================================================
   INSIGHTS — computed on-device from the month's data
   ========================================================= */
function analyze(ym) {
  const goals = monthGoals(ym, false);
  const days = monthDays(ym);
  const logged = days.filter((d) => d.logged);
  const N = logged.length;
  const res = { goals, days, logged, N, perGoal: [], weekday: [], pairs: [], keystones: [], recs: [] };
  if (!N) return res;

  const hit = (g, d) => isHit(g, d.entry);
  res.avg = logged.reduce((s, d) => s + d.score, 0) / N;
  res.best = logged.reduce((a, d) => (d.score > a.score ? d : a), logged[0]);

  // Per goal
  res.perGoal = goals.map((g) => {
    const hits = logged.filter((d) => hit(g, d)).length;
    let streak = 0, bestStreak = 0;
    days.forEach((d) => { if (d.logged && hit(g, d)) { streak++; bestStreak = Math.max(bestStreak, streak); } else streak = 0; });
    const out = { g, hits, rate: hits / N, bestStreak };
    if (g.type === 'number') {
      const vals = logged.map((d) => d.entry.values?.[g.id]).filter((v) => v !== undefined && v !== null && v !== '').map(Number);
      out.valueAvg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      out.valueCount = vals.length;
    }
    return out;
  });

  // Weekday averages
  res.weekday = WEEKDAYS.map((name, i) => {
    const ds = logged.filter((d) => parseDate(d.date).getDay() === i);
    return { name, n: ds.length, avg: ds.length ? ds.reduce((s, d) => s + d.score, 0) / ds.length : null };
  });

  // First half vs second half
  const half = Math.ceil(daysInMonth(ym) / 2);
  const h1 = logged.filter((d) => d.day <= half), h2 = logged.filter((d) => d.day > half);
  if (h1.length >= 4 && h2.length >= 4) {
    res.trend = { a: h1.reduce((s, d) => s + d.score, 0) / h1.length, b: h2.reduce((s, d) => s + d.score, 0) / h2.length };
  }

  // Keystone goals: on days you hit X, how many *other* goals do you hit vs days you don't?
  goals.forEach((g) => {
    const on = logged.filter((d) => hit(g, d)), off = logged.filter((d) => !hit(g, d));
    if (on.length < 3 || off.length < 3) return;
    const avgOther = (ds) => ds.reduce((s, d) => s + d.score - (hit(g, d) ? 1 : 0), 0) / ds.length;
    res.keystones.push({ g, diff: avgOther(on) - avgOther(off), on: on.length, off: off.length });
  });
  res.keystones.sort((a, b) => b.diff - a.diff);

  // Pairs: how much more likely is B on days you hit A?
  goals.forEach((a) => goals.forEach((b) => {
    if (a.id === b.id) return;
    const on = logged.filter((d) => hit(a, d)), off = logged.filter((d) => !hit(a, d));
    if (on.length < 3 || off.length < 3) return;
    const pOn = on.filter((d) => hit(b, d)).length / on.length;
    const pOff = off.filter((d) => hit(b, d)).length / off.length;
    res.pairs.push({ a, b, pOn, pOff, lift: pOn - pOff });
  }));
  res.pairs.sort((x, y) => y.lift - x.lift);

  // Recommendations
  const recs = res.recs;
  const dim = daysInMonth(ym);
  const elapsed = days.length;
  if (N < elapsed * 0.8) recs.push(`<b>Log more nights.</b> You logged ${N} of ${elapsed} days. The analysis gets more trustworthy past ~80%.`);
  if (N < 7) { recs.push('Keep logging. Patterns show up after about a week of entries.'); return res; }

  res.perGoal.filter((p) => p.rate < 0.35).sort((a, b) => a.rate - b.rate).slice(0, 3).forEach((p) => {
    let tip = 'Make it smaller or more specific next month, or drop it if it no longer matters.';
    if (p.g.type === 'number' && p.valueAvg !== null) {
      const t = p.g.target, avg = round1(p.valueAvg);
      tip = `You averaged ${avg}${p.g.unit || ''} against a target of ${targetText(p.g)}. Try a stepping-stone target near ${round1((avg + t) / 2)}${p.g.unit || ''}.`;
    }
    recs.push(`<b>${esc(p.g.name)}</b> hit only ${p.hits}/${N} days (${pct(p.rate)}). ${tip}`);
  });
  res.perGoal.filter((p) => p.rate >= 0.9).forEach((p) => {
    recs.push(`<b>${esc(p.g.name)}</b> is basically automatic (${pct(p.rate)}). Consider retiring it to make room for something new, or raise the bar.`);
  });
  const ks = res.keystones[0];
  if (ks && ks.diff >= 1) {
    recs.push(`<b>${esc(ks.g.name)}</b> looks like a keystone habit: on days you hit it you hit <b>${round1(ks.diff)} more</b> other goals on average. Protect it.`);
  }
  const pair = res.pairs.find((p) => p.lift >= 0.35);
  if (pair) {
    recs.push(`<b>${esc(pair.a.name)}</b> and <b>${esc(pair.b.name)}</b> travel together: ${pct(pair.pOn)} vs ${pct(pair.pOff)} of days. Stacking them back to back could make both easier.`);
  }
  const wds = res.weekday.filter((w) => w.n >= 2);
  if (wds.length >= 4) {
    const lo = wds.reduce((a, w) => (w.avg < a.avg ? w : a)), hi = wds.reduce((a, w) => (w.avg > a.avg ? w : a));
    const full = (w) => ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][WEEKDAYS.indexOf(w.name)];
    if (hi.avg - lo.avg >= 1.5) recs.push(`<b>${full(lo)}</b> are your weakest day (${round1(lo.avg)} goals vs ${round1(hi.avg)} on ${full(hi)}). Plan something specific for them.`);
  }
  if (res.trend && Math.abs(res.trend.b - res.trend.a) >= 1) {
    recs.push(res.trend.b > res.trend.a
      ? `You finished stronger: ${round1(res.trend.b)} goals/day in the second half vs ${round1(res.trend.a)} in the first.`
      : `You faded later in the month: ${round1(res.trend.a)} → ${round1(res.trend.b)} goals/day. Was something different about the second half?`);
  }
  if (elapsed < dim) recs.push(`Month still in progress (${elapsed}/${dim} days). Final recommendations firm up at month end.`);
  return res;
}

function renderInsights(view, ym) {
  const a = analyze(ym);
  if (!a.N) {
    view.innerHTML = `${monthNav(ym, 'insights')}<div class="empty">No days logged in ${monthLabel(ym)} yet.</div>`;
    return;
  }
  const maxWd = Math.max(...a.weekday.map((w) => w.avg || 0), 1);
  view.innerHTML = `
    ${monthNav(ym, 'insights')}
    <div class="stats">
      <div class="stat"><div class="k">Days logged</div><div class="v">${a.N}</div></div>
      <div class="stat"><div class="k">Avg / day</div><div class="v">${round1(a.avg)}</div></div>
      <div class="stat"><div class="k">Best day</div><div class="v">${a.best.score}<span class="sub" style="font-size:13px"> · ${MONTHS[+ym.slice(5) - 1].slice(0, 3)} ${a.best.day}</span></div></div>
    </div>

    <button class="banner review" data-go="#review/${ym}" style="margin-top:12px">${state.months[ym]?.reviewedAt ? 'Reviewed ✓ ' : ''}<b>${state.months[ym]?.reviewedAt ? 'Open' : 'Start'} the ${MONTHS[+ym.slice(5) - 1]} review →</b></button>

    <h2>Recommendations</h2>
    <ul class="recs">${a.recs.map((r) => `<li>${r}</li>`).join('') || '<li>Nothing stands out yet. Steady month.</li>'}</ul>

    <h2>Goal trends</h2>
    ${trendsHTML(ym)}

    <h2>Hit rate by goal</h2>
    <div class="card bars">
      ${[...a.perGoal].sort((x, y) => y.rate - x.rate).map((p) => `
        <div class="bar-row" title="Best streak: ${p.bestStreak} days">
          <div class="lbl"><span>${esc(p.g.name)}${p.g.type === 'number' && p.valueAvg !== null ? ` <span class="sub" style="display:inline">· avg ${round1(p.valueAvg)}${esc(p.g.unit || '')}</span>` : ''}${p.bestStreak >= 3 ? ` <span class="sub" style="display:inline">· best streak ${p.bestStreak}</span>` : ''}</span><span>${p.hits}/${a.N}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${p.rate * 100}%"></div></div>
        </div>`).join('')}
    </div>

    <h2>Average goals by weekday</h2>
    <div class="card">
      <div class="weekdays">
        ${a.weekday.map((w) => `
          <div class="wd" title="${w.name}: ${w.avg === null ? 'no data' : round1(w.avg) + ' avg over ' + w.n + ' days'}">
            <span class="val">${w.avg === null ? '–' : round1(w.avg)}</span>
            <div class="b" style="height:${w.avg === null ? 0 : (w.avg / maxWd) * 80}%"></div>
            <span>${w.name[0]}</span>
          </div>`).join('')}
      </div>
    </div>

    ${a.keystones.length ? `
    <h2>Ripple effect</h2>
    <p class="help" style="margin-top:-4px">Extra <i>other</i> goals hit on days you hit this one.</p>
    <div class="card bars">
      ${a.keystones.slice(0, 5).map((k) => `
        <div class="bar-row">
          <div class="lbl"><span>${esc(k.g.name)}</span><span>${k.diff >= 0 ? '+' : ''}${round1(k.diff)}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(1, k.diff / 4)) * 100}%"></div></div>
        </div>`).join('')}
    </div>` : ''}

    <h2>Deeper analysis</h2>
    <p class="help">Copy this month's data as a ready-made prompt, then paste it into Claude for a written review and suggested goals for next month.</p>
    <div class="actions"><button class="btn primary" id="copyAI">Copy month for AI review</button></div>
  `;
  document.getElementById('copyAI').addEventListener('click', async () => {
    const text = aiPrompt(ym, a);
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into Claude'); }
    catch { prompt('Copy this:', text); }
  });
  bindGo(view);
}

function aiPrompt(ym, a) {
  const header = ['day', 'weekday', ...a.goals.map((g) => g.name + (g.type === 'number' ? ` (${targetText(g)})` : '')), 'total', 'note'];
  const rows = a.days.map((d) => {
    if (!d.logged) return [d.day, WEEKDAYS[parseDate(d.date).getDay()], ...a.goals.map(() => ''), '', '(not logged)'];
    return [d.day, WEEKDAYS[parseDate(d.date).getDay()],
      ...a.goals.map((g) => g.type === 'number' ? (d.entry.values?.[g.id] ?? '') : (isHit(g, d.entry) ? 'X' : '')),
      d.score, (d.entry.note || '').replace(/[\n,]/g, ' ')];
  });
  const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
  return `I keep a nightly journal: one sentence per day plus a checklist of daily goals. Below is my data for ${monthLabel(ym)} (X = goal hit; numeric goals show the value and their target in the header).

Please:
1. Summarize how the month went in 3–4 sentences, using the notes for context.
2. Point out the most meaningful patterns (which goals go together, weekday effects, trends, what seems to drive good vs bad days).
3. Recommend specific changes to my goal list for next month: keep / drop / adjust / add, with a short reason for each. Keep the total list manageable.

${csv}`;
}

/* =========================================================
   GOALS (per-month setup) + backup
   ========================================================= */
function renderGoals(view, ym) {
  const goals = monthGoals(ym);
  const prevYm = addMonths(ym, -1);

  view.innerHTML = `
    ${monthNav(ym, 'goals')}
    <p class="sub" style="text-align:center;margin-top:-6px">Goals for this month. Changes apply to every day in ${MONTHS[+ym.slice(5) - 1]}.</p>

    <div id="syncCard"></div>

    <h2>Goals</h2>
    <div class="goal-edit">
      ${goals.map((g, i) => `
        <div class="ge" data-i="${i}">
          <div class="row">
            <input class="name" value="${esc(g.name)}" aria-label="Goal name" placeholder="Goal name">
            <div class="ctrl">
              <button data-act="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button data-act="down" aria-label="Move down" ${i === goals.length - 1 ? 'disabled' : ''}>↓</button>
              <button data-act="del" aria-label="Delete">✕</button>
            </div>
          </div>
          <div class="num-opts">
            <select class="type" aria-label="Goal type">
              <option value="check" ${g.type === 'check' ? 'selected' : ''}>Yes / no</option>
              <option value="number" ${g.type === 'number' ? 'selected' : ''}>Number</option>
            </select>
            ${g.type === 'number' ? `
              <select class="dir" aria-label="Direction">
                <option value="atMost" ${g.dir !== 'atLeast' ? 'selected' : ''}>at most</option>
                <option value="atLeast" ${g.dir === 'atLeast' ? 'selected' : ''}>at least</option>
              </select>
              <input class="target" type="number" inputmode="decimal" step="any" value="${esc(g.target)}" aria-label="Target">
              <input class="unit" value="${esc(g.unit || '')}" placeholder="unit" aria-label="Unit">` : ''}
          </div>
        </div>`).join('')}
    </div>
    <div class="actions">
      <button class="btn" id="add">+ Add goal</button>
      ${state.months[prevYm] ? `<button class="btn" id="copyPrev">Copy ${MONTHS[+prevYm.slice(5) - 1]}'s goals</button>` : ''}
    </div>

    <h2>Import past months</h2>
    <p class="help">Have older months in a paper journal? Turn photos of the pages into Tally data.</p>
    <div class="actions"><a class="btn" href="#import" style="text-decoration:none">Import from photo</a></div>

    <h2>Backup</h2>
    <p class="help">Your data lives only on this device. Export a backup now and then (it's a small file). Import restores it on any device.</p>
    <div class="actions">
      <button class="btn" id="export">Export backup</button>
      <label class="btn" for="importFile" style="display:inline-block">Import backup</label>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
    </div>
  `;

  if (window.renderSyncCard) window.renderSyncCard(document.getElementById('syncCard'));
  const rerender = () => { save(true); renderGoals(view, ym); };
  view.querySelectorAll('.ge').forEach((el) => {
    const g = goals[+el.dataset.i];
    el.querySelector('.name').addEventListener('input', (e) => { g.name = e.target.value; save(); });
    el.querySelector('.type').addEventListener('change', (e) => {
      g.type = e.target.value;
      if (g.type === 'number') { g.dir = g.dir || 'atMost'; g.target = g.target ?? 1; }
      rerender();
    });
    el.querySelector('.dir')?.addEventListener('change', (e) => { g.dir = e.target.value; save(); });
    el.querySelector('.target')?.addEventListener('input', (e) => { g.target = Number(e.target.value); save(); });
    el.querySelector('.unit')?.addEventListener('input', (e) => { g.unit = e.target.value; save(); });
    el.querySelectorAll('.ctrl button').forEach((b) => b.addEventListener('click', () => {
      const i = +el.dataset.i;
      if (b.dataset.act === 'del') {
        if (!confirm(`Remove "${g.name}" from ${monthLabel(ym)}? Past check-marks stay saved but won't count.`)) return;
        goals.splice(i, 1);
      } else {
        const j = b.dataset.act === 'up' ? i - 1 : i + 1;
        [goals[i], goals[j]] = [goals[j], goals[i]];
      }
      rerender();
    }));
  });
  document.getElementById('add').addEventListener('click', () => {
    goals.push({ id: uid(), name: '', type: 'check' });
    rerender();
    const inputs = view.querySelectorAll('.ge .name');
    inputs[inputs.length - 1].focus();
  });
  document.getElementById('copyPrev')?.addEventListener('click', () => {
    if (!confirm(`Replace this month's goals with ${monthLabel(prevYm)}'s?`)) return;
    state.months[ym].goals = state.months[prevYm].goals.map((g) => ({ ...g }));
    rerender();
  });
  document.getElementById('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tally-backup-${todayStr()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.months || !data.days) throw new Error('bad file');
      if (!confirm('Replace all data on this device with this backup?')) return;
      state = data; save(true); toast('Backup restored'); route();
    } catch { alert("That file doesn't look like a Tally backup."); }
  });
}


/* =========================================================
   IMPORT FROM PHOTO
   Free flow: Tally copies instructions → you send them + page photos to Claude →
   paste Claude's JSON reply back → review/fix → save.
   ========================================================= */
let importDraft = null; // { months: [{ ym, goals:[{name,type,dir,target,unit}], days:{n:{note,hits:Set<idx>,values:{idx:num}}}, unsure:[] }] }

function importInstructions() {
  const year = todayStr().slice(0, 4);
  return `I'm attaching photos of my handwritten monthly habit journal. Please convert them into data I can import into my tracking app.

Each month usually has:
- A "memorable moments" list: one short line per day, numbered by day of the month.
- A tracker grid: one row per day, one column per goal. A mark (X, check, dot, etc.) means I hit that goal that day. Some columns hold numbers instead of marks (for example hours of screen time).
- A totals row and a line graph. Don't import these, but use the totals row to double-check your counts.

Reply with ONLY one JSON code block in exactly this shape, with one entry per month you can see:

{"months":[{
  "month": "YYYY-MM",
  "goals": [
    {"name": "Exercise", "type": "check"},
    {"name": "Screen time", "type": "number", "dir": "atMost", "target": null, "unit": "h"}
  ],
  "days": [
    {"day": 1, "note": "Christmas + New Year's = record player and pinball", "hits": ["Exercise"], "values": {"Screen time": 3.5}}
  ],
  "unsure": ["Day 14: couldn't tell if Meditation was marked"]
}]}

Rules:
- List goals in the column order they appear. Write names out cleanly and expand obvious abbreviations.
- Use "type": "number" only for columns that contain numbers. "dir" is "atMost" if lower is better (like screen time) or "atLeast" if higher is better. Use "target": null unless a target is written on the page.
- "hits" lists the exact goal names that are marked that day (check goals only). "values" holds the numbers for number goals.
- Copy each day's note as written, fixing only obvious spelling. Leave out days with no note and no marks.
- If a mark, number, or word is unclear, make your best guess and add a short line about it to "unsure". If a goal's count doesn't match the totals row, mention that in "unsure" too.
- If the year isn't visible, assume ${year}.`;
}

function parseImport(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1];
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error("Couldn't find any data in that text. Make sure you copied Claude's whole reply.");
  let data;
  try { data = JSON.parse(t.slice(a, b + 1)); } catch { throw new Error("The pasted text isn't complete. Copy Claude's entire reply (the code block) and try again."); }
  const list = Array.isArray(data) ? data : data.months ? data.months : [data];
  if (!list.length) throw new Error('No months found in the pasted text.');

  return {
    months: list.map((m) => {
      const goals = (m.goals || []).filter((g) => g && g.name).map((g) => {
        const isNum = g.type === 'number';
        // Reuse the target from an existing goal with the same name, if you've set one before
        const prior = isNum ? findGoalByName(g.name) : null;
        return {
          name: String(g.name).trim(),
          type: isNum ? 'number' : 'check',
          dir: isNum ? (g.dir === 'atLeast' ? 'atLeast' : 'atMost') : undefined,
          target: isNum ? (typeof g.target === 'number' ? g.target : prior?.type === 'number' ? prior.target : null) : undefined,
          unit: isNum ? (g.unit ?? prior?.unit ?? '') : undefined,
        };
      });
      const idxOf = (name) => goals.findIndex((g) => g.name.toLowerCase() === String(name).trim().toLowerCase());
      const ym = /^\d{4}-\d{2}$/.test(m.month || '') ? m.month : ymOf(todayStr());
      const days = {};
      (m.days || []).forEach((d) => {
        const n = parseInt(d.day, 10);
        if (!(n >= 1 && n <= 31)) return;
        const hits = new Set((d.hits || []).map(idxOf).filter((i) => i >= 0 && goals[i].type === 'check'));
        const values = {};
        Object.entries(d.values || {}).forEach(([k, v]) => {
          const i = idxOf(k);
          if (i >= 0 && goals[i].type === 'number' && v !== null && v !== '' && !Number.isNaN(Number(v))) values[i] = Number(v);
        });
        days[n] = { note: String(d.note || '').trim(), hits, values };
      });
      return { ym, goals, days, unsure: (m.unsure || []).map(String) };
    }),
  };
}

function findGoalByName(name) {
  const key = String(name).trim().toLowerCase();
  const months = Object.keys(state.months).sort().reverse();
  for (const ym of months) {
    const g = state.months[ym].goals.find((x) => x.name.trim().toLowerCase() === key);
    if (g) return g;
  }
  return null;
}

function loggedDaysIn(ym) {
  return Object.keys(state.days).filter((d) => d.startsWith(ym + '-') && isLogged(state.days[d])).length;
}

function renderImport(view) {
  if (!importDraft) return renderImportPaste(view);
  renderImportReview(view);
}

function renderImportPaste(view) {
  view.innerHTML = `
    <div class="row date-head">
      <button class="icon-btn" onclick="location.hash='#goals'" aria-label="Back">‹</button>
      <div class="title"><h1>Import from photo</h1></div>
      <span style="width:40px"></span>
    </div>

    <ol class="steps">
      <li>
        <b>Copy the instructions.</b>
        <div class="actions"><button class="btn primary" id="copyInstr">Copy instructions</button></div>
      </li>
      <li>
        <b>Open Claude</b>, start a new chat, attach photos of your journal pages, and paste the instructions.
        <p class="help">Send several months at once if you like. A clear, straight-on, well-lit photo of each page works best: both the moments list and the tracker grid.</p>
      </li>
      <li>
        <b>Copy Claude's whole reply</b> and paste it here.
        <label class="sr-only" for="importText">Claude's reply</label>
        <textarea class="note" id="importText" placeholder="Paste Claude's reply here…" style="min-height:120px;font-size:14px;font-family:ui-monospace,Menlo,monospace"></textarea>
        <p class="help" id="importErr" style="color:var(--danger)"></p>
        <div class="actions"><button class="btn primary" id="readIt">Review import</button></div>
      </li>
    </ol>
  `;
  document.getElementById('copyInstr').addEventListener('click', async () => {
    const text = importInstructions();
    try { await navigator.clipboard.writeText(text); toast('Copied. Now paste it into Claude'); }
    catch { prompt('Copy this:', text); }
  });
  document.getElementById('readIt').addEventListener('click', () => {
    try {
      importDraft = parseImport(document.getElementById('importText').value);
      renderImportReview(view); window.scrollTo(0, 0);
    } catch (e) { document.getElementById('importErr').textContent = e.message; }
  });
}

function renderImportReview(view) {
  const draft = importDraft;
  const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';

  view.innerHTML = `
    <div class="row date-head">
      <button class="icon-btn" id="backPaste" aria-label="Back">‹</button>
      <div class="title"><h1>Review import</h1><p class="sub">${draft.months.length} month${draft.months.length > 1 ? 's' : ''}. Check against your photo, tap cells to fix</p></div>
      <span style="width:40px"></span>
    </div>

    ${draft.months.map((m, mi) => {
      const dim = daysInMonth(m.ym);
      const existing = loggedDaysIn(m.ym);
      return `
      <section class="imp-month" data-mi="${mi}">
        <div class="row spread" style="margin-top:22px">
          <input type="month" class="imp-ym" value="${m.ym}" aria-label="Month">
          <button class="btn small danger imp-drop">Skip this month</button>
        </div>
        ${existing ? `<p class="warn">You already have ${existing} logged day${existing > 1 ? 's' : ''} in ${monthLabel(m.ym)}. Saving replaces them.</p>` : ''}
        ${m.unsure.length ? `<div class="unsure"><b>Double-check these</b><ul>${m.unsure.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div>` : ''}

        <h2>Goals</h2>
        <div class="goal-edit">
          ${m.goals.map((g, gi) => `
            <div class="ge" data-gi="${gi}">
              <div class="row">
                <input class="name" value="${esc(g.name)}" aria-label="Goal name">
                <div class="ctrl"><button class="imp-gdel" aria-label="Remove goal">✕</button></div>
              </div>
              <div class="num-opts">
                <select class="imp-type" aria-label="Goal type">
                  <option value="check" ${g.type === 'check' ? 'selected' : ''}>Yes / no</option>
                  <option value="number" ${g.type === 'number' ? 'selected' : ''}>Number</option>
                </select>
                ${g.type === 'number' ? `
                  <select class="imp-dir" aria-label="Direction">
                    <option value="atMost" ${g.dir !== 'atLeast' ? 'selected' : ''}>at most</option>
                    <option value="atLeast" ${g.dir === 'atLeast' ? 'selected' : ''}>at least</option>
                  </select>
                  <input class="target ${g.target === null || g.target === undefined ? 'need' : ''}" type="number" inputmode="decimal" step="any" value="${esc(g.target ?? '')}" placeholder="target" aria-label="Target">
                  <input class="unit" value="${esc(g.unit || '')}" placeholder="unit" aria-label="Unit">` : ''}
              </div>
            </div>`).join('')}
        </div>

        <h2>Tracker</h2>
        <div class="card grid-table">
          <table class="tracker imp-grid">
            <thead><tr><th></th>${m.goals.map((g) => `<th class="gname">${esc(g.name)}</th>`).join('')}</tr></thead>
            <tbody>
              ${Array.from({ length: dim }, (_, i) => i + 1).map((n) => {
                const d = m.days[n] || { hits: new Set(), values: {} };
                return `<tr data-day="${n}"><td class="d">${n}</td>${m.goals.map((g, gi) => g.type === 'number'
                  ? `<td><input class="cell-num" data-gi="${gi}" type="number" inputmode="decimal" step="any" value="${esc(d.values[gi] ?? '')}" aria-label="Day ${n} ${esc(g.name)}"></td>`
                  : `<td><button class="cell ${d.hits.has(gi) ? 'on' : ''}" data-gi="${gi}" aria-pressed="${d.hits.has(gi)}" aria-label="Day ${n} ${esc(g.name)}">${CHECK}</button></td>`).join('')}</tr>`;
              }).join('')}
              <tr class="totals"><td class="d">Σ</td>${m.goals.map((g, gi) => `<td class="imp-tot" data-gi="${gi}"></td>`).join('')}</tr>
            </tbody>
          </table>
        </div>

        <h2>Memorable moments</h2>
        <div class="imp-notes">
          ${Array.from({ length: dim }, (_, i) => i + 1).map((n) => `
            <label class="imp-note"><span class="d">${n}</span><input data-day="${n}" value="${esc(m.days[n]?.note || '')}" placeholder="—"></label>`).join('')}
        </div>
      </section>`;
    }).join('')}

    <p class="help" id="saveErr" style="color:var(--danger)"></p>
    <div class="actions" style="margin-top:20px">
      <button class="btn primary" id="saveImport" ${draft.months.length ? '' : 'disabled'}>Save ${draft.months.length > 1 ? 'all months' : 'month'}</button>
      <button class="btn" id="cancelImport">Cancel</button>
    </div>
  `;

  const rerender = () => { const y = window.scrollY; renderImportReview(view); window.scrollTo(0, y); };
  const dayOf = (m, n) => (m.days[n] ||= { note: '', hits: new Set(), values: {} });
  const updateTotals = (sec, m) => sec.querySelectorAll('.imp-tot').forEach((td) => {
    const gi = +td.dataset.gi, g = m.goals[gi];
    td.textContent = Object.values(m.days).filter((d) => g.type === 'number' ? d.values[gi] !== undefined : d.hits.has(gi)).length;
  });

  view.querySelectorAll('.imp-month').forEach((sec) => {
    const m = draft.months[+sec.dataset.mi];
    updateTotals(sec, m);
    sec.querySelector('.imp-ym').addEventListener('change', (e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { m.ym = e.target.value; rerender(); } });
    sec.querySelector('.imp-drop').addEventListener('click', () => { draft.months.splice(+sec.dataset.mi, 1); rerender(); });

    sec.querySelectorAll('.ge').forEach((el) => {
      const gi = +el.dataset.gi, g = m.goals[gi];
      el.querySelector('.name').addEventListener('input', (e) => { g.name = e.target.value; });
      el.querySelector('.name').addEventListener('change', rerender);
      el.querySelector('.imp-type').addEventListener('change', (e) => {
        g.type = e.target.value;
        if (g.type === 'number') { g.dir = g.dir || 'atMost'; g.target ??= null; g.unit ??= ''; }
        Object.values(m.days).forEach((d) => { d.hits.delete(gi); delete d.values[gi]; });
        rerender();
      });
      el.querySelector('.imp-dir')?.addEventListener('change', (e) => { g.dir = e.target.value; });
      el.querySelector('.target')?.addEventListener('input', (e) => { g.target = e.target.value === '' ? null : Number(e.target.value); e.target.classList.toggle('need', e.target.value === ''); });
      el.querySelector('.unit')?.addEventListener('input', (e) => { g.unit = e.target.value; });
      el.querySelector('.imp-gdel').addEventListener('click', () => {
        if (!confirm(`Remove "${g.name}" from this import?`)) return;
        m.goals.splice(gi, 1);
        // Shift goal indexes in the day data
        Object.values(m.days).forEach((d) => {
          d.hits = new Set([...d.hits].filter((i) => i !== gi).map((i) => (i > gi ? i - 1 : i)));
          const v = {}; Object.entries(d.values).forEach(([k, val]) => { k = +k; if (k !== gi) v[k > gi ? k - 1 : k] = val; }); d.values = v;
        });
        rerender();
      });
    });

    sec.querySelectorAll('.cell').forEach((btn) => btn.addEventListener('click', () => {
      const d = dayOf(m, +btn.closest('tr').dataset.day), gi = +btn.dataset.gi;
      if (d.hits.has(gi)) d.hits.delete(gi); else d.hits.add(gi);
      btn.classList.toggle('on', d.hits.has(gi)); btn.setAttribute('aria-pressed', d.hits.has(gi));
      updateTotals(sec, m);
    }));
    sec.querySelectorAll('.cell-num').forEach((inp) => inp.addEventListener('input', () => {
      const d = dayOf(m, +inp.closest('tr').dataset.day), gi = +inp.dataset.gi;
      if (inp.value === '') delete d.values[gi]; else d.values[gi] = Number(inp.value);
      updateTotals(sec, m);
    }));
    sec.querySelectorAll('.imp-note input').forEach((inp) => inp.addEventListener('input', () => { dayOf(m, +inp.dataset.day).note = inp.value; }));
  });

  document.getElementById('backPaste').addEventListener('click', () => { importDraft = null; renderImportPaste(view); });
  document.getElementById('cancelImport').addEventListener('click', () => { importDraft = null; go('#goals'); });
  document.getElementById('saveImport').addEventListener('click', () => {
    const err = document.getElementById('saveErr');
    const yms = draft.months.map((m) => m.ym);
    if (new Set(yms).size !== yms.length) { err.textContent = 'Two of these are set to the same month. Fix the month picker on one of them.'; return; }
    for (const m of draft.months) {
      if (m.goals.some((g) => !g.name.trim())) { err.textContent = `A goal in ${monthLabel(m.ym)} has no name.`; return; }
      const missing = m.goals.find((g) => g.type === 'number' && (g.target === null || Number.isNaN(g.target)));
      if (missing) { err.textContent = `Set a target for "${missing.name}" in ${monthLabel(m.ym)}: the number that counts as a hit.`; return; }
    }
    const overwrite = draft.months.filter((m) => loggedDaysIn(m.ym));
    if (overwrite.length && !confirm(`This replaces existing data in ${overwrite.map((m) => monthLabel(m.ym)).join(', ')}. Continue?`)) return;

    draft.months.forEach((m) => {
      // Reuse ids of goals with the same name so trends line up across months
      const goals = m.goals.map((g) => {
        const prior = findGoalByName(g.name);
        const out = { id: prior ? prior.id : uid(), name: g.name.trim(), type: g.type };
        if (g.type === 'number') Object.assign(out, { dir: g.dir || 'atMost', target: g.target, unit: g.unit || '' });
        return out;
      });
      state.months[m.ym] = { goals };
      Object.keys(state.days).forEach((d) => { if (d.startsWith(m.ym + '-')) delete state.days[d]; });
      Object.entries(m.days).forEach(([n, d]) => {
        if (+n > daysInMonth(m.ym)) return;
        const hits = {}, values = {};
        d.hits.forEach((gi) => { hits[goals[gi].id] = true; });
        Object.entries(d.values).forEach(([gi, v]) => { values[goals[gi].id] = v; });
        const entry = { note: d.note || '', hits, values };
        if (isLogged(entry)) state.days[`${m.ym}-${pad(+n)}`] = entry;
      });
    });
    save(true);
    const first = [...yms].sort()[0];
    importDraft = null;
    toast(`Imported ${yms.length} month${yms.length > 1 ? 's' : ''}`);
    go(`#month/${first}`);
  });
}

/* ---------- boot ---------- */
if (!localStorage.getItem(KEY)) save(true);
route();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Ask the browser not to evict our data
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
