'use strict';
/* Talks to the Django JSON API.
   Api  = thin fetch wrapper (sessions + CSRF).
   Sync = turns "the app changed S" into small, atomic updates on the server. */

const API_BASE = (document.body && document.body.dataset.api) || '/api/';

const Api = {
  csrf() {
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  },
  async call(method, path, body, opts) {
    const o = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      o.headers['Content-Type'] = 'application/json';
      o.body = JSON.stringify(body);
    }
    if (method !== 'GET') o.headers['X-CSRFToken'] = Api.csrf();
    if (opts && opts.keepalive) o.keepalive = true;
    let r;
    try {
      r = await fetch(API_BASE + path, o);
    } catch (e) {
      const err = new Error('Can’t reach the server.');
      err.offline = true;
      throw err;
    }
    let data = null;
    try { data = await r.json(); } catch (e) { /* non-JSON body */ }
    if (!r.ok) {
      const err = new Error((data && data.error) || 'Something went wrong (' + r.status + ').');
      err.status = r.status;
      throw err;
    }
    return data;
  },
  me: () => Api.call('GET', 'auth/me/'),
  register: (username, password) => Api.call('POST', 'auth/register/', { username, password }),
  login: (username, password) => Api.call('POST', 'auth/login/', { username, password }),
  logout: () => Api.call('POST', 'auth/logout/', {}),
  state: () => Api.call('GET', 'state/'),
  sync: (changes, opts) => Api.call('POST', 'sync/', changes, opts),
  experience: () => Api.call('GET', 'xp/'),
  timer: (habit, date, action) => Api.call('POST', 'timer/', { habit, date, action }),
  healthPairing: () => Api.call('POST', 'health-connect/pairing/', {}),
  healthConnectStatus: (date, timeZone, utcOffsetMinutes) => Api.call(
    'GET',
    'health-connect/status/?' + new URLSearchParams({
      date, time_zone: timeZone, utc_offset_minutes: String(utcOffsetMinutes),
    }).toString(),
  ),
  healthConnectDisconnect: () => Api.call('POST', 'health-connect/disconnect/', {}),
};

const HABIT_FIELDS = ['id', 'name', 'icon', 'type', 'goal', 'unit', 'increment', 'freq', 'days', 'wk', 'remind', 'start', 'archived', 'demo'];

