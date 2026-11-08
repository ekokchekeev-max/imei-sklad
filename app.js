/* Интерфейс приложения «Имей Склад». */
(function () {
'use strict';
const C = Core;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAY = { cash: 'Наличные', bank: 'Перевод', inst: 'Рассрочка' };
const TITLES = { home: 'Сводка', scan: 'Сканер IMEI', stock: 'Склад', sales: 'Продажи', inst: 'Рассрочки', stats: 'Аналитика', settings: 'Настройки' };

let view = 'home', hperiod = 'month', scanState = null, chartKey = null, period = '30', importPending = null, torchOn = false, installEvt = null;
const phones = () => Store.visible();
const stock = () => phones().filter(p => !C.isSold(p));
const sold = () => phones().filter(C.isSold);
const find = q => C.findPhones(phones(), q);

let tt;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 3800); }
function setStatus(msg, busy) { $('#scan-status').innerHTML = (busy ? '<span class="spin"></span>' : '') + '<span>' + esc(msg || '') + '</span>'; }

/* ---------- списки ---------- */
function item(p) {
  const s = C.isSold(p);
  const who = s ? (p.sale.buyer || '') : (p.supplier || '');
  const date = C.dmy(s ? p.sale.date : p.date);
  const sub = [p.color, 'IMEI …' + p.imei.slice(-5), who, date].filter(Boolean).join(' · ');
  let r, rs, cls = '';
  if (s) { const pr = C.profitOf(p); r = C.fmt(p.sale.price); rs = (pr < 0 ? '−' : '+') + C.fmt(Math.abs(pr)); }
  else { const d = C.daysBetween(p.date, C.today()); r = C.fmt(p.cost); rs = d + ' дн.'; if (d > 45) cls = ' warn'; }
  return '<li><button class="item" type="button" data-open="' + esc(p.id) + '"><span class="t">' + esc(p.model) + '</span><span class="s">' + esc(sub) + '</span>' +
    '<span class="c">' + esc(p.color || '') + '</span><span class="i mono">…' + esc(p.imei.slice(-5)) + '</span><span class="sp">' + esc(who || '—') + '</span><span class="d num">' + date + '</span>' +
    '<span class="r num">' + r + '</span><span class="rs num' + cls + '">' + rs + '</span></button></li>';
}
const head = cols => '<li class="lhead">' + cols.map(c => '<span>' + c + '</span>').join('') + '</li>';
const HEAD_STOCK = head(['Модель', 'Цвет', 'IMEI', 'Поставщик', 'Приход', 'Закупка', 'На складе']);
const HEAD_SALES = head(['Модель', 'Цвет', 'IMEI', 'Покупатель', 'Продан', 'Цена', 'Прибыль']);

function renderSummary() {
  const s = stock();
  $('#mini').innerHTML = 'На складе <b>' + s.length + ' шт.</b> на ' + C.fmt(C.sum(s.map(p => p.cost))) + ' по закупке';
  const ms = Array.from(new Set(phones().map(C.nameOf))).sort();
  $('#dl-models').innerHTML = ms.map(m => '<option value="' + esc(m) + '">').join('');
  const sp = Array.from(new Set(['Скупка'].concat(phones().map(p => p.supplier).filter(Boolean))));
  $('#dl-sup').innerHTML = sp.map(m => '<option value="' + esc(m) + '">').join('');
}
function renderScan() {
  const res = $('#scan-result');
  if (!scanState) res.innerHTML = '';
  else {
    const { q, matches, hints, warn } = scanState;
    let h = '';
    if (warn) h += '<p class="hint warn">' + esc(warn) + '</p>';
    if (!matches.length) {
      h += '<div class="card big"><div class="model">Такого IMEI нет на складе</div><div class="meta"><span class="mono">' + esc(q) + '</span></div>' +
        (q.length === 15 ? '<div class="actions"><button class="btn" type="button" data-intake="' + esc(q) + '">Оформить приход</button></div>' : '<p class="hint">Чтобы оформить приход, нужен полный IMEI из 15 цифр.</p>') + '</div>';
    } else {
      h += matches.map(p => {
        const s = C.isSold(p);
        const fix = (q.length === 15 && p.imei.length < 15) ? '<button class="btn ghost" type="button" data-fullimei="' + esc(p.id) + '">Записать полный IMEI</button>' : '';
        return '<div class="card big"><div class="model">' + esc(p.model) + ' <span class="pill' + (s ? ' sold' : '') + '">' + (s ? 'продан' : 'на складе') + '</span></div>' +
          '<div class="meta"><span class="mono">' + esc(p.imei) + '</span>' + (p.color ? '<span>' + esc(p.color) + '</span>' : '') + '<span>' + esc(p.supplier || '') + '</span><span>приход ' + C.dmy(p.date) + '</span><span class="num">закупка ' + C.fmt(p.cost) + '</span></div>' +
          '<div class="actions">' + (s ? '' : '<button class="btn" type="button" data-sell="' + esc(p.id) + '">Продать</button>') + '<button class="btn ghost" type="button" data-open="' + esc(p.id) + '">Подробнее</button>' + fix + '</div></div>';
      }).join('');
    }
    res.innerHTML = h;
  }
  const rec = phones().map(p => ({ p, t: C.isSold(p) ? p.sale.date : p.date, u: p.updatedAt || 0 }))
    .sort((a, b) => a.t < b.t ? 1 : a.t > b.t ? -1 : b.u - a.u).slice(0, 6).map(x => x.p);
  $('#recent').innerHTML = rec.length ? rec.map(item).join('') : '<li class="empty">Операций пока нет. Нажмите «Сканировать камерой» и наведите на штрихкод IMEI: приход оформится за пару касаний.</li>';
}
function renderStock() {
  const q = $('#q-stock').value.trim().toLowerCase();
  const list = stock().filter(p => !q || (p.model + ' ' + p.imei + ' ' + (p.supplier || '') + ' ' + (p.color || '')).toLowerCase().includes(q)).sort((a, b) => a.date < b.date ? 1 : -1);
  $('#stock-sum').innerHTML = '<b>' + list.length + ' шт.</b> · ' + C.fmt(C.sum(list.map(p => p.cost))) + ' по закупке';
  $('#stock-list').innerHTML = list.length ? HEAD_STOCK + list.map(item).join('') : '<li class="empty">' + (q ? 'По запросу ничего не найдено.' : 'Склад пуст. Нажмите «Новый приход» или отсканируйте IMEI.') + '</li>';
}
function renderSales() {
  const all = sold();
  const months = Array.from(new Set(all.map(p => p.sale.date.slice(0, 7)))).sort().reverse();
  const sel = $('#sales-month'), cur = sel.value;
  const opts = '<option value="">Все месяцы</option>' + months.map(m => '<option value="' + m + '">' + m.slice(5) + '.' + m.slice(0, 4) + '</option>').join('');
  if (sel.dataset.o !== opts) { sel.innerHTML = opts; sel.dataset.o = opts; sel.value = months.includes(cur) ? cur : ''; }
  const m = sel.value;
  const list = all.filter(p => !m || p.sale.date.startsWith(m)).sort((a, b) => a.sale.date < b.sale.date ? 1 : -1);
  const S = C.summarize(list);
  $('#sales-sum').innerHTML = '<b>' + list.length + ' шт.</b> · выручка ' + C.fmt(S.revenue) + ' · прибыль <b>' + C.fmt(S.profit) + '</b>';
  $('#sales-list').innerHTML = list.length ? HEAD_SALES + list.map(item).join('') : '<li class="empty">Продаж за этот период нет.</li>';
}
function renderInst() {
  const all = sold().filter(p => p.sale.pay === 'inst');
  const t = C.today(), soon = C.addDays(t, 7);
  const open = all.filter(p => C.remaining(p) > 0).sort((a, b) => a.sale.payments.find(x => !x.paid).d < b.sale.payments.find(x => !x.paid).d ? -1 : 1);
  const closed = all.filter(p => C.remaining(p) === 0).sort((a, b) => a.sale.date < b.sale.date ? 1 : -1);
  const debt = C.sum(open.map(C.remaining));
  const late = C.sum(open.map(p => C.sum(p.sale.payments.filter(x => !x.paid && x.d < t).map(x => x.a))));
  $('#inst-sum').innerHTML = 'Долг <b>' + C.fmt(debt) + '</b> · просрочено <b class="' + (late ? 'bad' : '') + '">' + C.fmt(late) + '</b> · договоров в работе <b>' + open.length + '</b>';
  const card = p => {
    const rem = C.remaining(p);
    const pays = p.sale.payments.map((x, i) => {
      const c = x.paid ? 'paid' : x.d < t ? 'late' : x.d <= soon ? 'soon' : '';
      return '<button class="pay ' + c + '" type="button" data-pay="' + esc(p.id) + ':' + i + '" aria-pressed="' + (x.paid ? 'true' : 'false') + '" title="' + (x.paid ? 'Отметить как неоплаченный' : 'Отметить оплату') + '">' + C.dmy(x.d) + ' · ' + C.fmt(x.a) + '</button>';
    }).join('');
    return '<article class="card inst"><div class="head"><div><b>' + esc(p.sale.buyer || 'Без имени') + '</b><div class="sub">' + esc(p.sale.contact || '') + '</div></div><div class="num" style="text-align:right"><b>' + (rem ? 'Остаток ' + C.fmt(rem) : 'Закрыта') + '</b></div></div>' +
      '<div class="sub">' + esc(p.model) + ' · продано ' + C.dmy(p.sale.date) + ' за ' + C.fmt(p.sale.price) + ' · взнос ' + C.fmt(p.sale.first || 0) + '</div><div class="pays">' + pays + '</div></article>';
  };
  let h = open.map(card).join('');
  if (closed.length) h += '<h2 style="margin-top:6px">Закрытые</h2>' + closed.map(card).join('');
  $('#inst-list').innerHTML = h || '<p class="empty">Рассрочек нет. При продаже выберите способ оплаты «Рассрочка», и график платежей появится здесь.</p>';
}

