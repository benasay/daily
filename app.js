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

const KEY = 'daily-goals-v1';
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
  const [tab = 'today', arg] = location.hash.replace(/^#\/?/, '').split('/');
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const view = document.getElementById('view');
  const today = todayStr();
  if (tab === 'month') renderMonth(view, arg || ymOf(today));
  else if (tab === 'insights') renderInsights(view, arg || ymOf(today));
  else if (tab === 'goals') renderGoals(view, arg || ymOf(today));
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

    <div class="score" aria-live="polite"><span class="n" id="score">0</span><span class="of">/ ${goals.length}</span></div>
    <div class="pips" id="pips">${goals.map(() => '<span class="pip"></span>').join('')}</div>

    <label class="sr-only" for="note">One sentence for the day</label>
    <textarea class="note" id="note" maxlength="240" placeholder="One sentence for the day…">${esc(entry.note)}</textarea>

    <h2>Goals</h2>
    ${goals.length ? '' : `<div class="empty">No goals this month yet. <a href="#goals/${ym}">Add some</a>.</div>`}
    <div class="goal-list">
      ${goals.map((g) => g.type === 'number' ? `
        <label class="goal" data-id="${g.id}">
          <span class="box"></span>
          <span class="name">${esc(g.name)}<br><span class="meta">Goal ${esc(targetText(g))}</span></span>
          <input class="num" type="number" inputmode="decimal" step="any" placeholder="${esc(g.unit || '—')}"
                 value="${esc(entry.values?.[g.id] ?? '')}" aria-label="${esc(g.name)} value">
        </label>` : `
        <button class="goal" data-id="${g.id}" aria-pressed="false">
          <span class="box"></span>
          <span class="name">${esc(g.name)}</span>
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
      el.querySelector('.box').textContent = on ? '✕' : '';
      if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', on);
    });
    const s = document.getElementById('score');
    s.textContent = n;
    if (last !== -1 && n !== last) { s.classList.add('bump'); setTimeout(() => s.classList.remove('bump'), 180); }
    if (last !== -1 && n > last && n === goals.length && goals.length) toast('Perfect day ✕ all of them');
    last = n;
    view.querySelectorAll('.pip').forEach((p, i) => p.classList.toggle('on', i < n));
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
  document.getElementById('note').addEventListener('input', (ev) => { e.note = ev.target.value; save(); });
  document.getElementById('prev').addEventListener('click', () => go(`#today/${addDays(date, -1)}`));
  document.getElementById('next').addEventListener('click', () => go(addDays(date, 1) >= today ? '#today' : `#today/${addDays(date, 1)}`));
}

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
    <h2>Goals hit per day</h2>
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
                return `<td class="x">${isHit(g, d.entry) ? '✕' : ''}</td>`;
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

  drawLineChart(document.getElementById('chart'), ym, days, goals.length);
  view.querySelectorAll('[data-date]').forEach((el) => el.addEventListener('click', () => go(`#today/${el.dataset.date}`)));
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

  const yTicks = [];
  const step = ymax > 8 ? 2 : 1;
  for (let v = 0; v <= ymax; v += step) yTicks.push(v);
  const xTicks = [1, 5, 10, 15, 20, 25, n].filter((v, i, a) => v <= n && a.indexOf(v) === i && !(v === 25 && n - 25 < 3));

  host.innerHTML = `
    <div class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Goals hit each day in ${monthLabel(ym)}">
        <g class="grid">${yTicks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>
        <g class="axis">
          ${yTicks.map((v) => `<text x="${L - 8}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join('')}
          ${xTicks.map((v) => `<text x="${x(v)}" y="${H - 6}" text-anchor="middle">${v}</text>`).join('')}
        </g>
        <line class="cross" id="cross" y1="${T}" y2="${H - B}" style="display:none"/>
        <path class="series" d="${path}"/>
        ${logged.map((d) => `<circle class="pt" data-day="${d.day}" cx="${x(d.day)}" cy="${y(d.score)}" r="4"/>`).join('')}
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
    tip.innerHTML = `<b>${MONTHS[+ym.slice(5) - 1].slice(0, 3)} ${best.day} · ${best.score} / ${maxY}</b>${note}`;
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
    if (hi.avg - lo.avg >= 1.5) recs.push(`<b>${lo.name}s</b> are your weakest day (${round1(lo.avg)} goals vs ${round1(hi.avg)} on ${hi.name}s). Plan something specific for them.`);
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

    <h2>Recommendations</h2>
    <ul class="recs">${a.recs.map((r) => `<li>${r}</li>`).join('') || '<li>Nothing stands out yet. Steady month.</li>'}</ul>

    <h2>Hit rate by goal</h2>
    <div class="card bars">
      ${[...a.perGoal].sort((x, y) => y.rate - x.rate).map((p) => `
        <div class="bar-row" title="Best streak: ${p.bestStreak} days">
          <div class="lbl"><span>${esc(p.g.name)}${p.g.type === 'number' && p.valueAvg !== null ? ` <span class="sub" style="display:inline">· avg ${round1(p.valueAvg)}${esc(p.g.unit || '')}</span>` : ''}</span><span>${p.hits}/${a.N}</span></div>
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

    <h2>Backup</h2>
    <p class="help">Your data lives only on this device. Export a backup now and then (it's a small file). Import restores it on any device.</p>
    <div class="actions">
      <button class="btn" id="export">Export backup</button>
      <label class="btn" for="importFile" style="display:inline-block">Import backup</label>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
    </div>
  `;

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
    a.download = `daily-backup-${todayStr()}.json`;
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
    } catch { alert("That file doesn't look like a Daily backup."); }
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
