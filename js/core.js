/* Shop inventory + POS: data rules. No screen code in this file, so it can be tested on its own. */
(function (root) {
  'use strict';

  var DAY = 86400000;

  var DEFAULT_CATEGORIES = [
    'Onesies', 'Rompers', 'T-shirts', 'Tops', 'Shirts', 'Blouses', 'Trousers', 'Jeans', 'Khakis',
    'Shorts', 'Skirts', 'Dresses', 'Leggings', 'Sweaters', 'Sweatshirts', 'Sweat pants', 'Jackets',
    'Half coats', 'Denim jackets', 'Dungarees', 'Matchy sets', 'Play suits', 'Suits', 'Pyjamas',
    'Underwear', 'Socks & stockings', 'Hats & mittens', 'Shawls', 'Shoes', 'Accessories'
  ];
  var DEFAULT_SIZES = [
    '0-3m', '3-6m', '6-9m', '9-12m', '12-18m', '18-24m', '1-2y', '2-3y', '3-4y', '4-5y', '5-6y',
    '6-7y', '7-8y', '8-9y', '9-10y', '10-11y', '11-12y'
  ];
  var PAYMENTS = ['Cash', 'M-Pesa', 'Other'];

  function newState() {
    return {
      v: 1,
      shop: { name: 'Kidsclosetbydee', currency: 'KES' },
      seq: 1000,          // last tag sequence number used
      categories: DEFAULT_CATEGORIES.slice(),
      sizes: DEFAULT_SIZES.slice(),
      label: { size: 'a4-24', price: true, cut: true },
      items: {},          // code -> item
      log: [],            // every change, oldest first
      count: null,        // stock count in progress
      counts: []          // finished stock counts
    };
  }

  /* ---------- tag numbers ---------- */
  // Last digit is a check digit (Luhn), so a mistyped number is rejected instead of matching another item.
  function checkDigit(numStr) {
    var sum = 0, dbl = true;
    for (var i = numStr.length - 1; i >= 0; i--) {
      var d = +numStr[i];
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      sum += d; dbl = !dbl;
    }
    return String((10 - (sum % 10)) % 10);
  }
  function makeCode(seq) { var s = String(seq); return s + checkDigit(s); }
  function normCode(raw) { return String(raw == null ? '' : raw).replace(/\D/g, ''); }
  function validCode(code) {
    return /^\d{4,12}$/.test(code) && checkDigit(code.slice(0, -1)) === code.slice(-1);
  }

  function money(n) { n = Number(n); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; }
  function fail(msg) { var e = new Error(msg); e.user = true; throw e; }
  function addLog(state, type, code, by, info, now) {
    state.log.push({ t: now, type: type, code: code || '', by: by || '', info: info || '' });
  }
  function describe(it) {
    return [it.cat, it.gender, it.size, it.desc].filter(Boolean).join(' · ');
  }

  /* ---------- tagging ---------- */
  function addItems(state, d, by, now) {
    var cat = String(d.cat || '').trim();
    var buy = money(d.buy), tag = d.tag === '' || d.tag == null ? 0 : money(d.tag);
    var qty = d.qty === '' || d.qty == null ? 1 : Math.floor(Number(d.qty));
    if (!cat) fail('Choose a category.');
    if (!(buy >= 0) || d.buy === '' || d.buy == null) fail('Enter the buying price.');
    if (!(tag >= 0)) fail('The tag price is not a valid number.');
    if (!(qty >= 1 && qty <= 200)) fail('Quantity must be between 1 and 200.');
    var codes = [];
    for (var i = 0; i < qty; i++) {
      state.seq += 1;
      var code = makeCode(state.seq);
      state.items[code] = {
        code: code, cat: cat, gender: String(d.gender || '').trim(), size: String(d.size || '').trim(),
        desc: String(d.desc || '').trim(), buy: buy, tag: tag, taggedAt: now, taggedBy: by || '',
        status: 'in', printed: false
      };
      addLog(state, 'tagged', code, by, 'Buying price ' + buy, now);
      codes.push(code);
    }
    return codes;
  }

  function editItem(state, code, patch, by, now) {
    var it = state.items[code];
    if (!it) fail('Item not found.');
    var changes = [];
    ['cat', 'gender', 'size', 'desc'].forEach(function (k) {
      if (patch[k] != null && String(patch[k]).trim() !== it[k]) {
        changes.push(k + ': ' + (it[k] || '-') + ' → ' + (String(patch[k]).trim() || '-'));
        it[k] = String(patch[k]).trim();
      }
    });
    ['buy', 'tag'].forEach(function (k) {
      if (patch[k] != null && patch[k] !== '') {
        var v = money(patch[k]);
        if (!(v >= 0)) fail('Price is not a valid number.');
        if (v !== it[k]) { changes.push(k + ': ' + it[k] + ' → ' + v); it[k] = v; }
      }
    });
    if (!it.cat) fail('Category cannot be empty.');
    if (changes.length) addLog(state, 'edited', code, by, changes.join('; '), now);
    return changes.length;
  }

  function deleteItem(state, code, reason, by, now) {
    var it = state.items[code];
    if (!it) fail('Item not found.');
    if (it.status !== 'in') fail('Only items that are in stock can be deleted.');
    addLog(state, 'deleted', code, by, describe(it) + ' (bought at ' + it.buy + '). ' + (reason || ''), now);
    delete state.items[code];
  }

  /* ---------- selling ---------- */
  function sell(state, lines, opts, now) {
    if (!lines || !lines.length) fail('Scan at least one item.');
    var seen = {}, total = 0;
    lines.forEach(function (l) {
      var it = state.items[l.code];
      if (!it) fail('Tag ' + l.code + ' is not in the system.');
      if (it.status !== 'in') fail('Tag ' + l.code + ' is not in stock (' + statusLabel(it.status) + ').');
      if (seen[l.code]) fail('Tag ' + l.code + ' is in the sale twice.');
      seen[l.code] = 1;
      var p = money(l.price);
      if (!(p > 0)) fail('Enter the selling price for tag ' + l.code + '.');
      total += p;
    });
    var saleId = opts.saleId || String(now), pay = opts.pay || 'Cash', by = opts.by || '';
    lines.forEach(function (l) {
      var it = state.items[l.code], p = money(l.price);
      it.status = 'sold'; it.soldAt = now; it.soldPrice = p; it.soldBy = by; it.soldByUid = opts.uid || ''; it.pay = pay; it.saleId = saleId;
      addLog(state, 'sold', l.code, by, 'Sale #' + saleId + ' · ' + p + ' · ' + pay, now);
    });
    return { saleId: saleId, total: money(total), count: lines.length };
  }

  // Sold item comes back (return or mistake), or a missing / written-off item turns up again.
  function returnToStock(state, code, reason, by, now) {
    var it = state.items[code];
    if (!it) fail('Item not found.');
    if (it.status === 'in') fail('This item is already in stock.');
    if (it.status === 'sold') {
      addLog(state, 'void', code, by, 'Sale #' + it.saleId + ' of ' + it.soldPrice + ' (' + it.pay + ', by ' +
        (it.soldBy || '?') + ') cancelled. ' + (reason || ''), now);
      delete it.soldAt; delete it.soldPrice; delete it.soldBy; delete it.soldByUid; delete it.pay; delete it.saleId;
    } else {
      addLog(state, 'found', code, by, 'Was ' + statusLabel(it.status) + '. ' + (reason || ''), now);
      delete it.outAt; delete it.note;
    }
    it.status = 'in';
  }

  function takeOut(state, code, status, note, by, now) {
    var it = state.items[code];
    if (!it) fail('Item not found.');
    if (status !== 'missing' && status !== 'writeoff') fail('Unknown status.');
    if (it.status !== 'in') fail('Only items that are in stock can be marked ' + statusLabel(status) + '.');
    it.status = status; it.outAt = now; it.note = note || '';
    addLog(state, status, code, by, note || '', now);
  }

  function statusLabel(s) {
    return { 'in': 'in stock', sold: 'sold', missing: 'missing', writeoff: 'written off' }[s] || s;
  }

  /* ---------- stock count ---------- */
  function startCount(state, scope, by, now) {
    if (state.count) fail('A stock count is already running.');
    state.count = { startedAt: now, scope: scope || '', by: by || '', scanned: {}, unknown: [] };
    addLog(state, 'count-start', '', by, scope ? 'Category: ' + scope : 'Whole shop', now);
  }

  function countScan(state, raw, now) {
    var c = state.count;
    if (!c) fail('No stock count is running.');
    var code = normCode(raw), it = validCode(code) ? state.items[code] : null;
    if (!it) {
      var shown = code || String(raw).slice(0, 24);
      if (c.unknown.indexOf(shown) < 0) c.unknown.push(shown);
      return { kind: 'unknown', code: shown };
    }
    if (c.scope && it.cat !== c.scope) return { kind: 'scope', item: it };
    if (c.scanned[code]) return { kind: 'dup', item: it };
    c.scanned[code] = now;
    if (it.status === 'in') return { kind: 'ok', item: it };
    if (it.status === 'sold') return { kind: it.soldAt >= c.startedAt ? 'ok' : 'sold', item: it };
    return { kind: 'found', item: it };
  }

  function countReview(state) {
    var c = state.count;
    if (!c) fail('No stock count is running.');
    var r = { expected: 0, counted: 0, missing: [], soldOnRack: [], found: [], unknown: c.unknown.slice() };
    Object.keys(state.items).forEach(function (code) {
      var it = state.items[code];
      if (c.scope && it.cat !== c.scope) return;
      var scanned = !!c.scanned[code];
      if (it.status === 'in') {
        r.expected += 1;
        if (scanned) r.counted += 1; else r.missing.push(code);
      } else if (scanned) {
        if (it.status === 'sold') { if (it.soldAt < c.startedAt) r.soldOnRack.push(code); }
        else r.found.push(code);
      }
    });
    r.missingCost = r.missing.reduce(function (s, code) { return s + state.items[code].buy; }, 0);
    return r;
  }

  function finishCount(state, by, now) {
    var c = state.count, r = countReview(state);
    r.missing.forEach(function (code) { takeOut(state, code, 'missing', 'Not found in stock count', by, now); });
    r.found.forEach(function (code) { returnToStock(state, code, 'Found in stock count', by, now); });
    var summary = {
      startedAt: c.startedAt, finishedAt: now, scope: c.scope, by: by || '', expected: r.expected,
      counted: r.counted, missing: r.missing, missingCost: r.missingCost, soldOnRack: r.soldOnRack,
      found: r.found, unknown: r.unknown
    };
    state.counts.push(summary);
    state.count = null;
    addLog(state, 'count-finish', '', by, r.counted + ' of ' + r.expected + ' found, ' + r.missing.length + ' missing', now);
    return summary;
  }

  function cancelCount(state, by, now) {
    if (!state.count) return;
    state.count = null;
    addLog(state, 'count-cancel', '', by, '', now);
  }

  /* ---------- reports ---------- */
  function bump(map, key, qty, amount) {
    var m = map[key] || (map[key] = { n: 0, amount: 0, profit: 0 });
    m.n += qty; m.amount += amount; return m;
  }

  function report(state, from, to) {
    var r = { n: 0, revenue: 0, cost: 0, profit: 0, byPay: {}, byStaff: {}, byCat: {}, belowTag: [], belowCost: [], sales: [], voids: [] };
    Object.keys(state.items).forEach(function (code) {
      var it = state.items[code];
      if (it.status !== 'sold' || it.soldAt < from || it.soldAt >= to) return;
      r.n += 1; r.revenue += it.soldPrice; r.cost += it.buy;
      bump(r.byPay, it.pay || 'Cash', 1, it.soldPrice);
      bump(r.byStaff, it.soldBy || '?', 1, it.soldPrice);
      bump(r.byCat, it.cat, 1, it.soldPrice).profit += it.soldPrice - it.buy;
      if (it.tag > 0 && it.soldPrice < it.tag) r.belowTag.push(code);
      if (it.soldPrice < it.buy) r.belowCost.push(code);
      r.sales.push(code);
    });
    r.sales.sort(function (a, b) { return state.items[b].soldAt - state.items[a].soldAt; });
    r.profit = r.revenue - r.cost;
    r.voids = state.log.filter(function (l) { return l.type === 'void' && l.t >= from && l.t < to; });
    return r;
  }

  function stock(state, now) {
    var s = { inN: 0, inCost: 0, inTag: 0, missingN: 0, missingCost: 0, writeoffN: 0, writeoffCost: 0, soldN: 0, unprinted: 0, slow: [] };
    Object.keys(state.items).forEach(function (code) {
      var it = state.items[code];
      if (it.status === 'in') {
        s.inN += 1; s.inCost += it.buy; s.inTag += it.tag || 0;
        if (!it.printed) s.unprinted += 1;
        if (now - it.taggedAt > 60 * DAY) s.slow.push(code);
      } else if (it.status === 'missing') { s.missingN += 1; s.missingCost += it.buy; }
      else if (it.status === 'writeoff') { s.writeoffN += 1; s.writeoffCost += it.buy; }
      else if (it.status === 'sold') s.soldN += 1;
    });
    s.slow.sort(function (a, b) { return state.items[a].taggedAt - state.items[b].taggedAt; });
    return s;
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function isoDay(t) { if (!t) return ''; var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function toCSV(state) {
    var head = ['Tag number', 'Category', 'For', 'Size', 'Description', 'Buying price', 'Tag price', 'Date tagged',
      'Status', 'Date sold', 'Selling price', 'Profit', 'Payment', 'Sold by', 'Sale no', 'Note'];
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var rows = Object.keys(state.items).sort().map(function (code) {
      var it = state.items[code], sold = it.status === 'sold';
      return [it.code, it.cat, it.gender, it.size, it.desc, it.buy, it.tag || '', isoDay(it.taggedAt), statusLabel(it.status),
        sold ? isoDay(it.soldAt) : '', sold ? it.soldPrice : '', sold ? money(it.soldPrice - it.buy) : '',
        sold ? it.pay : '', sold ? it.soldBy : '', sold ? it.saleId : '', it.note || ''].map(q).join(',');
    });
    return [head.join(',')].concat(rows).join('\r\n');
  }

  root.Core = {
    DAY: DAY, PAYMENTS: PAYMENTS, newState: newState, checkDigit: checkDigit, makeCode: makeCode, normCode: normCode,
    validCode: validCode, money: money, describe: describe, addItems: addItems, editItem: editItem, deleteItem: deleteItem,
    sell: sell, returnToStock: returnToStock, takeOut: takeOut, statusLabel: statusLabel, startCount: startCount,
    countScan: countScan, countReview: countReview, finishCount: finishCount, cancelCount: cancelCount, report: report,
    stock: stock, toCSV: toCSV, isoDay: isoDay
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Core;
})(typeof window !== 'undefined' ? window : globalThis);