/* ---------- аналитика ---------- */
const niceMax = v => { const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
function barChart(el, bk) {
  const items = bk.items, n = items.length;
  if (!items.some(i => i.revenue > 0)) { el.innerHTML = '<p class="empty" style="padding:8px 0">За выбранный период продаж нет.</p>'; return; }
  const W = Math.max(300, el.clientWidth || 600), H = 220, L = 54, R = 8, T = 12, B = 30;
  const top = niceMax(Math.max.apply(null, items.map(i => i.revenue)));
  const ph = H - T - B, slot = (W - L - R) / n, bw = Math.max(2, slot * 0.72);
  const Y = v => T + (1 - v / top) * ph;
  let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Выручка и прибыль по периодам">';
  [0, top / 2, top].forEach(v => { s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + C.fmtK(v) + '</text>'; });
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 52))));
  items.forEach((b, i) => {
    const x = L + i * slot + (slot - bw) / 2, hr = b.revenue / top * ph, hp = Math.max(0, b.profit) / top * ph, bx = x + bw * 0.225;
    s += '<g><title>' + esc(b.label + ': выручка ' + C.fmt(b.revenue) + ', прибыль ' + C.fmt(b.profit) + ', ' + b.count + ' шт.') + '</title><rect x="' + (L + i * slot) + '" y="' + T + '" width="' + slot + '" height="' + ph + '" fill="transparent"/>' +
      (hr > 0 ? '<rect class="rev" x="' + x.toFixed(1) + '" y="' + (T + ph - hr).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hr.toFixed(1) + '" rx="2"/>' : '') +
      (hp > 0 ? '<rect class="prof" x="' + bx.toFixed(1) + '" y="' + (T + ph - hp).toFixed(1) + '" width="' + (bw * 0.55).toFixed(1) + '" height="' + hp.toFixed(1) + '" rx="1.5"/>' : '') + '</g>';
    if (i % step === 0) s += '<text x="' + (L + i * slot + slot / 2).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + b.label + '</text>';
  });
  el.innerHTML = s + '</svg>';
}
function table(el, cols, rows, empty) {
  el.innerHTML = rows.length ? '<thead><tr>' + cols.map((c, i) => '<th' + (i ? ' class="n"' : '') + '>' + c + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map((c, i) => '<td' + (i ? ' class="n"' : '') + '>' + c + '</td>').join('') + '</tr>').join('') + '</tbody>' : '<tbody><tr><td class="sub">' + empty + '</td></tr></tbody>';
}
function renderStats() {
  $$('#period .seg').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === period)));
  const all = sold(), t = C.today();
  const rg = C.periodRange(period, all, t), from = rg[0], to = rg[1];
  const inP = all.filter(p => p.sale.date >= from && p.sale.date <= to);
  const S = C.summarize(inP);
  $('#kpi').innerHTML =
    '<div><dt>Выручка</dt><dd>' + C.fmt(S.revenue) + '</dd><dd class="s2">' + S.count + ' продаж · с ' + C.dmy(from) + '</dd></div>' +
    '<div><dt>Прибыль</dt><dd>' + C.fmt(S.profit) + '</dd><dd class="s2">наценка ' + Math.round(S.margin) + '% к закупке</dd></div>' +
    '<div><dt>Средний чек</dt><dd>' + C.fmt(S.avgCheck) + '</dd><dd class="s2">на один телефон</dd></div>' +
    '<div><dt>До продажи</dt><dd>' + (S.count ? Math.round(S.avgDays) : '—') + ' дн.</dd><dd class="s2">в среднем на складе</dd></div>';
  const stk = stock(), debt = C.sum(sold().filter(p => p.sale.pay === 'inst').map(C.remaining));
  $('#stat-sum').innerHTML = 'Сейчас на складе <b>' + stk.length + ' шт.</b> на ' + C.fmt(C.sum(stk.map(p => p.cost))) + ' · долг по рассрочкам <b>' + C.fmt(debt) + '</b>';
  barChart($('#bars'), C.buckets(inP, from, to));
  table($('#t-top'), ['Модель', 'Шт', 'Выручка', 'Прибыль', 'Наценка'], C.groupSales(inP, C.nameOf).slice(0, 8).map(r => [esc(r.key), r.count, C.fmt(r.revenue), C.fmt(r.profit), Math.round(r.margin) + '%']), 'За период продаж нет.');
  table($('#t-pay'), ['Оплата', 'Шт', 'Выручка', 'Прибыль'], C.groupSales(inP, p => PAY[p.sale.pay] || 'Другое').map(r => [esc(r.key), r.count, C.fmt(r.revenue), C.fmt(r.profit)]), 'За период продаж нет.');
  table($('#t-sell'), ['Продавец', 'Шт', 'Выручка', 'Прибыль'], C.groupSales(inP, p => p.sale.by || 'Не указан').map(r => [esc(r.key), r.count, C.fmt(r.revenue), C.fmt(r.profit)]), 'За период продаж нет.');
  const stale = stk.filter(p => C.daysBetween(p.date, t) > 45).sort((a, b) => a.date < b.date ? -1 : 1).slice(0, 10);
  $('#stale').innerHTML = stale.length ? HEAD_STOCK + stale.map(item).join('') : '<li class="empty">Залежавшегося товара нет.</li>';

  /* цены по моделям */
  const g = {};
  phones().forEach(p => { const k = C.keyOf(p); (g[k] = g[k] || { name: C.nameOf(p), items: [] }).items.push(p); });
  const rows = Object.keys(g).map(k => {
    const it = g[k].items, costs = it.map(p => p.cost), so = it.filter(C.isSold);
    return { k, name: g[k].name, n: it.length, avgC: C.avg(costs), min: Math.min.apply(null, costs), max: Math.max.apply(null, costs),
      sn: so.length, avgS: C.avg(so.map(p => p.sale.price)), avgP: C.avg(so.map(C.profitOf)), days: C.avg(so.map(p => C.daysBetween(p.date, p.sale.date))) };
  }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  if (!rows.find(r => r.k === chartKey)) chartKey = (rows.find(r => r.n > 1) || rows[0] || {}).k || null;
  const dash = '<span class="sub">—</span>';
  $('#t-models').innerHTML = rows.length ?
    '<thead><tr><th>Модель</th><th class="n">Закуплено</th><th class="n">Закупка, ср.</th><th class="n">Мин – макс</th><th class="n">Продано</th><th class="n">Продажа, ср.</th><th class="n">Прибыль, ср.</th><th class="n">Дней до продажи</th></tr></thead><tbody>' +
    rows.map(r => '<tr aria-selected="' + (r.k === chartKey) + '"><td><button class="linkish" type="button" data-model="' + esc(r.k) + '">' + esc(r.name) + '</button></td><td class="n">' + r.n + '</td><td class="n">' + C.fmt(r.avgC) + '</td><td class="n">' + (r.min === r.max ? C.fmt(r.min) : C.fmtK(r.min) + ' – ' + C.fmtK(r.max)) + '</td><td class="n">' + r.sn + '</td><td class="n">' + (r.sn ? C.fmt(r.avgS) : dash) + '</td><td class="n">' + (r.sn ? C.fmt(r.avgP) : dash) + '</td><td class="n">' + (r.sn ? Math.round(r.days) : dash) + '</td></tr>').join('') + '</tbody>'
    : '<tbody><tr><td class="sub">Данных пока нет. Таблица появится после первых приходов.</td></tr></tbody>';
  drawModelChart(rows.find(r => r.k === chartKey));
  const sg = {};
  phones().forEach(p => { const k = p.supplier || 'Без поставщика'; (sg[k] = sg[k] || []).push(p); });
  const sr = Object.keys(sg).map(k => { const it = sg[k], so = it.filter(C.isSold); return { k, n: it.length, avgC: C.avg(it.map(p => p.cost)), sn: so.length, avgP: C.avg(so.map(C.profitOf)) }; }).sort((a, b) => b.n - a.n);
  table($('#t-sup'), ['Поставщик', 'Закуплено', 'Закупка, ср.', 'Продано', 'Прибыль, ср.'], sr.map(r => [esc(r.k), r.n, C.fmt(r.avgC), r.sn, r.sn ? C.fmt(r.avgP) : '—']), 'Поставщиков пока нет.');
}
function drawModelChart(r) {
  const card = $('#chart-card');
  if (!r) { card.hidden = true; return; }
  card.hidden = false; $('#chart-title').textContent = r.name;
  const pts = [];
  phones().filter(p => C.keyOf(p) === r.k).forEach(p => { pts.push({ t: +C.parseISO(p.date), v: p.cost, k: 'b' }); if (C.isSold(p)) pts.push({ t: +C.parseISO(p.sale.date), v: p.sale.price, k: 's' }); });
  const el = $('#chart-box');
  const W = Math.max(300, el.clientWidth || 600), H = 180, L = 54, R = 12, T = 12, B = 28;
  let t0 = Math.min.apply(null, pts.map(x => x.t)), t1 = Math.max.apply(null, pts.map(x => x.t)); if (t0 === t1) { t0 -= 864e5 * 3; t1 += 864e5 * 3; }
  let v0 = Math.min.apply(null, pts.map(x => x.v)), v1 = Math.max.apply(null, pts.map(x => x.v));
  const pv = (v1 - v0) * 0.1 || v1 * 0.05 || 1; v0 -= pv; v1 += pv;
  const X = t => L + (t - t0) / (t1 - t0) * (W - L - R), Y = v => T + (1 - (v - v0) / (v1 - v0)) * (H - T - B);
  let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Закупочные и продажные цены: ' + esc(r.name) + '">';
  [v0, (v0 + v1) / 2, v1].forEach(v => { s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + C.fmtK(v) + '</text>'; });
  const buys = pts.filter(x => x.k === 'b').sort((a, b) => a.t - b.t);
  if (buys.length > 1) s += '<polyline class="buy" points="' + buys.map(x => X(x.t).toFixed(1) + ',' + Y(x.v).toFixed(1)).join(' ') + '"/>';
  buys.forEach(x => { s += '<circle class="dotbuy" cx="' + X(x.t).toFixed(1) + '" cy="' + Y(x.v).toFixed(1) + '" r="4"/>'; });
  pts.filter(x => x.k === 's').forEach(x => { s += '<circle class="dotsell" cx="' + X(x.t).toFixed(1) + '" cy="' + Y(x.v).toFixed(1) + '" r="4"/>'; });
  const d0 = C.iso(new Date(Math.min.apply(null, pts.map(x => x.t)))), d1 = C.iso(new Date(Math.max.apply(null, pts.map(x => x.t))));
  s += '<text x="' + L + '" y="' + (H - 8) + '" text-anchor="start">' + C.dmy(d0) + '</text>';
  if (d1 !== d0) s += '<text x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end">' + C.dmy(d1) + '</text>';
  el.innerHTML = s + '</svg>';
}


