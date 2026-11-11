'use strict';
/* =========================================================
   Cloud sync with Supabase (no libraries: plain fetch to its REST APIs).

   - Each day and each month's goal list is one row in `tally_items`
     (key "day:2026-11-11" / "month:2026-11", data = JSON, updated_at = when it was edited).
   - The app keeps working from localStorage. This file watches for changes,
     pushes them up, and pulls other devices' changes down.
   - Conflicts: the most recent edit of a given day/month wins.
   - The publishable key is meant to be public; row-level security in the
     database limits each signed-in person to their own rows.
   ========================================================= */

const SB_URL = 'https://ocsfxympwmolqknftokh.supabase.co';
const SB_KEY = 'sb_publishable_1FelJSz4qLK0aISACGKbVA_zzXCROoM';
const SYNC_KEY = 'tally-sync-v1';
const TOMBSTONE = 'null'; // snapshot value for "deleted"

let sync = loadSync();
let syncing = false, syncAgain = false, lastError = '', syncTimer = null;

function loadSync() {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_KEY));
    if (s && typeof s === 'object') return { session: null, snap: {}, dirty: {}, lastSync: null, needsChoice: false, ...s };
  } catch (e) { /* ignore */ }
  return { session: null, snap: {}, dirty: {}, lastSync: null, needsChoice: false };
}
const saveSync = () => localStorage.setItem(SYNC_KEY, JSON.stringify(sync));
// Stable JSON (sorted keys): the database reorders object keys, so compare canonically
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));
const writeLocal = () => localStorage.setItem(KEY, JSON.stringify(state)); // without triggering onTallySaved

/* ---------- state <-> rows ---------- */
function localItems() {
  const out = {};
  for (const [ym, m] of Object.entries(state.months)) out[`month:${ym}`] = m;
  for (const [d, e] of Object.entries(state.days)) if (isLogged(e)) out[`day:${d}`] = e;
  return out;
}

/** Compare current data with what was last synced; mark changed keys as dirty. */
function detectChanges() {
  const items = localItems();
  const now = new Date().toISOString();
  let any = false;
  for (const [k, v] of Object.entries(items)) {
    if (sync.snap[k] !== stable(v)) { sync.dirty[k] = now; any = true; }
  }
  for (const k of Object.keys(sync.snap)) {
    if (!(k in items) && sync.snap[k] !== TOMBSTONE) { sync.dirty[k] = now; any = true; }
  }
  if (any) saveSync();
  return any;
}

/** Apply a remote row to local state. Mutates in place so open screens keep working. */
function applyRemote(key, data) {
  const deleted = !data || data._deleted;
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (kind === 'day') {
    if (deleted) {
      if (state.days[id]) Object.assign(state.days[id], { note: '', hits: {}, values: {} });
    } else if (state.days[id]) {
      const e = state.days[id];
      Object.keys(e).forEach((k) => delete e[k]);
      Object.assign(e, data);
    } else state.days[id] = data;
  } else if (kind === 'month') {
    if (deleted) delete state.months[id];
    else if (state.months[id]) {
      const m = state.months[id];
      m.goals.splice(0, m.goals.length, ...(data.goals || [])); // in place: open screens keep their reference
      Object.keys(m).forEach((k) => { if (k !== 'goals' && !(k in data)) delete m[k]; });
      Object.entries(data).forEach(([k, v]) => { if (k !== 'goals') m[k] = v; }); // e.g. reviewedAt
    } else state.months[id] = { ...data, goals: data.goals || [] };
  }
  sync.snap[key] = deleted ? TOMBSTONE : stable(data);
}

/* ---------- auth ---------- */
async function authRequest(path, body) {
  const res = await fetch(`${SB_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyAuthError(json.msg || json.message || json.error_description || json.error || `Error ${res.status}`));
  return json;
}

function friendlyAuthError(msg) {
  const m = String(msg).toLowerCase();
  if (m.includes('invalid login')) return 'Wrong email or password.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'That email already has an account. Tap "Sign in" instead.';
  if (m.includes('email not confirmed')) return 'Email confirmation is still turned on in Supabase. Turn off "Confirm email" under Authentication → Sign In / Providers.';
  if (m.includes('password') && m.includes('6')) return 'Password must be at least 6 characters.';
  if (m.includes('rate limit')) return 'Too many attempts. Wait a minute and try again.';
  return msg;
}

function storeSession(s) {
  sync.session = {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
    user: { id: s.user?.id, email: s.user?.email },
  };
  saveSync();
}

async function signUp(email, password) {
  const s = await authRequest('signup', { email, password });
  if (!s.access_token) throw new Error('Account created, but Supabase wants email confirmation. Turn off "Confirm email" under Authentication → Sign In / Providers, then tap "Sign in".');
  storeSession(s);
  await firstSync();
}

async function signIn(email, password) {
  storeSession(await authRequest('token?grant_type=password', { email, password }));
  await firstSync();
}

// If the first sync fails, sign back out so a half-finished setup can't overwrite cloud data
async function firstSync() {
  try { await afterSignIn(); }
  catch (e) { signOut(); throw new Error(`Signed in, but couldn't reach your data: ${e.message}`); }
}

function signOut() {
  const token = sync.session?.access_token;
  if (token) fetch(`${SB_URL}/auth/v1/logout`, { method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } }).catch(() => {});
  sync = { session: null, snap: {}, dirty: {}, lastSync: null, needsChoice: false };
  saveSync();
  lastError = '';
}

