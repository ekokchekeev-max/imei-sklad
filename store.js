/* Хранение на устройстве + синхронизация через Supabase (REST). Работает и без интернета: правки уходят в базу при первой возможности. */
(function () {
'use strict';
const LS_DATA = 'imeisklad.data.v1', LS_CFG = 'imeisklad.cfg.v1', LS_META = 'imeisklad.meta.v1';

let phones = [];
let cfg = { url: '', key: '', shop: '', seller: '' };
let meta = { lastSeq: 0, dirty: {} };
let status = { state: 'off', msg: 'Только на этом устройстве', last: 0 };
let syncing = false, pushTimer = null, poll = null;
const listeners = [];

const rd = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const emit = () => listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });
const enabled = () => !!(cfg.url && cfg.key && cfg.shop);
const persist = () => { wr(LS_DATA, phones); wr(LS_META, meta); };
const setStatus = (state, msg) => { status = { state, msg, last: status.last }; emit(); };

function newId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function init() {
  phones = rd(LS_DATA, []);
  cfg = Object.assign(cfg, rd(LS_CFG, {}));
  meta = Object.assign({ lastSeq: 0, dirty: {} }, rd(LS_META, {}));
  readInvite();
  refreshStatus();
  startPolling();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', refreshStatus);
  sync();
}

/* ссылка-приглашение: #cfg=... переносит настройки синхронизации на другое устройство */
function inviteLink() {
  const o = { u: cfg.url, k: cfg.key, s: cfg.shop };
  return location.origin + location.pathname + '#cfg=' + btoa(unescape(encodeURIComponent(JSON.stringify(o))));
}
function readInvite() {
  const m = location.hash.match(/^#cfg=(.+)$/);
  if (!m) return;
  try {
    const o = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    if (o.u && o.k && o.s) { cfg.url = o.u; cfg.key = o.k; cfg.shop = o.s; wr(LS_CFG, cfg); meta.lastSeq = 0; }
  } catch (e) {}
  history.replaceState(null, '', location.pathname + location.search);
}

function refreshStatus() {
  if (!enabled()) { status = { state: 'off', msg: 'Только на этом устройстве', last: status.last }; }
  else if (!navigator.onLine) { status = { state: 'offline', msg: 'Нет интернета, правки сохранены на устройстве', last: status.last }; }
  else if (status.state === 'off' || status.state === 'offline') { status = { state: 'idle', msg: 'Подключено', last: status.last }; }
  emit();
}

function setConfig(next) {
  const changed = next.url !== cfg.url || next.key !== cfg.key || next.shop !== cfg.shop;
  cfg = Object.assign({}, cfg, next);
  wr(LS_CFG, cfg);
  if (changed) { meta.lastSeq = 0; phones.forEach(p => { meta.dirty[p.id] = 1; }); persist(); }
  refreshStatus();
  return enabled() ? sync(true) : Promise.resolve();
}

/* ---------- данные ---------- */
const visible = () => phones.filter(p => !p.deleted);
const get = id => phones.find(p => p.id === id && !p.deleted);

function put(p) {
  p.updatedAt = Date.now();
  p.deleted = false;
  const i = phones.findIndex(x => x.id === p.id);
  if (i >= 0) phones[i] = p; else phones.push(p);
  meta.dirty[p.id] = 1;
  persist(); emit(); schedulePush();
}
function putMany(list) {
  const t = Date.now();
  list.forEach((p, n) => {
    p.updatedAt = t + n; p.deleted = false;
    const i = phones.findIndex(x => x.id === p.id);
    if (i >= 0) phones[i] = p; else phones.push(p);
    meta.dirty[p.id] = 1;
  });
  persist(); emit(); schedulePush();
}
function remove(id) {
  const p = phones.find(x => x.id === id);
  if (!p) return;
  p.deleted = true; p.updatedAt = Date.now();
  meta.dirty[id] = 1;
  persist(); emit(); schedulePush();
}

/* ---------- синхронизация ---------- */
async function rest(method, path, body, extra) {
  const r = await fetch(cfg.url.replace(/\/+$/, '') + '/rest/v1/' + path, {
    method,
    headers: Object.assign({ apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' }, extra || {}),
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error(r.status + ' ' + t.slice(0, 160)); e.status = r.status; throw e; }
  return method === 'GET' ? r.json() : null;
}
function schedulePush() {
  if (!enabled()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => sync(), 1200);
}
function startPolling() {
  clearInterval(poll);
  poll = setInterval(() => { if (!document.hidden) sync(); }, 12000);
}
function explain(e) {
  if (!navigator.onLine) return 'Нет интернета, правки сохранены на устройстве';
  if (e && (e.status === 401 || e.status === 403)) return 'Ключ не подошёл. Проверьте ключ в настройках.';
  if (e && e.status === 404) return 'В базе нет таблицы records. Выполните supabase-setup.sql.';
  if (e && /Failed to fetch|NetworkError|Load failed/i.test(e.message)) return 'Не удаётся связаться с базой. Проверьте адрес.';
  return 'Ошибка синхронизации: ' + (e && e.message ? e.message : 'неизвестно');
}
async function sync(force) {
  if (!enabled() || syncing) return;
  if (!navigator.onLine) { refreshStatus(); return; }
  syncing = true;
  setStatus('syncing', 'Синхронизация…');
  try {
    /* 1. забираем новое с сервера */
    for (let guard = 0; guard < 50; guard++) {
      const rows = await rest('GET', 'records?shop=eq.' + encodeURIComponent(cfg.shop) + '&seq=gt.' + meta.lastSeq + '&order=seq.asc&limit=500');
      if (!rows.length) break;
      phones = Core.applyRemote(phones, meta.dirty, rows);
      meta.lastSeq = rows[rows.length - 1].seq;
      if (rows.length < 500) break;
    }
    /* 2. отправляем свои правки */
    const ids = Object.keys(meta.dirty);
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200).map(id => phones.find(p => p.id === id)).filter(Boolean);
      if (!chunk.length) continue;
      const body = chunk.map(p => {
        const data = Object.assign({}, p); delete data.id; delete data.updatedAt; delete data.deleted;
        return { shop: cfg.shop, id: p.id, data, updated_at: p.updatedAt, deleted: !!p.deleted };
      });
      await rest('POST', 'records?on_conflict=shop,id', body, { Prefer: 'resolution=merge-duplicates,return=minimal' });
      chunk.forEach(p => { if (meta.dirty[p.id] && p.updatedAt === body.find(b => b.id === p.id).updated_at) delete meta.dirty[p.id]; });
    }
    status = { state: 'ok', msg: 'Синхронизировано', last: Date.now() };
    persist();
    emit();
  } catch (e) {
    status = { state: 'error', msg: explain(e), last: status.last };
    persist(); emit();
  } finally {
    syncing = false;
  }
}

window.Store = {
  init, newId, visible, get, put, putMany, remove, sync, setConfig, inviteLink,
  onChange: f => listeners.push(f),
  config: () => Object.assign({}, cfg),
  setSeller: name => { cfg.seller = name; wr(LS_CFG, cfg); emit(); },
  enabled, status: () => status, pending: () => Object.keys(meta.dirty).length
};
})();