/* ---------- сводка ---------- */
function renderHome() {
  $$('#hperiod .seg').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === hperiod)));
  const t = C.today(), all = sold();
  let from = t;
  if (hperiod === 'month') from = t.slice(0, 8) + '01';
  else if (hperiod === '7') from = C.addDays(t, -6);
  else if (hperiod === 'all') from = '0000-01-01';
  const inP = all.filter(p => p.sale.date >= from && p.sale.date <= t);
  const S = C.summarize(inP);
  const label = { 1: 'сегодня', 7: 'за 7 дней', month: 'за этот месяц', all: 'за всё время' }[hperiod];
  $('#hero').innerHTML = '<span class="l">Прибыль · ' + label + '</span><span class="v num">' + C.fmt(S.profit) + '</span><span class="s">' +
    (S.count ? 'наценка ' + Math.round(S.margin) + '% · в среднем ' + C.fmt(S.profit / S.count) + ' с телефона' : 'продаж за этот период пока нет') + '</span>';
  const stk = stock();
  $('#hkpi').innerHTML =
    '<div><dt>Выручка</dt><dd>' + C.fmt(S.revenue) + '</dd><dd class="s2">' + (S.count ? 'средний чек ' + C.fmt(S.avgCheck) : 'сом') + '</dd></div>' +
    '<div><dt>Продано</dt><dd>' + S.count + ' шт.</dd><dd class="s2">' + label + '</dd></div>' +
    '<div><dt>На складе</dt><dd>' + stk.length + ' шт.</dd><dd class="s2">в товаре ' + C.fmt(C.sum(stk.map(p => p.cost))) + '</dd></div>' +
    '<div><dt>Продаётся в среднем за</dt><dd>' + (S.count ? Math.round(S.avgDays) + ' дн.' : '—') + '</dd><dd class="s2">от прихода до продажи</dd></div>';
  const stale = stk.filter(p => C.daysBetween(p.date, t) > 45);
  const open = all.filter(p => p.sale.pay === 'inst' && C.remaining(p) > 0);
  const lateAmt = C.sum(open.map(p => C.sum(p.sale.payments.filter(x => !x.paid && x.d < t).map(x => x.a))));
  const lateN = open.filter(p => p.sale.payments.some(x => !x.paid && x.d < t)).length;
  const soon = C.addDays(t, 7);
  const soonAmt = C.sum(open.map(p => C.sum(p.sale.payments.filter(x => !x.paid && x.d >= t && x.d <= soon).map(x => x.a))));
  let a = '';
  if (lateN) a += '<button class="row bad" type="button" data-go="inst"><span>Просроченные платежи: ' + lateN + ' чел.</span><b>' + C.fmt(lateAmt) + '</b></button>';
  if (soonAmt) a += '<button class="row" type="button" data-go="inst"><span>Платежи в ближайшие 7 дней</span><b>' + C.fmt(soonAmt) + '</b></button>';
  if (stale.length) a += '<button class="row" type="button" data-go="stock"><span>Лежит больше 45 дней: ' + stale.length + ' шт.</span><b>' + C.fmt(C.sum(stale.map(p => p.cost))) + '</b></button>';
  $('#attn').innerHTML = a || '<div class="ok">Всё в порядке: просрочек и залежавшегося товара нет.</div>';
  table($('#h-top'), ['Модель', 'Шт', 'Прибыль'], C.groupSales(inP, C.nameOf).slice(0, 5).map(r => [esc(r.key), r.count, C.fmt(r.profit)]), 'За период продаж нет.');
  const rec = all.slice().sort((x, y) => x.sale.date < y.sale.date ? 1 : -1).slice(0, 5);
  $('#h-recent').innerHTML = rec.length ? HEAD_SALES + rec.map(item).join('') : '<li class="empty">Продаж пока нет.</li>';
}