async function accessToken(force) {
  if (!sync.session) throw new Error('Not signed in');
  if (force || Date.now() / 1000 > sync.session.expires_at - 60) {
    try {
      storeSession(await authRequest('token?grant_type=refresh_token', { refresh_token: sync.session.refresh_token }));
    } catch (e) {
      if (!navigator.onLine) throw e;
      signOut();
      throw new Error('Your sign-in expired. Please sign in again.');
    }
  }
  return sync.session.access_token;
}

async function rest(path, opts = {}, retried) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 401 && !retried) { await accessToken(true); return rest(path, opts, true); }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    if (j.code === '42P01' || /relation .* does not exist|could not find the table/i.test(j.message || '')) throw new Error('The tally_items table is missing in Supabase. Run the setup SQL in the SQL Editor.');
    throw new Error(j.message || `Sync error ${res.status}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

async function fetchAllRows() {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rest(`tally_items?select=key,data,updated_at&order=key&limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

/* ---------- first sign-in on a device ---------- */
async function afterSignIn() {
  sync.snap = {}; sync.dirty = {}; sync.lastSync = null;
  const rows = await fetchAllRows();
  const hasLocal = Object.values(state.days).some(isLogged);
  if (!rows.length) {
    detectChanges(); // cloud is empty: everything here gets uploaded
  } else if (!hasLocal) {
    useCloud(rows);
  } else {
    sync.needsChoice = true; // both have data: ask
  }
  saveSync();
  if (!sync.needsChoice) await syncNow();
}

function useCloud(rows) {
  state.months = {}; state.days = {};
  sync.snap = {}; sync.dirty = {};
  rows.forEach((r) => applyRemote(r.key, r.data));
  writeLocal();
}

async function resolveChoice(choice) {
  const rows = await fetchAllRows();
  if (choice === 'cloud') {
    useCloud(rows);
  } else {
    // Merge: keep everything; where both have the same day/month, the cloud copy wins.
    sync.snap = {}; sync.dirty = {};
    rows.forEach((r) => applyRemote(r.key, r.data));
    writeLocal();
    detectChanges(); // anything only on this device gets uploaded
  }
  sync.needsChoice = false;
  saveSync();
  await syncNow();
}

/* ---------- the sync loop ---------- */
async function syncNow() {
  if (!sync.session || sync.needsChoice) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true; lastError = ''; updateCard();
  try {
    detectChanges();

    // Pull: apply remote rows unless this device has a newer unsent edit
    const rows = await fetchAllRows();
    let changed = false;
    for (const r of rows) {
      const remoteJson = r.data && !r.data._deleted ? stable(r.data) : TOMBSTONE;
      if (sync.snap[r.key] === remoteJson) continue;
      const localEdit = sync.dirty[r.key];
      if (localEdit && new Date(localEdit) >= new Date(r.updated_at)) continue;
      applyRemote(r.key, r.data);
      delete sync.dirty[r.key];
      changed = true;
    }
    if (changed) writeLocal();

    // Push: send this device's changes
    const items = localItems();
    const keys = Object.keys(sync.dirty);
    if (keys.length) {
      const sent = {};
      const body = keys.map((k) => {
        sent[k] = sync.dirty[k];
        return { user_id: sync.session.user.id, key: k, data: items[k] ?? { _deleted: true }, updated_at: sync.dirty[k] };
      });
      for (let i = 0; i < body.length; i += 500) {
        await rest('tally_items?on_conflict=user_id,key', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(body.slice(i, i + 500)),
        });
      }
      keys.forEach((k) => {
        sync.snap[k] = k in items ? stable(items[k]) : TOMBSTONE;
        if (sync.dirty[k] === sent[k]) delete sync.dirty[k]; // unless edited again meanwhile
      });
    }

    sync.lastSync = new Date().toISOString();
    saveSync();
    if (changed) refreshViewIfIdle();
  } catch (e) {
    lastError = navigator.onLine ? e.message : 'Offline. Will sync when you reconnect.';
  } finally {
    syncing = false;
    updateCard();
    if (syncAgain) { syncAgain = false; syncNow(); }
  }
}

function refreshViewIfIdle() {
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return; // don't yank the screen while typing
  if (location.hash.startsWith('#import')) return;
  route();
}