const Sync = {
  snap: null,      // what the server is known to have
  timer: 0,        // debounce timer
  retryT: 0,       // retry timer after a failure
  retryN: 0,
  cur: null,       // promise of the request in flight
  again: false,    // something changed while a request was in flight

  profileOf(s) {
    return { name: s.name, theme: s.prefs.theme, week: s.prefs.week, inapp: !!s.prefs.inapp,
             chime: !!s.prefs.chime, remind: !!s.prefs.remind, dismiss: s.dismiss || {} };
  },

  /* Canonical strings, so equal data always compares equal. */
  take(s) {
    const p = Sync.profileOf(s);
    const dm = Object.keys(p.dismiss).sort().map(k => [k, p.dismiss[k]]);
    const habits = new Map(), logs = new Map();
    s.habits.forEach(h => {
      habits.set(h.id, JSON.stringify(HABIT_FIELDS.map(k => h[k])));
      const L = s.logs[h.id] || {};
      Object.keys(L).forEach(d => logs.set(h.id + '|' + d, JSON.stringify([
        L[d].v, L[d].g, L[d].note || '', L[d].duration_seconds || 0, L[d].timer_sessions || [],
        L[d].timer_started_at || '',
      ])));
    });
    return { profile: JSON.stringify([p.name, p.theme, p.week, p.inapp, p.chime, p.remind, dm]), habits, logs };
  },

  same(a, b) {
    if (a.profile !== b.profile || a.habits.size !== b.habits.size || a.logs.size !== b.logs.size) return false;
    for (const [k, v] of a.habits) if (b.habits.get(k) !== v) return false;
    for (const [k, v] of a.logs) if (b.logs.get(k) !== v) return false;
    return true;
  },

  /* Changes between the server's copy (Sync.snap) and `cur`, which was taken from state `s`. */
  diff(cur, s) {
    const old = Sync.snap, out = { habits: [], deleted: [], logs: [] };
    let any = false;
    if (cur.profile !== old.profile) { out.profile = Sync.profileOf(s); any = true; }
    s.habits.forEach(h => {
      if (old.habits.get(h.id) !== cur.habits.get(h.id)) {
        out.habits.push(HABIT_FIELDS.reduce((o, k) => (o[k] = h[k], o), {}));
        any = true;
      }
    });
    old.habits.forEach((_, id) => { if (!cur.habits.has(id)) { out.deleted.push(id); any = true; } });
    cur.logs.forEach((j, key) => {
      if (old.logs.get(key) === j) return;
      const i = key.indexOf('|'), e = JSON.parse(j);
      out.logs.push({
        habit: key.slice(0, i), date: key.slice(i + 1), v: e[0], g: e[1],
        note: e[2], duration_seconds: e[3], timer_sessions: e[4], timer_started_at: e[5],
      });
      any = true;
    });
    old.logs.forEach((_, key) => {
      if (cur.logs.has(key)) return;
      const i = key.indexOf('|'), hid = key.slice(0, i);
      if (cur.habits.has(hid)) { out.logs.push({ habit: hid, date: key.slice(i + 1), delete: true }); any = true; }
    });
    return any ? out : null;
  },

  reset() {
    clearTimeout(Sync.timer);
    clearTimeout(Sync.retryT);
    Sync.retryN = 0;
    Sync.snap = Sync.take(S);
  },

  /* Called by save() after every change in the app. */
  touch() {
    if (ui.boot !== 'ready' || !Sync.snap) return;
    clearTimeout(Sync.timer);
    Sync.timer = setTimeout(() => { Sync.timer = 0; Sync.flush(); }, 200);
  },

  flush() {
    clearTimeout(Sync.timer);
    Sync.timer = 0;
    if (Sync.cur) { Sync.again = true; return Sync.cur; }
    Sync.cur = Sync.run().finally(() => {
      Sync.cur = null;
      if (Sync.again) { Sync.again = false; Sync.flush(); }
    });
    return Sync.cur;
  },

  async run() {
    if (ui.boot !== 'ready' || !Sync.snap) return;
    const cur = Sync.take(S), d = Sync.diff(cur, S);
    if (!d) { setSyncFail(false); return; }
    let csrfRetried = false;
    for (;;) {
      try {
        const result = await Api.sync(d);
        Sync.snap = cur;
        Sync.retryN = 0;
        setSyncFail(false);
        if (result.xp && JSON.stringify(result.xp) !== JSON.stringify(S.xp)) {
          const previousLevel = S.xp.level;
          S.xp = result.xp;
          if (ui.boot === 'ready') render();
          if (result.xp_gained > 0) {
            toast(result.xp.level > previousLevel
              ? 'Level up! Level ' + result.xp.level + ' · +' + result.xp_gained + ' XP'
              : '+' + result.xp_gained + ' XP earned');
          }
        }
        return;
      } catch (e) {
        if (e.status === 403 && !csrfRetried) {   // stale CSRF token: fetch a fresh one once
          csrfRetried = true;
          try { await Api.me(); } catch (_) { /* fall through to retry */ }
          continue;
        }
        if (e.status === 401) { sessionLost(); return; }
        setSyncFail(true, e.offline ? '' : e.message);
        if (e.offline || e.status >= 500) Sync.retry();
        return;
      }
    }
  },

  retry() {
    clearTimeout(Sync.retryT);
    const ms = Math.min(30000, 2000 * Math.pow(2, Sync.retryN++));
    Sync.retryT = setTimeout(() => Sync.flush(), ms);
  },

  /* When the tab becomes visible again, pick up changes made on another device,
     but only if this device has nothing waiting to be saved. */
  async pull() {
    const quiet = () => ui.boot === 'ready' && Sync.snap && !Sync.cur && !Sync.timer && !ui.sheet &&
                        !Sync.diff(Sync.take(S), S);
    if (document.hidden || !quiet()) return;
    let st;
    try { st = await Api.state(); } catch (e) { return; }
    if (!quiet()) return;
    const dateChanged = acceptServerToday(st.today);
    const n = fromServer(st), t = Sync.take(n);
    if (Sync.same(t, Sync.snap)) {
      const xpChanged = JSON.stringify(S.xp) !== JSON.stringify(n.xp);
      const previousXp = S.xp.total, previousLevel = S.xp.level;
      if (xpChanged) S.xp = n.xp;
      if (dateChanged || xpChanged) render();
      if (xpChanged && n.xp.total > previousXp) {
        const gained = n.xp.total - previousXp;
        toast(n.xp.level > previousLevel
          ? 'Level up! Level ' + n.xp.level + ' · +' + gained + ' XP'
          : '+' + gained + ' XP earned');
      }
      return;
    }
    S = n;
    Sync.snap = t;
    theme();
    render();
  },
};

/* Last chance to send pending changes when the page is closed. */
window.addEventListener('pagehide', () => {
  if (ui.boot !== 'ready' || !Sync.snap) return;
  const d = Sync.diff(Sync.take(S), S);
  if (d) Api.sync(d, { keepalive: true }).catch(() => {});
});