/* ---------- установка ---------- */
function renderInstall() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const top = $('#btn-install-top'), bn = $('#install-banner'), set = $('#btn-install');
  let dismissed = false; try { dismissed = localStorage.getItem('imeisklad.instdismiss') === '1'; } catch (e) {}
  top.hidden = standalone || !installEvt; if (set) set.hidden = standalone || !installEvt;
  if (standalone || dismissed) { bn.hidden = true; return; }
  let txt, btn = '';
  if (installEvt) { txt = 'Установите приложение: оно откроется с экрана как обычное, будет работать быстрее и без адресной строки.'; btn = '<button class="btn small" type="button" data-act="install">Установить</button>'; }
  else if (ios) txt = 'Чтобы установить на iPhone: откройте эту страницу в Safari, нажмите «Поделиться» (квадрат со стрелкой), затем «На экран Домой».';
  else txt = 'Установка: в Chrome или Edge нажмите значок установки в адресной строке или меню ⋮ → «Установить приложение».';
  bn.innerHTML = '<p><b>Установить на устройство</b></p><p>' + txt + '</p><div class="actions">' + btn + '<button class="btn ghost small" type="button" data-act="hide-install">Скрыть</button></div>';
  bn.hidden = false;
}

/* ---------- настройки ---------- */
function renderSyncChip() {
  const st = Store.status(), chip = $('#sync-chip');
  chip.className = 'chip ' + st.state;
  const pend = Store.pending();
  chip.textContent = st.state === 'ok' ? 'Синхронизировано' : st.state === 'syncing' ? 'Синхронизация…' : st.state === 'error' ? 'Ошибка синхронизации' : st.state === 'offline' ? 'Без интернета' : st.state === 'idle' ? 'Подключено' : 'Только на этом устройстве';
  if (pend && Store.enabled()) chip.textContent += ' · ждёт ' + pend;
  chip.title = st.msg;
  const ss = $('#set-status');
  ss.className = 'hint ' + (st.state === 'ok' ? 'ok' : st.state === 'error' ? 'bad' : '');
  ss.textContent = st.msg + (st.last ? ' (последний раз в ' + new Date(st.last).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ')' : '');
  $('#invite-box').hidden = !Store.enabled();
  if (Store.enabled()) $('#invite').textContent = Store.inviteLink();
}
function fillSettings() {
  const c = Store.config();
  $('#set-seller').value = c.seller || '';
  $('#set-url').value = c.url || ''; $('#set-key').value = c.key || ''; $('#set-shop').value = c.shop || '';
  let th = 'auto'; try { th = localStorage.getItem('imeisklad.theme') || 'auto'; } catch (e) {}
  $('#set-theme').value = th;
  renderSyncChip();
}
function applyTheme(th) {
  if (th === 'light' || th === 'dark') document.documentElement.setAttribute('data-theme', th); else document.documentElement.removeAttribute('data-theme');
  const dark = th === 'dark' || (th !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#11140b' : '#b9ec1f');
}
function randomCode() { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join(''); }

function renderImport() {
  const box = $('#imp-box');
  if (!importPending) { box.innerHTML = ''; return; }
  const p = importPending;
  box.innerHTML = '<p class="hint">Найдено телефонов: <b>' + p.items.length + '</b>' + (p.dups ? ', уже есть в базе: ' + p.dups : '') + (p.skipped ? ', пропущено строк без модели, IMEI или цены: ' + p.skipped : '') + '.</p>' +
    '<div class="actions" style="margin-top:8px"><button class="btn small" id="imp-go" type="button"' + (p.items.length ? '' : ' disabled') + '>Импортировать</button><button class="btn ghost small" id="imp-cancel" type="button">Отмена</button></div>';
  $('#imp-cancel').onclick = () => { importPending = null; renderImport(); };
  $('#imp-go').onclick = () => {
    Store.putMany(p.items.map(x => Object.assign({ id: Store.newId(), createdAt: Date.now() }, x)));
    toast('Импортировано: ' + p.items.length); importPending = null; renderImport();
  };
}

/* ---------- каркас ---------- */
function render() {
  renderSyncChip();
  renderSummary();
  renderInstall();
  ({ home: renderHome, scan: renderScan, stock: renderStock, sales: renderSales, inst: renderInst, stats: renderStats, settings: () => {} })[view]();
}
function setView(v) {
  view = v;
  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.v === v)));
  Object.keys(TITLES).forEach(k => { $('#v-' + k).hidden = k !== v; });
  $('#page-title').textContent = TITLES[v];
  $('#top-title').textContent = (v === 'scan' || v === 'home') ? 'Имей Склад' : TITLES[v];
  if (v !== 'scan') closeCamera();
  if (v === 'settings') fillSettings();
  render(); window.scrollTo(0, 0);
}