window.onTallySaved = () => {
  if (!sync.session || sync.needsChoice) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 1500);
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
window.addEventListener('online', () => syncNow());

/* ---------- the Sync card on the Goals tab ---------- */
let cardEl = null, lastEmail = '';
function timeAgo(iso) {
  if (!iso) return 'not yet';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function updateCard() { if (cardEl && document.body.contains(cardEl)) window.renderSyncCard(cardEl); }

window.renderSyncCard = (el) => {
  cardEl = el;
  if (!el) return;
  if (!sync.session) {
    el.innerHTML = `
      <h2>Sync</h2>
      <form class="card sync-card" id="authForm" autocomplete="on">
        <p class="help" style="margin:0 0 10px">Sign in to keep your phone and computer in sync and back up your journal.</p>
        <label class="sr-only" for="sbEmail">Email</label>
        <input id="sbEmail" type="email" autocomplete="username" placeholder="Email" value="${esc(lastEmail)}" required>
        <label class="sr-only" for="sbPass">Password</label>
        <input id="sbPass" type="password" autocomplete="current-password" placeholder="Password (6+ characters)" minlength="6" required>
        <p class="help sync-err">${esc(lastError)}</p>
        <div class="actions" style="margin-top:4px">
          <button class="btn primary" type="submit" data-act="in">Sign in</button>
          <button class="btn" type="submit" data-act="up">Create account</button>
        </div>
      </form>`;
    const form = el.querySelector('#authForm');
    let act = 'in';
    form.querySelectorAll('button[type=submit]').forEach((b) => b.addEventListener('click', () => { act = b.dataset.act; }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = el.querySelector('#sbEmail').value.trim(), pass = el.querySelector('#sbPass').value;
      lastEmail = email;
      const errEl = el.querySelector('.sync-err');
      form.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      errEl.textContent = act === 'up' ? 'Creating account…' : 'Signing in…';
      try {
        if (act === 'up') await signUp(email, pass); else await signIn(email, pass);
        lastError = '';
        if (!sync.needsChoice) { toast('Signed in. Sync is on'); route(); }
      } catch (err) {
        lastError = err.message;
      }
      window.renderSyncCard(el);
    });
    return;
  }

  if (sync.needsChoice) {
    el.innerHTML = `
      <h2>Sync</h2>
      <div class="card sync-card">
        <p style="margin:0 0 6px"><b>Your account already has data in the cloud.</b></p>
        <p class="help" style="margin:0 0 10px">This device has entries too. What should happen to them?</p>
        <div class="actions" style="margin-top:0">
          <button class="btn primary" data-choice="cloud">Use cloud data</button>
          <button class="btn" data-choice="merge">Merge both</button>
        </div>
        <p class="help" style="margin-top:8px"><b>Use cloud data</b> replaces this device's entries (best if this device only has test or older data). <b>Merge both</b> keeps everything; where both have the same day, the cloud copy wins.</p>
        <p class="help sync-err">${esc(lastError)}</p>
        <button class="btn small" data-act="out" style="margin-top:6px">Cancel and sign out</button>
      </div>`;
    el.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', async () => {
      el.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      try { await resolveChoice(b.dataset.choice); toast('Sync is on'); route(); }
      catch (err) { lastError = err.message; window.renderSyncCard(el); }
    }));
    el.querySelector('[data-act=out]').addEventListener('click', () => { signOut(); window.renderSyncCard(el); });
    return;
  }

  const pending = Object.keys(sync.dirty).length;
  const status = syncing ? 'Syncing…' : lastError ? esc(lastError) : pending ? `${pending} change${pending > 1 ? 's' : ''} waiting to sync` : `Synced ${timeAgo(sync.lastSync)}`;
  el.innerHTML = `
    <h2>Sync</h2>
    <div class="card sync-card row spread">
      <div style="min-width:0">
        <div class="sync-status"><span class="dot ${lastError ? 'err' : syncing || pending ? 'busy' : 'ok'}"></span>${status}</div>
        <div class="help" style="overflow:hidden;text-overflow:ellipsis">${esc(sync.session.user.email || '')}</div>
      </div>
      <div class="row" style="gap:6px;flex:none">
        <button class="btn small" data-act="now" ${syncing ? 'disabled' : ''}>Sync now</button>
        <button class="btn small" data-act="out">Sign out</button>
      </div>
    </div>`;
  el.querySelector('[data-act=now]').addEventListener('click', () => syncNow());
  el.querySelector('[data-act=out]').addEventListener('click', () => {
    if (!confirm('Sign out? Your entries stay on this device, but stop syncing.')) return;
    signOut(); window.renderSyncCard(el);
  });
};

/* ---------- boot ---------- */
if (sync.session) {
  if (sync.needsChoice) updateCard(); else syncNow();
  const v = document.getElementById('syncCard');
  if (v) window.renderSyncCard(v);
}
