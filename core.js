/* Чистая логика без интерфейса: даты, IMEI, импорт CSV, слияние при синхронизации, аналитика. */
(function (root) {
'use strict';

const APP_NAME = 'Имей Склад';

/* ---------- числа и даты ---------- */
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => iso(new Date());
const parseISO = s => { const a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); };
const dmy = s => { if (!s) return '—'; const a = s.split('-'); return a[2] + '.' + a[1] + '.' + a[0].slice(2); };
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
const addDays = (s, k) => { const d = parseISO(s); d.setDate(d.getDate() + k); return iso(d); };
function addMonths(s, k) {
  const a = s.split('-').map(Number);
  const dt = new Date(a[0], a[1] - 1 + k, 1);
  const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  dt.setDate(Math.min(a[2], last));
  return iso(dt);
}
const mondayOf = s => addDays(s, -((parseISO(s).getDay() + 6) % 7));
const fmt = n => Math.round(n).toLocaleString('ru-RU') + ' сом';
const fmtK = n => Math.round(n).toLocaleString('ru-RU');
const money = v => { const t = String(v == null ? '' : v).trim(); if (t === '') return NaN; return Number(t.replace(/[^\d.]/g, '')); };
const round100 = n => Math.round(n / 100) * 100;
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const sum = a => a.reduce((s, x) => s + x, 0);

/* ---------- IMEI ---------- */
function luhn(s) {
  if (!/^\d{15}$/.test(s)) return false;
  let t = 0;
  for (let i = 0; i < 15; i++) {
    let d = +s[14 - i];
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    t += d;
  }
  return t % 10 === 0;
}
function extractImeis(text) {
  const all = Array.from(new Set(String(text || '').replace(/(\d)[\s-]+(?=\d)/g, '$1').match(/\d{15}/g) || []));
  return { valid: all.filter(luhn), other: all.filter(x => !luhn(x)) };
}

/* ---------- телефоны ---------- */
const keyOf = p => p.model.replace(/\d+\s*%/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const nameOf = p => p.model.replace(/\s*\d+\s*%/g, '').replace(/\s+/g, ' ').trim();
const isSold = p => p.status === 'sold' && !!p.sale;
const profitOf = p => isSold(p) ? p.sale.price - p.cost : 0;
const remaining = p => ((p.sale && p.sale.payments) || []).filter(x => !x.paid).reduce((s, x) => s + x.a, 0);

function findPhones(phones, raw) {
  const q = String(raw).replace(/\D/g, '');
  if (q.length < 4) return [];
  return phones.filter(p => {
    if (q.length >= 15) return p.imei === q || (p.imei.length < 15 && q.endsWith(p.imei));
    return p.imei.endsWith(q);
  });
}

/* ---------- CSV (импорт из таблицы) ---------- */
function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const cnt = c => first.split(c).length;
  const delim = cnt(';') > cnt(',') && cnt(';') >= cnt('\t') ? ';' : (cnt('\t') > cnt(',') ? '\t' : ',');
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = ''; rows.push(row); row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}
function parseDate(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return y + '-' + pad(+m[2]) + '-' + pad(+m[1]); }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
  return '';
}
function importPhones(rows) {
  let col = { date: 0, model: 1, color: 2, imei: 3, supplier: 4, cost: 5 }, start = 0;
  if (rows.length) {
    const h = rows[0].map(x => String(x).toLowerCase());
    const find = fn => h.findIndex(fn);
    const idx = {
      date: find(x => x.includes('дата')), model: find(x => x.includes('телефон') || x.includes('модель')),
      color: find(x => x.includes('цвет')), imei: find(x => x.includes('imei') || x.includes('имей')),
      supplier: find(x => x.includes('поставщик')), cost: find(x => x.includes('цена') || x.includes('закуп'))
    };
    if (idx.model >= 0 && idx.imei >= 0) { col = idx; start = 1; }
  }
  const items = [];
  let skipped = 0;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const get = k => col[k] >= 0 ? String(r[col[k]] == null ? '' : r[col[k]]).trim() : '';
    const model = get('model');
    const imei = get('imei').replace(/[OoОо]/g, '0').replace(/\D/g, '');
    const cost = money(get('cost'));
    if (!model || imei.length < 4 || isNaN(cost)) { skipped++; continue; }
    items.push({ date: parseDate(get('date')) || today(), model, color: get('color'), imei, supplier: get('supplier') || 'Скупка', cost, note: '', status: 'stock' });
  }
  return { items, skipped };
}