/* ---------- окна ---------- */
const ov = $('#ov'), sheet = $('#sheet-body');
function openSheet(html, mount) { sheet.innerHTML = html; ov.hidden = false; document.body.style.overflow = 'hidden'; if (mount) mount(); const a = sheet.querySelector('[data-af]'); if (a) a.focus(); }
function closeSheet() { ov.hidden = true; sheet.innerHTML = ''; document.body.style.overflow = ''; }
ov.addEventListener('click', e => { if (e.target === ov) closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ov.hidden) closeSheet(); });
function twoStep(btn, label, fn) {
  let armed = false, t; const orig = btn.textContent;
  btn.addEventListener('click', () => {
    if (!armed) { armed = true; btn.textContent = label; t = setTimeout(() => { armed = false; btn.textContent = orig; }, 4000); return; }
    clearTimeout(t); fn();
  });
}
function imeiHint(v, selfId, short) {
  const q = v.replace(/\D/g, '');
  if (!q) return ['hint', 'Введите IMEI. Он на коробке или после набора *#06#.'];
  const dup = phones().find(p => p.id !== selfId && q.length === 15 && p.imei === q);
  if (dup) return ['hint bad', 'Этот IMEI уже есть: ' + dup.model + (C.isSold(dup) ? ' (продан)' : ' (на складе)') + '.'];
  if (q.length === 15) return C.luhn(q) ? ['hint ok', '15 цифр, контрольная сумма сошлась.'] : ['hint warn', '15 цифр, но контрольная сумма не сошлась. Проверьте цифры.'];
  if (short && q.length >= 4) return ['hint warn', 'Короткий IMEI (' + q.length + ' цифр). Лучше записать полный.'];
  return ['hint', 'Введено ' + q.length + ' из 15 цифр.'];
}
function openIntake(existing, hints) {
  hints = hints || {};
  const v = existing || { date: C.today(), model: hints.model || '', color: hints.color || '', imei: hints.imei || '', supplier: 'Скупка', cost: '', note: '' };
  openSheet('<h2 class="title" id="sheet-title">' + (existing ? 'Изменить телефон' : 'Новый приход') + '</h2>' +
    '<form id="f-intake" class="form" novalidate>' +
    '<label><span class="l">Телефон</span><input id="f-model" list="dl-models" value="' + esc(v.model) + '" placeholder="iPhone 14 128GB 86%" data-af></label>' +
    '<div class="two"><label><span class="l">Цвет</span><input id="f-color" value="' + esc(v.color || '') + '"></label><label><span class="l">Дата прихода</span><input id="f-date" type="date" value="' + esc(v.date) + '"></label></div>' +
    '<label><span class="l">IMEI</span><input id="f-imei" class="mono" inputmode="numeric" autocomplete="off" value="' + esc(v.imei) + '"></label><p id="f-hint" class="hint"></p>' +
    '<div class="two"><label><span class="l">Поставщик</span><input id="f-sup" list="dl-sup" value="' + esc(v.supplier || '') + '"></label><label><span class="l">Закупка, сом</span><input id="f-cost" inputmode="numeric" value="' + esc(v.cost) + '"></label></div>' +
    '<label><span class="l">Заметка</span><input id="f-note" value="' + esc(v.note || '') + '"></label>' +
    '<p id="f-err" class="err" role="alert"></p>' +
    '<div class="actions"><button class="btn" type="submit">Сохранить</button>' + (existing ? '' : '<button class="btn ghost" type="button" id="f-next">Сохранить и сканировать дальше</button>') + '<button class="btn ghost" type="button" id="f-cancel">Отмена</button></div></form>',
  () => {
    const hint = () => { const h = imeiHint($('#f-imei').value, existing && existing.id, !!existing); const el = $('#f-hint'); el.className = h[0]; el.textContent = h[1]; };
    hint(); $('#f-imei').addEventListener('input', hint);
    $('#f-cancel').onclick = closeSheet;
    const submit = next => {
      const model = $('#f-model').value.trim(), imei = $('#f-imei').value.replace(/\D/g, ''), cost = C.money($('#f-cost').value), err = $('#f-err');
      if (!model) { err.textContent = 'Укажите модель телефона.'; return; }
      if (imei.length < 4) { err.textContent = 'Укажите IMEI (полный или хотя бы последние 4 цифры).'; return; }
      if (!existing && imei.length < 15) { err.textContent = 'Для нового прихода нужен полный IMEI из 15 цифр.'; return; }
      if (imei.length === 15 && phones().some(p => p.id !== (existing && existing.id) && p.imei === imei)) { err.textContent = 'Такой IMEI уже есть в базе.'; return; }
      if (isNaN(cost)) { err.textContent = 'Укажите цену закупки.'; return; }
      const f = { model, color: $('#f-color').value.trim(), date: $('#f-date').value || C.today(), imei, supplier: $('#f-sup').value.trim(), cost, note: $('#f-note').value.trim() };
      const p = existing ? Object.assign({}, existing, f) : Object.assign({ id: Store.newId(), status: 'stock', createdAt: Date.now() }, f);
      Store.put(p); closeSheet(); toast(existing ? 'Сохранено' : 'Приход оформлен: ' + p.model);
      if (!existing) { $('#q-imei').value = ''; scanState = null; }
      if (next) { setView('scan'); openCamera(); }
      else if (!existing && view === 'scan') { scanState = { q: p.imei, matches: [p], hints: {}, warn: '' }; render(); }
    };
    $('#f-intake').addEventListener('submit', e => { e.preventDefault(); submit(false); });
    const nx = $('#f-next'); if (nx) nx.onclick = () => submit(true);
  });
}
function marginInfo(p) {
  const same = sold().filter(x => C.keyOf(x) === C.keyOf(p) && x.cost > 0);
  if (!same.length) return { m: 0.12, n: 0 };
  return { m: C.sum(same.map(C.profitOf)) / C.sum(same.map(x => x.cost)), n: same.length };
}
function openSell(id) {
  const p = Store.get(id); if (!p) return;
  const mi = marginInfo(p), sug = C.round100(p.cost * (1 + mi.m));
  openSheet('<h2 class="title" id="sheet-title">Продажа: ' + esc(p.model) + '</h2>' +
    '<p class="sub" style="margin:-6px 0 12px">IMEI …' + esc(p.imei.slice(-5)) + ' · закупка ' + C.fmt(p.cost) + '</p>' +
    '<form id="f-sell" class="form" novalidate>' +
    '<div class="two"><label><span class="l">Цена продажи, сом</span><input id="s-price" inputmode="numeric" data-af></label><label><span class="l">Дата</span><input id="s-date" type="date" value="' + C.today() + '"></label></div>' +
    '<div class="actions" style="align-items:center"><button class="btn ghost small" type="button" id="s-sug">Подставить ' + C.fmt(sug) + '</button><span class="sub">' + (mi.n ? 'средняя наценка по модели ' + Math.round(mi.m * 100) + '% (' + mi.n + ' прод.)' : 'ориентир: наценка 12%, продаж этой модели ещё нет') + '</span></div>' +
    '<div class="two"><label><span class="l">Покупатель</span><input id="s-buyer"></label><label><span class="l">Телефон покупателя</span><input id="s-contact" inputmode="tel"></label></div>' +
    '<label><span class="l">Оплата</span><select id="s-pay"><option value="cash">Наличные</option><option value="bank">Перевод / банк</option><option value="inst">Рассрочка</option></select></label>' +
    '<div id="inst-box" class="two" hidden><label><span class="l">Первый взнос, сом</span><input id="s-first" inputmode="numeric" value="0"></label><label><span class="l">Месяцев</span><input id="s-months" inputmode="numeric" value="3"></label><p id="s-plan" class="hint" style="grid-column:1/-1"></p></div>' +
    '<p id="s-profit" class="hint"></p><p id="f-err" class="err" role="alert"></p>' +
    '<div class="actions"><button class="btn" type="submit">Оформить продажу</button><button class="btn ghost" type="button" id="f-cancel">Отмена</button></div></form>',
  () => {
    const calc = () => {
      const price = C.money($('#s-price').value), pay = $('#s-pay').value;
      $('#inst-box').hidden = pay !== 'inst';
      const pe = $('#s-profit');
      if (isNaN(price)) { pe.className = 'hint'; pe.textContent = 'Введите цену продажи.'; }
      else { const pr = price - p.cost; pe.className = 'hint ' + (pr >= 0 ? 'ok' : 'bad'); pe.textContent = 'Прибыль ' + (pr < 0 ? '−' : '') + C.fmt(Math.abs(pr)) + (p.cost ? ' (' + Math.round(pr / p.cost * 100) + '% к закупке)' : ''); }
      if (pay === 'inst' && !isNaN(price)) {
        const first = C.money($('#s-first').value) || 0, mo = parseInt($('#s-months').value, 10), el = $('#s-plan');
        if (mo > 0 && price > first) { const rest = price - first, base = Math.floor(rest / mo); el.textContent = 'Остаток ' + C.fmt(rest) + ': ' + mo + ' × ' + C.fmt(base) + (rest - base * mo ? ' (последний ' + C.fmt(rest - base * (mo - 1)) + ')' : '') + ', первый платёж ' + C.dmy(C.addMonths($('#s-date').value || C.today(), 1)); }
        else el.textContent = 'Проверьте взнос и число месяцев.';
      }
    };
    ['#s-price', '#s-pay', '#s-first', '#s-months', '#s-date'].forEach(s => $(s).addEventListener('input', calc)); calc();
    $('#s-sug').onclick = () => { $('#s-price').value = sug; calc(); };
    $('#f-cancel').onclick = closeSheet;
    $('#f-sell').addEventListener('submit', e => {
      e.preventDefault();
      const err = $('#f-err'), price = C.money($('#s-price').value), pay = $('#s-pay').value, date = $('#s-date').value || C.today(), buyer = $('#s-buyer').value.trim();
      if (isNaN(price) || price <= 0) { err.textContent = 'Укажите цену продажи.'; return; }
      const sale = { date, price, buyer, contact: $('#s-contact').value.trim(), pay, by: Store.config().seller || '' };
      if (pay === 'inst') {
        const first = C.money($('#s-first').value) || 0, mo = parseInt($('#s-months').value, 10);
        if (!buyer) { err.textContent = 'Для рассрочки укажите имя покупателя.'; return; }
        if (!(mo >= 1 && mo <= 24) || !(price > first)) { err.textContent = 'Проверьте взнос и число месяцев (1–24).'; return; }
        const rest = price - first, base = Math.floor(rest / mo);
        sale.first = first; sale.months = mo; sale.payments = [];
        for (let i = 1; i <= mo; i++) sale.payments.push({ d: C.addMonths(date, i), a: i === mo ? rest - base * (mo - 1) : base, paid: false });
      }
      Store.put(Object.assign({}, p, { status: 'sold', sale }));
      closeSheet(); toast('Продано: ' + p.model); scanState = null; $('#q-imei').value = ''; render();
    });
  });
}
function openDetail(id) {
  const p = Store.get(id); if (!p) return;
  const s = C.isSold(p);
  let d = '<dl class="dl"><dt>IMEI</dt><dd class="mono">' + esc(p.imei) + '</dd>' + (p.color ? '<dt>Цвет</dt><dd>' + esc(p.color) + '</dd>' : '') +
    '<dt>Приход</dt><dd>' + C.dmy(p.date) + (p.supplier ? ' · ' + esc(p.supplier) : '') + '</dd><dt>Закупка</dt><dd class="num">' + C.fmt(p.cost) + '</dd>' + (p.note ? '<dt>Заметка</dt><dd>' + esc(p.note) + '</dd>' : '');
  if (s) {
    const sl = p.sale, pr = C.profitOf(p);
    d += '<dt>Продан</dt><dd>' + C.dmy(sl.date) + ' · ' + (PAY[sl.pay] || '') + '</dd><dt>Цена</dt><dd class="num">' + C.fmt(sl.price) + '</dd><dt>Прибыль</dt><dd class="num ' + (pr < 0 ? 'bad' : '') + '">' + (pr < 0 ? '−' : '') + C.fmt(Math.abs(pr)) + '</dd>' +
      (sl.buyer ? '<dt>Покупатель</dt><dd>' + esc(sl.buyer) + (sl.contact ? ' · ' + esc(sl.contact) : '') + '</dd>' : '') + (sl.by ? '<dt>Продавец</dt><dd>' + esc(sl.by) + '</dd>' : '') + (sl.pay === 'inst' ? '<dt>Остаток долга</dt><dd class="num">' + C.fmt(C.remaining(p)) + '</dd>' : '');
  }
  d += '</dl>';
  openSheet('<h2 class="title" id="sheet-title">' + esc(p.model) + ' <span class="pill' + (s ? ' sold' : '') + '">' + (s ? 'продан' : 'на складе') + '</span></h2>' + d +
    '<div class="actions">' + (s ? '<button class="btn ghost" type="button" id="d-return">Вернуть на склад</button>' : '<button class="btn" type="button" id="d-sell">Продать</button>') +
    '<button class="btn ghost" type="button" id="d-edit">Изменить</button><button class="btn danger" type="button" id="d-del">Удалить</button><button class="btn ghost" type="button" id="d-close">Закрыть</button></div>',
  () => {
    $('#d-close').onclick = closeSheet; $('#d-edit').onclick = () => openIntake(p);
    const sb = $('#d-sell'); if (sb) sb.onclick = () => openSell(p.id);
    const rb = $('#d-return'); if (rb) twoStep(rb, 'Точно вернуть?', () => { const np = Object.assign({}, p, { status: 'stock' }); delete np.sale; Store.put(np); closeSheet(); toast('Телефон снова на складе'); });
    twoStep($('#d-del'), 'Точно удалить?', () => { Store.remove(p.id); closeSheet(); toast('Удалено'); scanState = null; render(); });
  });
}