/* ---------- синхронизация: слияние по времени правки ---------- */
function applyRemote(phones, dirty, rows) {
  const byId = new Map(phones.map(p => [p.id, p]));
  rows.forEach(r => {
    const loc = byId.get(r.id);
    const rem = Object.assign({}, r.data, { id: r.id, updatedAt: r.updated_at, deleted: !!r.deleted });
    if (!loc || rem.updatedAt > loc.updatedAt) { byId.set(r.id, rem); delete dirty[r.id]; }
  });
  return Array.from(byId.values());
}

/* ---------- аналитика продаж ---------- */
function periodRange(period, sales, t) {
  if (period === 'all') {
    const ds = sales.map(p => p.sale.date).sort();
    return [ds[0] || t, t];
  }
  return [addDays(t, -(Number(period) - 1)), t];
}
function buckets(sales, from, to) {
  const days = daysBetween(from, to) + 1;
  const gran = days <= 45 ? 'd' : days <= 190 ? 'w' : 'm';
  const keyFor = s => gran === 'd' ? s : gran === 'w' ? mondayOf(s) : s.slice(0, 7);
  const items = [], idx = {};
  const push = (key, label) => { idx[key] = items.length; items.push({ key, label, revenue: 0, profit: 0, count: 0 }); };
  if (gran === 'd') { for (let d = from; d <= to; d = addDays(d, 1)) push(d, d.slice(8) + '.' + d.slice(5, 7)); }
  else if (gran === 'w') { for (let d = mondayOf(from); d <= to; d = addDays(d, 7)) push(d, d.slice(8) + '.' + d.slice(5, 7)); }
  else { for (let d = from.slice(0, 7) + '-01'; d.slice(0, 7) <= to.slice(0, 7); d = addMonths(d, 1)) push(d.slice(0, 7), d.slice(5, 7) + '.' + d.slice(2, 4)); }
  sales.forEach(p => {
    if (p.sale.date < from || p.sale.date > to) return;
    const b = items[idx[keyFor(p.sale.date)]];
    if (!b) return;
    b.revenue += p.sale.price; b.profit += profitOf(p); b.count++;
  });
  return { gran, items };
}
function summarize(sales) {
  const revenue = sum(sales.map(p => p.sale.price));
  const cost = sum(sales.map(p => p.cost));
  const profit = revenue - cost;
  return {
    count: sales.length, revenue, profit,
    margin: cost ? profit / cost * 100 : 0,
    avgCheck: sales.length ? revenue / sales.length : 0,
    avgDays: avg(sales.map(p => Math.max(0, daysBetween(p.date, p.sale.date))))
  };
}
function groupSales(sales, keyFn) {
  const g = {};
  sales.forEach(p => { const k = keyFn(p) || '—'; (g[k] = g[k] || []).push(p); });
  return Object.keys(g).map(k => {
    const s = summarize(g[k]);
    return Object.assign({ key: k }, s);
  }).sort((a, b) => b.profit - a.profit);
}

const api = { APP_NAME, pad, iso, today, parseISO, dmy, daysBetween, addDays, addMonths, mondayOf, fmt, fmtK, money, round100, avg, sum,
  luhn, extractImeis, keyOf, nameOf, isSold, profitOf, remaining, findPhones, parseCSV, parseDate, importPhones, applyRemote,
  periodRange, buckets, summarize, groupSales };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