/* ---------- сканер ---------- */
function showResult(q, hints, warn) {
  scanState = { q, matches: find(q), hints: hints || {}, warn: warn || '' };
  setStatus(''); render();
}
function foundImeis(r, from) {
  if (r.valid.length) {
    const q = r.valid[0];
    $('#q-imei').value = q;
    showResult(q, {}, '');
    if (r.valid.length > 1) setStatus('Найден ещё один IMEI: ' + r.valid[1]);
    return true;
  }
  if (r.other.length) {
    const q = r.other[0];
    $('#q-imei').value = q;
    showResult(q, {}, 'Контрольная сумма IMEI не сошлась: цифры могли прочитаться неверно. Сверьте с экраном телефона (*#06#).');
    return true;
  }
  return false;
}
const CAM_ERR = {
  denied: 'Доступ к камере запрещён. Разрешите камеру для этого сайта в настройках браузера и откройте сканер снова.',
  nocam: 'Камера не найдена. Загрузите фото с IMEI или введите цифры вручную.',
  nodecoder: 'Не удалось загрузить сканер штрихкодов. При первом запуске нужен интернет. Загрузите фото или введите IMEI вручную.',
  camerr: 'Камера не запустилась. Закройте другие приложения, которые её используют, и повторите.',
  noframe: 'Кадр с камеры ещё не получен. Подождите секунду и повторите.'
};
async function openCamera() {
  if (!window.isSecureContext) { setStatus('Камера работает только по защищённому адресу (https). Откройте приложение по ссылке https://…'); return; }
  $('#cam').hidden = false; $('#cam-open').hidden = true;
  setStatus('Запускаю камеру…', true);
  try {
    await Cam.start($('#cam-video'), imeis => {
      closeCamera(); foundImeis({ valid: imeis, other: [] });
    });
    setStatus('Наведите камеру на штрихкод IMEI. Держите ровно, при слабом свете включите фонарик.');
    torchOn = false; $('#cam-torch').hidden = !Cam.hasTorch();
  } catch (e) {
    closeCamera(); setStatus(CAM_ERR[e && e.code] || CAM_ERR.camerr);
  }
}
function closeCamera() { Cam.stop(); $('#cam').hidden = true; $('#cam-open').hidden = false; }
async function readPhotoFile(file) {
  if (!file) return;
  setStatus('Читаю фото…', true);
  try {
    const r = await Cam.decodeFile(file);
    if (!foundImeis(r)) setStatus('Штрихкод IMEI на фото не найден. Снимите ближе и ровнее или введите цифры вручную.');
  } catch (e) { setStatus(CAM_ERR[e && e.code] || 'Не удалось прочитать фото. Введите IMEI вручную.'); }
}
async function ocrNow() {
  const v = $('#cam-video');
  Cam.snapshotPaused(v);
  setStatus('Читаю цифры…', true);
  try {
    const r = await Cam.ocrFrame(v, (st, pr) => setStatus('Читаю цифры: ' + st + (pr ? ' ' + Math.round(pr * 100) + '%' : ''), true));
    closeCamera();
    if (!foundImeis(r)) { setStatus('Цифры IMEI не найдены. Поднесите ближе, чтобы цифры занимали рамку, и повторите.'); }
  } catch (e) {
    closeCamera(); setStatus(e && e.code ? CAM_ERR[e.code] : 'Распознавание цифр недоступно. Нужен интернет при первом запуске.');
  }
}
function submitFind() {
  const q = $('#q-imei').value.replace(/\D/g, '');
  if (q.length < 4) { setStatus('Введите минимум 4 последние цифры IMEI.'); return; }
  if (q.length === 15 && !C.luhn(q)) { showResult(q, {}, 'Контрольная сумма IMEI не сошлась. Проверьте цифры.'); return; }
  showResult(q, {}, '');
}

/* ---------- экспорт ---------- */
function exportCsv() {
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const headRow = ['Дата прихода', 'Телефон', 'Цвет', 'IMEI', 'Поставщик', 'Закупка', 'Статус', 'Дата продажи', 'Цена продажи', 'Покупатель', 'Оплата', 'Продавец', 'Прибыль', 'Остаток долга'];
  const rows = phones().slice().sort((a, b) => a.date < b.date ? -1 : 1).map(p => {
    const s = C.isSold(p) ? p.sale : null;
    return [C.dmy(p.date), p.model, p.color, '="' + p.imei + '"', p.supplier, p.cost, s ? 'продан' : 'на складе', s ? C.dmy(s.date) : '', s ? s.price : '', s ? s.buyer : '', s ? PAY[s.pay] : '', s ? s.by : '', s ? C.profitOf(p) : '', s && s.pay === 'inst' ? C.remaining(p) : ''].map(q).join(';');
  });
  const blob = new Blob(['﻿' + [headRow.map(q).join(';')].concat(rows).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'imei-sklad-' + C.today() + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ---------- события ---------- */
$$('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.v)));
$('#btn-gear').addEventListener('click', () => setView('settings'));
$('#sync-chip').addEventListener('click', () => { if (!Store.enabled()) { setView('settings'); return; } Store.sync(true); toast('Синхронизирую…'); });
$('#cam-open').addEventListener('click', openCamera);
$('#cam-close').addEventListener('click', () => { closeCamera(); setStatus(''); });
$('#cam-torch').addEventListener('click', async () => { torchOn = !torchOn; if (!(await Cam.setTorch(torchOn))) torchOn = !torchOn; $('#cam-torch').textContent = torchOn ? 'Фонарик выкл.' : 'Фонарик'; });
$('#cam-ocr').addEventListener('click', ocrNow);
$('#photo-btn').addEventListener('click', () => $('#photo').click());
$('#photo').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; readPhotoFile(f); });
$('#find-form').addEventListener('submit', e => { e.preventDefault(); submitFind(); });
$('#q-imei').addEventListener('input', e => {
  const d = e.target.value.replace(/\D/g, '');
  if (!e.target.value.trim()) { scanState = null; setStatus(''); renderScan(); }
  else if (d.length === 15) submitFind();
});
document.addEventListener('keydown', e => {
  if (view !== 'scan' || !ov.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (/^\d$/.test(e.key)) $('#q-imei').focus();
});
$('#q-stock').addEventListener('input', renderStock);
$('#sales-month').addEventListener('change', renderSales);
$('#btn-add').addEventListener('click', () => openIntake(null));
$('#period').addEventListener('click', e => { const b = e.target.closest('.seg'); if (b) { period = b.dataset.p; renderStats(); } });
$('#btn-export').addEventListener('click', exportCsv);

$('#set-seller').addEventListener('change', e => Store.setSeller(e.target.value.trim()));
$('#set-theme').addEventListener('change', e => { try { localStorage.setItem('imeisklad.theme', e.target.value); } catch (x) {} applyTheme(e.target.value); });
$('#set-gen').addEventListener('click', () => { $('#set-shop').value = randomCode(); });
$('#set-save').addEventListener('click', () => {
  const url = $('#set-url').value.trim().replace(/\/+$/, ''), key = $('#set-key').value.trim(), shop = $('#set-shop').value.trim();
  if (!/^https:\/\/.+/.test(url) || key.length < 20 || shop.length < 6) { toast('Укажите адрес базы (https://…), ключ и код магазина не короче 6 символов.'); return; }
  Store.setConfig({ url, key, shop }); toast('Подключаю…');
});
$('#set-off').addEventListener('click', () => { Store.setConfig({ url: '', key: '', shop: '' }); $('#set-url').value = ''; $('#set-key').value = ''; $('#set-shop').value = ''; toast('Синхронизация отключена. Данные остались на этом устройстве.'); });
$('#invite-copy').addEventListener('click', async () => {
  const link = Store.inviteLink();
  try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована'); }
  catch (e) { const r = document.createRange(); r.selectNodeContents($('#invite')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Выделил ссылку. Скопируйте её вручную.'); }
});
$('#imp-file').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  const text = await f.text();
  const r = C.importPhones(C.parseCSV(text));
  const have = new Set(phones().map(p => p.imei));
  const items = r.items.filter(x => !(x.imei.length >= 4 && have.has(x.imei)));
  importPending = { items, skipped: r.skipped, dups: r.items.length - items.length };
  renderImport();
});
async function doInstall() { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; renderInstall(); }
['#btn-install', '#btn-install-top'].forEach(s => { const b = $(s); if (b) b.addEventListener('click', doInstall); });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; renderInstall(); });
window.addEventListener('appinstalled', () => { installEvt = null; renderInstall(); toast('Приложение установлено'); });
$('#hperiod').addEventListener('click', e => { const b = e.target.closest('.seg'); if (b) { hperiod = b.dataset.p; renderHome(); } });

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.go) setView(b.dataset.go);
  else if (b.dataset.act === 'install') doInstall();
  else if (b.dataset.act === 'hide-install') { try { localStorage.setItem('imeisklad.instdismiss', '1'); } catch (x) {} renderInstall(); }
  else if (b.dataset.open) openDetail(b.dataset.open);
  else if (b.dataset.sell) openSell(b.dataset.sell);
  else if (b.dataset.intake) openIntake(null, { imei: b.dataset.intake });
  else if (b.dataset.fullimei) { const p = Store.get(b.dataset.fullimei); if (p) { Store.put(Object.assign({}, p, { imei: scanState.q })); toast('IMEI записан полностью'); scanState.matches = find(scanState.q); render(); } }
  else if (b.dataset.model) { chartKey = b.dataset.model; renderStats(); }
  else if (b.dataset.pay) {
    const a = b.dataset.pay.split(':'), p = Store.get(a[0]), i = +a[1]; if (!p) return;
    const np = JSON.parse(JSON.stringify(p)); const x = np.sale.payments[i]; x.paid = !x.paid; if (x.paid) x.paidOn = C.today(); else delete x.paidOn;
    Store.put(np);
  }
});
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (view === 'stats') renderStats(); }, 200); });
window.addEventListener('pagehide', () => Cam.stop());

/* ---------- запуск ---------- */
(function boot() {
  let th = 'auto'; try { th = localStorage.getItem('imeisklad.theme') || 'auto'; } catch (e) {}
  applyTheme(th);
  Store.onChange(render);
  Store.init();
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ih = $('#install-hint');
  if (ih) ih.textContent = standalone ? 'Приложение уже установлено.' : ios ? 'iPhone: откройте эту страницу в Safari, нажмите «Поделиться», затем «На экран Домой».' : 'Компьютер или Android: нажмите «Установить приложение» ниже (или значок установки в адресной строке Chrome/Edge).';
  render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
})();
