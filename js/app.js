/* Shop inventory + POS: screens, actions and online sync. Data rules live in core.js. */
(function () {
  'use strict';

  var C = window.Core, Scanner = window.Scanner;
  var S = C.newState();         // what this phone currently knows; filled from the online records
  var fb = null, auth = null, db = null, cfg = null, cfgFromFile = false;
  var me = null;                // signed-in account
  var shop = null;              // the shop/main record
  var role = '';                // 'owner' or 'sales'
  var screen = 'loading';       // loading | connect | signin | noshop | denied | app
  var route = 'sell', routeArg = null;
  var listeners = [], dataStarted = false, dayStart = 0;
  var shadow = {};              // code -> last saved copy of the item, to work out what changed
  var sync = { online: navigator.onLine, pending: false, failed: 0 };
  var renderQueued = false, renderDeferred = false;
  var ui = {
    basket: [], pay: 'Cash', signMode: 'in',
    stock: { q: '', status: 'in', cat: '', limit: 60 },
    rep: { range: 'today', from: '', to: '', loaded: '', loading: false },
    lastTagged: [], tagForm: { gender: 'Boys', qty: '1' },
    labelCodes: null, countView: 'scan', showRemaining: false,
    voids: [], hist: { code: '', list: null }, recentLog: null, busy: false
  };
  var OPEN = ['in', 'missing', 'writeoff'];

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cur() { return S.shop.currency || 'KES'; }
  function fmt(n) { return cur() + ' ' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-KE'); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDate(t) { var d = new Date(t); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtTime(t) { var d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function fmtDateTime(t) { return fmtDate(t) + ', ' + fmtTime(t); }
  function startOfDay(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function who() {
    if (role === 'owner') return 'Owner';
    var s = shop && shop.staff && me && shop.staff[me.uid];
    return (s && s.name) || 'Sales person';
  }
  function saleNumber(t) {
    var d = new Date(t);
    return p2(d.getFullYear() % 100) + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var ICON = {
    sell: '<svg viewBox="0 0 24 24"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.3"/></svg>',
    stock: '<svg viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v8l-9 5-9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
    count: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/></svg>',
    reports: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg>',
    today: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
    cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4V8z"/><circle cx="12" cy="13" r="3.5"/></svg>'
  };

  /* ---------- small UI helpers ---------- */
  var toastTimer = null;
  function toast(text, kind) {
    var t = $('#toast');
    t.textContent = text; t.className = 'show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, kind === 'bad' ? 6000 : 2600);
  }
  function friendly(e) {
    var code = (e && e.code) || '', m = {
      'auth/invalid-credential': 'Wrong email or password.', 'auth/wrong-password': 'Wrong email or password.',
      'auth/user-not-found': 'Wrong email or password.', 'auth/invalid-email': 'That email address is not valid.',
      'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
      'auth/weak-password': 'The password must be at least 6 characters.',
      'auth/network-request-failed': 'No internet connection.', 'auth/too-many-requests': 'Too many tries. Wait a few minutes.',
      'auth/operation-not-allowed': 'Email sign-in is not switched on in Firebase yet (Authentication > Sign-in method).',
      'permission-denied': 'This account is not allowed to do that.', 'unavailable': 'No internet connection.'
    };
    return m[code] || m[code.replace('firestore/', '')] || (e && e.message) || String(e);
  }

  function ask(o) {
    return new Promise(function (res) {
      var d = $('#dlg');
      d.innerHTML = '<form class="dlg"><h3>' + esc(o.title) + '</h3>' + (o.html || '') +
        (o.fields || []).map(function (f) {
          return '<label>' + esc(f.label) + '<input name="' + f.name + '" type="' + (f.type || 'text') + '"' +
            (f.inputmode ? ' inputmode="' + f.inputmode + '"' : '') + ' value="' + esc(f.value || '') + '"' +
            (f.required ? ' required' : '') + ' autocomplete="off"></label>';
        }).join('') +
        '<div class="row end">' + (o.noCancel ? '' : '<button type="button" class="btn" data-dlg="cancel">' + esc(o.cancelText || 'Cancel') + '</button>') +
        '<button class="btn ' + (o.danger ? 'danger' : 'primary') + '">' + esc(o.okText || 'OK') + '</button></div></form>';
      var form = $('form', d), settled = false;
      var done = function (v) { if (settled) return; settled = true; if (d.open) d.close(); res(v); if (renderDeferred) render(); };
      form.onsubmit = function (e) {
        e.preventDefault();
        var out = {}; new FormData(form).forEach(function (v, k) { out[k] = String(v).trim(); });
        done(out);
      };
      var cancel = $('[data-dlg=cancel]', d);
      if (cancel) cancel.onclick = function () { done(null); };
      d.oncancel = function (e) { if (o.noCancel) e.preventDefault(); else done(null); };
      d.showModal();
    });
  }

  function qrSvg(code) {
    var qr = window.qrcode(0, 'H');
    qr.addData(String(code), 'Numeric'); qr.make();
    var n = qr.getModuleCount(), q = 3, path = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) path += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
    var size = n + q * 2;
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + path + '" fill="#000"/></svg>';
  }

  var LABELS = {
    'a4-24': { name: 'A4 sheet, 24 labels (70 × 37 mm)', cols: 3, rows: 8, w: 70, h: 37 },
    'a4-40': { name: 'A4 sheet, 40 labels (52.5 × 29.7 mm)', cols: 4, rows: 10, w: 52.5, h: 29.7 },
    'roll-50x30': { name: 'Label printer roll, 50 × 30 mm', w: 50, h: 30, roll: true },
    'roll-40x30': { name: 'Label printer roll, 40 × 30 mm', w: 40, h: 30, roll: true }
  };
  function labelHtml(it) {
    return '<div class="lbl"><div class="qr">' + qrSvg(it.code) + '</div><div class="lt">' +
      '<div class="ls">' + esc(S.shop.name) + '</div><div class="lc">' + esc(it.code) + '</div>' +
      '<div class="ld">' + esc([it.cat, it.size].filter(Boolean).join(' · ')) + '</div>' +
      (S.label.price && it.tag > 0 ? '<div class="lp">' + esc(fmt(it.tag)) + '</div>' : '') + '</div></div>';
  }

  function download(name, text, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- online records (Firebase) ---------- */
  function parseConfig(text) {
    var out = {}, re = /["']?(\w+)["']?\s*:\s*["']([^"']+)["']/g, m;
    while ((m = re.exec(text))) out[m[1]] = m[2];
    return out.apiKey && out.projectId && out.appId ? out : null;
  }
  function FV() { return window.firebase.firestore.FieldValue; }
  function path(a, b) { return new window.firebase.firestore.FieldPath(a, b); }
  function shopRef() { return db.collection('shop').doc('main'); }
  function countRef() { return db.collection('state').doc('count'); }

  // Send a list of changes. Not awaited on purpose: without internet they wait on the phone and upload later.
  function commitOps(ops) {
    for (var i = 0; i < ops.length; i += 400) {
      var batch = db.batch();
      ops.slice(i, i + 400).forEach(function (o) {
        if (o[0] === 'set') batch.set(o[1], o[2]);
        else if (o[0] === 'update') batch.update(o[1], o[2]);
        else batch.delete(o[1]);
      });
      batch.commit().catch(function (e) {
        sync.failed += 1;
        console.error(e);
        toast('A change was NOT saved online: ' + friendly(e) + ' Check the item and try again.', 'bad');
        scheduleRender();
      });
    }
  }

  // Run a change from core.js on what this phone knows, then send exactly what changed.
  function mutate(fn, extraOps) {
    var n = S.log.length, out = fn();
    var logs = S.log.splice(n), touched = {}, ops = [];
    logs.forEach(function (l) { if (l.code) touched[l.code] = 1; });
    Object.keys(touched).forEach(function (code) {
      var after = S.items[code], before = shadow[code] ? JSON.parse(shadow[code]) : null, ref = db.collection('items').doc(code);
      if (!after) { ops.push(['delete', ref]); delete shadow[code]; return; }
      after = clone(after);
      if (!before) ops.push(['set', ref, after]);
      else {
        var patch = {}, any = false;
        Object.keys(after).concat(Object.keys(before)).forEach(function (k) {
          if (JSON.stringify(after[k]) === JSON.stringify(before[k])) return;
          patch[k] = after[k] === undefined ? FV().delete() : after[k]; any = true;
        });
        if (any) ops.push(['update', ref, patch]);
      }
      shadow[code] = JSON.stringify(after);
    });
    logs.forEach(function (l) { l.uid = me.uid; ops.push(['set', db.collection('log').doc(), l]); });
    (extraOps || []).forEach(function (o) { ops.push(o); });
    if (ops.length) commitOps(ops);
    return out;
  }

  function putItem(doc) { var d = doc.data(); S.items[doc.id] = d; shadow[doc.id] = JSON.stringify(d); }
  function applyItems(kind, snap) {
    snap.docChanges().forEach(function (ch) {
      var code = ch.doc.id, mine = S.items[code];
      if (ch.type === 'removed') {
        // Left this list: either it changed status (the other list brings it back) or it was deleted.
        if (mine && (kind === 'open' ? mine.status !== 'sold' : mine.status === 'sold')) { delete S.items[code]; delete shadow[code]; }
      } else putItem(ch.doc);
    });
    sync['pending-' + kind] = snap.metadata.hasPendingWrites;
    sync.pending = !!(sync['pending-open'] || sync['pending-today']);
    scheduleRender();
  }
  function listenErr(what) {
    return function (e) { console.error(what, e); toast('Could not load ' + what + ': ' + friendly(e), 'bad'); };
  }
  function stopListeners() { listeners.forEach(function (u) { try { u(); } catch (e) { /* ignore */ } }); listeners = []; dataStarted = false; }

  function listenToday() {
    dayStart = startOfDay(Date.now());
    return db.collection('items').where('soldAt', '>=', dayStart)
      .onSnapshot({ includeMetadataChanges: true }, function (s) { applyItems('today', s); }, listenErr("today's sales"));
  }
  function startData() {
    if (dataStarted) return;
    dataStarted = true;
    listeners.push(db.collection('items').where('status', 'in', OPEN)
      .onSnapshot({ includeMetadataChanges: true }, function (s) { applyItems('open', s); }, listenErr('the stock list')));
    var today = listenToday();
    listeners.push(function () { today(); });
    listeners.restartToday = function () { today(); today = listenToday(); };
    if (role !== 'owner') return;
    listeners.push(db.collection('log').where('type', '==', 'void').onSnapshot(function (s) {
      ui.voids = s.docs.map(function (d) { return d.data(); }).sort(function (a, b) { return a.t - b.t; }); scheduleRender();
    }, listenErr('cancelled sales')));
    listeners.push(countRef().onSnapshot(function (d) {
      S.count = d.exists ? d.data() : null;
      if (S.count) { S.count.scanned = S.count.scanned || {}; S.count.unknown = S.count.unknown || []; }
      scheduleRender();
    }, listenErr('the stock count')));
    listeners.push(db.collection('counts').orderBy('finishedAt', 'desc').limit(10).onSnapshot(function (s) {
      S.counts = s.docs.map(function (d) { return d.data(); }).reverse(); scheduleRender();
    }, listenErr('past counts')));
  }

  function onShop(doc) {
    if (!doc.exists) { shop = null; screen = 'noshop'; render(); return; }
    shop = doc.data();
    S.shop = { name: shop.name || 'Shop', currency: shop.currency || 'KES' };
    S.categories = shop.categories || S.categories; S.sizes = shop.sizes || S.sizes;
    S.label = shop.label || S.label; S.seq = shop.seq || 1000;
    var newRole = shop.ownerUid === me.uid ? 'owner' : (shop.staff && shop.staff[me.uid] ? 'sales' : '');
    if (!newRole) { stopListeners(); screen = 'denied'; render(); return; }
    if (newRole !== role) { stopData(); role = newRole; }
    var first = screen !== 'app';
    screen = 'app';
    startData();
    if (first) { route = 'sell'; render(); } else scheduleRender();
  }
  var shopUnsub = null;
  function stopData() {
    var keep = shopUnsub; stopListeners();
    S.items = {}; shadow = {}; S.count = null; S.counts = []; ui.voids = []; shopUnsub = keep;
  }
  function onAuth(user) {
    if (shopUnsub) { shopUnsub(); shopUnsub = null; }
    stopData();
    me = user; role = ''; shop = null; ui.basket = [];
    if (!user) { screen = 'signin'; render(); return; }
    screen = 'loading'; render();
    shopUnsub = shopRef().onSnapshot(onShop, function (e) {
      var code = (e && e.code) || '';
      if (code.indexOf('permission-denied') >= 0) { stopListeners(); screen = 'denied'; render(); }
      else toast('Could not reach the shop records: ' + friendly(e), 'bad');
    });
  }

  async function ensureItem(code) {
    if (S.items[code] || !C.validCode(code)) return;
    try { var d = await db.collection('items').doc(code).get(); if (d.exists) putItem(d); } catch (e) { /* offline and never seen: treated as unknown */ }
  }
  async function fetchItems(query) {
    var snap = await query.get();
    snap.docs.forEach(function (d) { if (!S.items[d.id] || !d.metadata.hasPendingWrites) putItem(d); });
  }

  /* ---------- navigation and drawing ---------- */
  var OWNER_TABS = [['sell', 'Sell'], ['tag', 'Tag'], ['stock', 'Stock'], ['count', 'Count'], ['reports', 'Reports']];
  var SALES_TABS = [['sell', 'Sell'], ['today', 'Today']];

  function go(to, arg) {
    if (role !== 'owner' && to !== 'sell' && to !== 'today') to = 'sell';
    if (to !== route || (to !== 'sell' && to !== 'count')) stopScan();
    route = to; routeArg = arg == null ? null : arg;
    if (to === 'reports') loadReport();
    if (to === 'item') loadHistory(arg);
    if (to === 'log') loadRecentLog();
    render();
    window.scrollTo(0, 0);
  }

  // Updates arriving from the other phone redraw the screen, but never while someone is typing.
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(function () { renderQueued = false; softRender(); }, 60);
  }
  function softRender() {
    var a = document.activeElement, typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $('#view').contains(a);
    if (typing || $('#dlg').open) { renderDeferred = true; renderHeader(); return; }
    render();
  }

  function renderHeader() {
    $('#shop-name').textContent = screen === 'app' ? S.shop.name : 'Shop Stock & Sales';
    var line = '', cls = '';
    if (screen === 'app') {
      line = (role === 'owner' ? 'Owner' : who()) + ' · ';
      if (!sync.online) { line += 'No internet: saving on this phone'; cls = 'warn'; }
      else if (sync.pending) { line += 'Uploading…'; cls = 'warn'; }
      else line += 'Saved online';
    }
    var rl = $('#role-line'); rl.textContent = line; rl.className = cls;
    document.body.className = screen === 'app' ? role : '';
    $('#top-actions').innerHTML = screen === 'app' && role === 'owner'
      ? '<button class="icon-btn" data-act="go" data-to="settings" aria-label="Settings">' + ICON.gear + '</button>' : '';
  }

  function render() {
    renderDeferred = false;
    renderHeader();
    if (screen !== 'app') {
      $('#tabs').innerHTML = ''; $('#banner').innerHTML = '';
      $('#view').innerHTML = ({ loading: viewLoading, connect: viewConnect, signin: viewSignin, noshop: viewNoShop, denied: viewDenied }[screen] || viewLoading)();
      return;
    }
    var tabs = role === 'owner' ? OWNER_TABS : SALES_TABS;
    var base = route === 'item' ? 'stock' : route === 'labels' ? 'tag' : route;
    $('#tabs').innerHTML = tabs.map(function (t) {
      return '<button data-act="go" data-to="' + t[0] + '"' + (t[0] === base ? ' class="on"' : '') + '>' + ICON[t[0]] + '<span>' + t[1] + '</span></button>';
    }).join('');
    var views = { sell: viewSell, today: viewToday, tag: viewTag, labels: viewLabels, stock: viewStock, item: viewItem,
      count: viewCount, reports: viewReports, settings: viewSettings, log: viewLog };
    $('#view').innerHTML = (views[route] || viewSell)();
    $('#banner').innerHTML = sync.failed ? '<div class="banner bad"><span>' + sync.failed + ' change' + (sync.failed === 1 ? ' was' : 's were') +
      ' rejected and not saved online. What you see now is the true record.</span><button class="btn small" data-act="clear-failed">OK</button></div>' : '';
  }

  /* ---------- connect, sign in, create shop ---------- */
  function viewLoading() { return '<p class="muted center pad">Loading…</p>'; }
  function viewConnect() {
    return '<form class="card" data-form="connect"><h2>Connect this phone</h2>' +
      '<p class="muted">Paste the Firebase settings for your shop here (the block that starts with <b>const firebaseConfig</b>). See the README for where to find it. Every phone uses the same block.</p>' +
      '<label>Firebase settings<textarea name="config" rows="9" required placeholder="const firebaseConfig = {&#10;  apiKey: &quot;...&quot;,&#10;  projectId: &quot;...&quot;,&#10;  ...&#10;};"></textarea></label>' +
      '<button class="btn primary big">Connect</button></form>';
  }
  function viewSignin() {
    var create = ui.signMode === 'create';
    return '<form class="card" data-form="signin"><h2>' + (create ? 'Create the owner account' : 'Sign in') + '</h2>' +
      (create ? '<p class="muted">Do this once, on the owner\'s phone. Sales people get their logins from the owner afterwards.</p>' : '') +
      '<label>Email<input name="email" type="email" required autocomplete="username"></label>' +
      '<label>Password<input name="pw" type="password" required minlength="6" autocomplete="' + (create ? 'new-password' : 'current-password') + '"></label>' +
      (create ? '<label>Repeat the password<input name="pw2" type="password" required minlength="6" autocomplete="new-password"></label>' : '') +
      '<button class="btn primary big">' + (create ? 'Create account' : 'Sign in') + '</button>' +
      '<p class="muted small center"><button type="button" class="link" data-act="sign-mode">' +
      (create ? 'I already have a login' : 'Owner, first time? Create the owner account') + '</button></p>' +
      (cfgFromFile ? '' : '<p class="muted small center"><button type="button" class="link" data-act="disconnect">Use different Firebase settings</button></p>') + '</form>';
  }
  function viewNoShop() {
    return '<form class="card" data-form="create-shop"><h2>Set up the shop</h2>' +
      '<p class="muted">No shop has been set up on these records yet. The account you are signed in with (' + esc(me.email) + ') becomes the owner.</p>' +
      '<label>Shop name<input name="name" value="Kidsclosetbydee" required></label>' +
      '<button class="btn primary big">Create shop</button>' +
      '<button type="button" class="btn ghost" data-act="sign-out">Sign out</button></form>';
  }
  function viewDenied() {
    return '<div class="card"><h2>Not added to this shop</h2><p class="muted">The account ' + esc(me && me.email) +
      ' has not been added to the shop. Ask the owner to add you under Settings &gt; Sales people, then sign in again.</p>' +
      '<button class="btn" data-act="sign-out">Sign out</button></div>';
  }

  /* ---------- scanning ---------- */
  async function startScan() {
    var box = $('#scanbox');
    box.hidden = false;
    setScanMsg('Hold the tag\'s square code inside the frame', '');
    try {
      await Scanner.start($('#cam'), onScan);
      $('#torch-btn').hidden = !Scanner.hasTorch();
    } catch (e) {
      box.hidden = true;
      toast(e.message, 'bad');
    }
    render();
  }
  function stopScan() {
    if (Scanner.running()) Scanner.stop();
    $('#scanbox').hidden = true;
  }
  function setScanMsg(text, kind) { var m = $('#scan-msg'); m.textContent = text; m.className = kind || ''; }
  function feedback(kind, text) {
    Scanner.beep(kind);
    if (Scanner.running()) setScanMsg(text, kind); else toast(text, kind === 'ok' ? '' : 'bad');
  }
  function onScan(text) {
    if (route === 'sell') addToBasket(text);
    else if (route === 'count' && S.count) countScan(text);
  }

  /* ---------- SELL ---------- */
  async function addToBasket(raw) {
    var code = C.normCode(raw);
    if (!C.validCode(code)) return feedback('bad', code ? 'Tag number ' + code + ' is not valid. Check the digits.' : 'That is not a shop tag.');
    await ensureItem(code);
    var it = S.items[code];
    if (!it) return feedback('bad', 'Tag ' + code + ' is not in the system' + (sync.online ? '' : ' (or cannot be checked without internet)') + '. Tell the owner.');
    if (it.status === 'sold') return feedback('bad', 'Tag ' + code + ' was already sold on ' + fmtDate(it.soldAt) + '. Keep it aside and tell the owner.');
    if (it.status !== 'in') return feedback('bad', 'Tag ' + code + ' is marked ' + C.statusLabel(it.status) + '. Keep it aside and tell the owner.');
    if (ui.basket.some(function (l) { return l.code === code; })) return feedback('warn', 'Tag ' + code + ' is already in this sale.');
    ui.basket.push({ code: code, price: it.tag > 0 ? String(it.tag) : '' });
    feedback('ok', 'Added: ' + C.describe(it));
    render();
  }
  function basketTotal() { return ui.basket.reduce(function (s, l) { return s + (Number(l.price) || 0); }, 0); }

  function viewSell() {
    // If the other phone sold or removed something that is in this basket, drop it here.
    var gone = ui.basket.filter(function (l) { return !S.items[l.code] || S.items[l.code].status !== 'in'; });
    if (gone.length) ui.basket = ui.basket.filter(function (l) { return gone.indexOf(l) < 0; });
    var html = (gone.length ? '<div class="banner bad"><span>Removed from this sale, no longer in stock: tag ' + gone.map(function (l) { return l.code; }).join(', ') + '</span></div>' : '') +
      '<div class="card"><button class="btn primary big" data-act="scan-toggle">' + ICON.cam + (Scanner.running() ? ' Close camera' : ' Scan a tag') + '</button>' +
      '<form class="row" data-form="add-code"><input name="code" inputmode="numeric" placeholder="or type the tag number" autocomplete="off" aria-label="Tag number">' +
      '<button class="btn">Add</button></form></div>';
    if (!ui.basket.length) {
      return html + '<p class="muted center pad">Scan each item the customer is buying. They will be listed here with their prices.</p>';
    }
    html += '<div class="card"><h2>This sale <span class="pill">' + ui.basket.length + (ui.basket.length === 1 ? ' item' : ' items') + '</span></h2>';
    ui.basket.forEach(function (l, i) {
      var it = S.items[l.code];
      html += '<div class="line"><div class="grow"><b>' + esc(C.describe(it)) + '</b><small>Tag ' + esc(l.code) +
        (it.tag > 0 ? ' · tag price ' + fmt(it.tag) : '') + (role === 'owner' ? ' · cost ' + fmt(it.buy) : '') + '</small></div>' +
        '<input class="price" inputmode="decimal" data-input="price" data-i="' + i + '" value="' + esc(l.price) + '" placeholder="Price" aria-label="Selling price for tag ' + esc(l.code) + '">' +
        '<button class="x" data-act="basket-remove" data-i="' + i + '" aria-label="Remove">×</button></div>';
    });
    html += '<div class="seg" role="group" aria-label="Payment">' + C.PAYMENTS.map(function (p) {
      return '<button data-act="pay" data-pay="' + p + '"' + (ui.pay === p ? ' class="on"' : '') + '>' + p + '</button>';
    }).join('') + '</div>' +
      '<div class="total"><span>Total</span><b id="basket-total">' + fmt(basketTotal()) + '</b></div>' +
      '<button class="btn primary big" data-act="complete-sale">Complete sale</button>' +
      '<button class="btn ghost" data-act="basket-clear">Cancel this sale</button></div>';
    return html;
  }

  async function completeSale() {
    var res, now = Date.now();
    try {
      res = mutate(function () { return C.sell(S, ui.basket, { pay: ui.pay, by: who(), uid: me.uid, saleId: saleNumber(now) }, now); });
    } catch (e) { if (e.user) return toast(e.message, 'bad'); throw e; }
    var pay = ui.pay;
    ui.basket = [];
    Scanner.beep('ok');
    render();
    await ask({
      title: 'Sale recorded', okText: 'Next customer', noCancel: true,
      html: '<p class="bigsum">' + fmt(res.total) + '</p><p class="muted center">' + res.count + (res.count === 1 ? ' item' : ' items') + ' · ' + esc(pay) + ' · ' + fmtDateTime(now) +
        '<br>Sale no. ' + esc(res.saleId) + (sync.online ? '' : '<br><b>No internet now. It will upload when the connection returns.</b>') + '</p>'
    });
  }

  /* ---------- TODAY ---------- */
  function saleRows(codes, showProfit) {
    if (!codes.length) return '<p class="muted">No sales.</p>';
    return codes.map(function (code) {
      var it = S.items[code];
      return '<div class="line"' + (role === 'owner' ? ' data-act="item" data-code="' + code + '"' : '') + '><div class="grow"><b>' + esc(C.describe(it)) + '</b><small>' +
        fmtTime(it.soldAt) + ' · tag ' + code + ' · ' + esc(it.pay) + ' · ' + esc(it.soldBy || '') +
        (showProfit ? ' · profit ' + fmt(it.soldPrice - it.buy) : '') + '</small></div><b>' + fmt(it.soldPrice) + '</b></div>';
    }).join('');
  }
  function viewToday() {
    var from = startOfDay(Date.now()), r = C.report(S, from, from + C.DAY);
    return '<div class="card"><h2>Today, ' + fmtDate(Date.now()) + '</h2><div class="tiles">' +
      tile('Items sold', r.n) + tile('Total', fmt(r.revenue)) +
      C.PAYMENTS.map(function (p) { return r.byPay[p] ? tile(p, fmt(r.byPay[p].amount)) : ''; }).join('') +
      '</div></div><div class="card"><h2>Sales</h2>' + saleRows(r.sales, false) + '</div>' +
      '<div class="card"><p class="muted small">Signed in as ' + esc(who()) + ' (' + esc(me.email) + ')</p><button class="btn" data-act="sign-out">Sign out</button></div>';
  }
  function tile(label, value, cls) { return '<div class="tile ' + (cls || '') + '"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>'; }

  /* ---------- TAG ---------- */
  function viewTag() {
    var f = ui.tagForm, st = C.stock(S, Date.now()), html = '';
    if (ui.lastTagged.length) {
      var codes = ui.lastTagged.filter(function (c) { return S.items[c]; });
      if (codes.length) html += '<div class="card good"><h2>' + codes.length + (codes.length === 1 ? ' item tagged' : ' items tagged') + '</h2>' +
        '<p>Tag number' + (codes.length === 1 ? ' <b>' + codes[0] + '</b>' : 's <b>' + codes[0] + '</b> to <b>' + codes[codes.length - 1] + '</b>') +
        ', dated ' + fmtDate(Date.now()) + '. Print the labels, or write the number on each tag by hand for now.</p>' +
        '<div class="lbl-preview" style="--w:70mm;--h:30mm">' + codes.slice(0, 2).map(function (c) { return labelHtml(S.items[c]); }).join('') + '</div>' +
        '<button class="btn primary" data-act="labels-last">Print ' + (codes.length === 1 ? 'this label' : 'these labels') + '</button></div>';
    }
    html += '<form class="card" data-form="tag"><h2>Tag new stock</h2>' +
      '<label>Category<select name="cat" required><option value="">Choose…</option>' + S.categories.map(function (c) {
        return '<option' + (c === f.cat ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('') + '</select></label>' +
      '<div class="lab">For</div><div class="seg">' + ['Boys', 'Girls', 'Unisex'].map(function (g) {
        return '<label><input type="radio" name="gender" value="' + g + '"' + (f.gender === g ? ' checked' : '') + '><span>' + g + '</span></label>';
      }).join('') + '</div>' +
      '<label>Size or age<input name="size" list="size-list" value="' + esc(f.size || '') + '" placeholder="e.g. 2-3y" autocomplete="off"></label>' +
      '<datalist id="size-list">' + S.sizes.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' +
      '<label>Description (optional)<input name="desc" value="' + esc(f.desc || '') + '" placeholder="e.g. blue stripes" autocomplete="off"></label>' +
      '<div class="two"><label>Buying price (' + cur() + ')<input name="buy" inputmode="decimal" value="' + esc(f.buy || '') + '" required autocomplete="off"></label>' +
      '<label>Tag price (' + cur() + ')<input name="tag" inputmode="decimal" value="' + esc(f.tag || '') + '" autocomplete="off"></label></div>' +
      '<label>How many identical pieces?<input name="qty" inputmode="numeric" value="' + esc(f.qty || '1') + '" autocomplete="off"></label>' +
      '<p class="muted small">Each piece gets its own number. The tag price is what you expect to sell at; a sale below it is flagged in your reports. Tagging needs internet.</p>' +
      '<button class="btn primary big"' + (ui.busy ? ' disabled' : '') + '>Save and create tag</button></form>';
    if (st.unprinted) {
      html += '<div class="card"><div class="row between"><span><b>' + st.unprinted + '</b> label' + (st.unprinted === 1 ? '' : 's') + ' not printed yet</span>' +
        '<button class="btn" data-act="labels-unprinted">Print labels</button></div></div>';
    }
    return html;
  }

  /* ---------- LABELS ---------- */
  function labelCodes() {
    var codes = ui.labelCodes || Object.keys(S.items).filter(function (c) { return S.items[c].status === 'in' && !S.items[c].printed; });
    return codes.filter(function (c) { return S.items[c]; }).sort();
  }
  function viewLabels() {
    var codes = labelCodes(), L = LABELS[S.label.size] || LABELS['a4-24'];
    if (!codes.length) return '<div class="card"><h2>Labels</h2><p class="muted">Every label has been printed. To print one again, open the item from Stock.</p></div>';
    return '<div class="card"><h2>Print ' + codes.length + ' label' + (codes.length === 1 ? '' : 's') + '</h2>' +
      '<label>Label paper<select data-change="label-size">' + Object.keys(LABELS).map(function (k) {
        return '<option value="' + k + '"' + (k === S.label.size ? ' selected' : '') + '>' + LABELS[k].name + '</option>';
      }).join('') + '</select></label>' +
      '<label class="check"><input type="checkbox" data-change="label-price"' + (S.label.price ? ' checked' : '') + '> Show the tag price on the label</label>' +
      (L.roll ? '' : '<label class="check"><input type="checkbox" data-change="label-cut"' + (S.label.cut ? ' checked' : '') + '> Print cutting lines (for plain paper)</label>') +
      '<div class="lbl-preview" style="--w:' + L.w + 'mm;--h:' + L.h + 'mm">' + codes.slice(0, 3).map(function (c) { return labelHtml(S.items[c]); }).join('') + '</div>' +
      (codes.length > 3 ? '<p class="muted small">…and ' + (codes.length - 3) + ' more.</p>' : '') +
      '<button class="btn primary big" data-act="print-labels">Print</button>' +
      '<button class="btn" data-act="labels-done">They printed fine, mark as printed</button>' +
      '<p class="muted small">In the print window choose paper size A4 (or your label size), margins "None" and scale 100%. Test one page on plain paper first.</p></div>';
  }
  function printLabels() {
    var codes = labelCodes(), L = LABELS[S.label.size] || LABELS['a4-24'], html = '';
    if (L.roll) {
      html = codes.map(function (c) { return '<div class="sheet roll">' + labelHtml(S.items[c]) + '</div>'; }).join('');
    } else {
      var per = L.cols * L.rows;
      for (var i = 0; i < codes.length; i += per) {
        html += '<div class="sheet">' + codes.slice(i, i + per).map(function (c) { return labelHtml(S.items[c]); }).join('') + '</div>';
      }
    }
    var area = $('#print-area');
    area.className = (L.roll ? 'roll' : 'a4') + (S.label.cut && !L.roll ? ' cut' : '');
    area.setAttribute('style', '--w:' + L.w + 'mm;--h:' + L.h + 'mm;--cols:' + (L.cols || 1));
    area.innerHTML = html;
    var st = $('#page-style') || document.head.appendChild(Object.assign(document.createElement('style'), { id: 'page-style' }));
    st.textContent = '@page{size:' + (L.roll ? L.w + 'mm ' + L.h + 'mm' : 'A4') + ';margin:0}';
    window.print();
  }
  function saveLabelPrefs() { shopRef().update({ label: clone(S.label) }).catch(function (e) { toast(friendly(e), 'bad'); }); }

  /* ---------- STOCK ---------- */
  function stockMatches() {
    var f = ui.stock, words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    var list = Object.keys(S.items).map(function (c) { return S.items[c]; }).filter(function (it) {
      if (!words.length || !C.validCode(C.normCode(f.q))) { if (it.status !== f.status) return false; }
      if (f.cat && it.cat !== f.cat) return false;
      if (!words.length) return true;
      var hay = (it.code + ' ' + it.cat + ' ' + it.gender + ' ' + it.size + ' ' + it.desc).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    list.sort(function (a, b) { return (b.soldAt || b.taggedAt) - (a.soldAt || a.taggedAt) || (a.code < b.code ? 1 : -1); });
    return list;
  }
  function itemRow(it) {
    var right = it.status === 'sold' ? fmt(it.soldPrice) : it.tag > 0 ? fmt(it.tag) : '';
    var sub = it.status === 'sold' ? 'sold ' + fmtDate(it.soldAt) : it.status === 'in' ? 'tagged ' + fmtDate(it.taggedAt) : C.statusLabel(it.status) + ' since ' + fmtDate(it.outAt);
    return '<div class="line" data-act="item" data-code="' + it.code + '"><div class="grow"><b>' + esc(C.describe(it)) + '</b><small>Tag ' + it.code + ' · ' + sub + '</small></div>' +
      '<span class="right"><b>' + right + '</b><span class="st ' + it.status + '">' + C.statusLabel(it.status) + '</span></span></div>';
  }
  function stockListHtml() {
    var list = stockMatches(), f = ui.stock;
    var note = f.status === 'sold' ? '<p class="muted small">Showing the most recent sales. Type a tag number to find an older one.</p>' : '';
    if (!list.length) return note + '<p class="muted pad center">' + (f.q || f.cat || f.status !== 'in' ? 'Nothing matches.' : 'No stock yet. Go to Tag to add your first items.') + '</p>';
    return note + '<p class="muted small">' + list.length + ' item' + (list.length === 1 ? '' : 's') + '</p>' + list.slice(0, f.limit).map(itemRow).join('') +
      (list.length > f.limit ? '<button class="btn ghost" data-act="stock-more">Show more</button>' : '');
  }
  function viewStock() {
    var st = C.stock(S, Date.now()), f = ui.stock;
    return '<div class="card"><div class="tiles">' + tile('In stock', st.inN) + tile('Stock at cost', fmt(st.inCost)) +
      tile('Missing', st.missingN, st.missingN ? 'bad' : '') + tile('Written off', st.writeoffN) + '</div></div>' +
      '<div class="card"><input type="search" data-input="stock-q" value="' + esc(f.q) + '" placeholder="Search tag number, category, size…" aria-label="Search stock">' +
      '<div class="chips">' + [['in', 'In stock'], ['sold', 'Sold'], ['missing', 'Missing'], ['writeoff', 'Written off']].map(function (s) {
        return '<button data-act="stock-status" data-status="' + s[0] + '"' + (f.status === s[0] ? ' class="on"' : '') + '>' + s[1] + '</button>';
      }).join('') + '</div>' +
      '<select data-change="stock-cat" aria-label="Category"><option value="">All categories</option>' + S.categories.map(function (c) {
        return '<option' + (c === f.cat ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('') + '</select><div id="stock-list">' + stockListHtml() + '</div></div>';
  }

  function loadHistory(code) {
    ui.hist = { code: code, list: null };
    db.collection('log').where('code', '==', code).get().then(function (s) {
      if (ui.hist.code !== code) return;
      ui.hist.list = s.docs.map(function (d) { return d.data(); }).sort(function (a, b) { return b.t - a.t; });
      scheduleRender();
    }).catch(function () { if (ui.hist.code === code) { ui.hist.list = []; scheduleRender(); } });
  }
  function viewItem() {
    var it = S.items[routeArg];
    if (!it) return '<div class="card"><p>This item no longer exists.</p><button class="btn" data-act="go" data-to="stock">Back to stock</button></div>';
    var rows = [['Tag number', it.code], ['Category', it.cat], ['For', it.gender], ['Size', it.size], ['Description', it.desc],
      ['Buying price', fmt(it.buy)], ['Tag price', it.tag > 0 ? fmt(it.tag) : 'not set'], ['Date tagged', fmtDateTime(it.taggedAt)],
      ['Status', C.statusLabel(it.status)]];
    if (it.status === 'sold') {
      rows.push(['Date sold', fmtDateTime(it.soldAt)], ['Selling price', fmt(it.soldPrice)], ['Profit', fmt(it.soldPrice - it.buy)],
        ['Payment', it.pay], ['Sold by', it.soldBy], ['Sale number', it.saleId]);
    } else if (it.status !== 'in') { rows.push(['Since', fmtDateTime(it.outAt)], ['Note', it.note]); }
    var acts = '<button class="btn" data-act="item-edit">Edit details</button><button class="btn" data-act="item-label">Print label</button>';
    if (it.status === 'in') {
      acts += '<button class="btn" data-act="item-out" data-status="missing">Mark missing</button>' +
        '<button class="btn" data-act="item-out" data-status="writeoff">Write off (damaged, gift)</button>' +
        '<button class="btn danger-outline" data-act="item-delete">Delete (tagged by mistake)</button>';
    } else {
      acts += '<button class="btn" data-act="item-return">' + (it.status === 'sold' ? 'Cancel the sale, return to stock' : 'Found, return to stock') + '</button>';
    }
    return '<button class="btn ghost back" data-act="go" data-to="stock">‹ Stock</button>' +
      '<div class="card"><h2>' + esc(C.describe(it)) + ' <span class="st ' + it.status + '">' + C.statusLabel(it.status) + '</span></h2>' +
      '<div class="lbl-preview" style="--w:70mm;--h:30mm">' + labelHtml(it) + '</div>' +
      '<dl>' + rows.filter(function (r) { return r[1] !== '' && r[1] != null; }).map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>' +
      '<div class="acts">' + acts + '</div></div>' +
      '<div class="card"><h2>History</h2>' + (ui.hist.code === it.code && ui.hist.list ? logRows(ui.hist.list) : '<p class="muted">Loading…</p>') + '</div>';
  }
  function logRows(list) {
    if (!list.length) return '<p class="muted">Nothing yet.</p>';
    var names = { tagged: 'Tagged', sold: 'Sold', 'void': 'Sale cancelled', found: 'Returned to stock', missing: 'Marked missing',
      writeoff: 'Written off', edited: 'Edited', deleted: 'Deleted', 'count-start': 'Stock count started',
      'count-finish': 'Stock count finished', 'count-cancel': 'Stock count cancelled' };
    return list.map(function (l) {
      return '<div class="line"><div class="grow"><b>' + (names[l.type] || esc(l.type)) + (l.code ? ' · tag ' + esc(l.code) : '') + '</b><small>' +
        fmtDateTime(l.t) + (l.by ? ' · ' + esc(l.by) : '') + (l.info ? ' · ' + esc(l.info) : '') + '</small></div></div>';
    }).join('');
  }
  function loadRecentLog() {
    ui.recentLog = null;
    db.collection('log').orderBy('t', 'desc').limit(300).get().then(function (s) {
      ui.recentLog = s.docs.map(function (d) { return d.data(); }); scheduleRender();
    }).catch(function (e) { ui.recentLog = []; toast(friendly(e), 'bad'); scheduleRender(); });
  }
  function viewLog() {
    return '<button class="btn ghost back" data-act="go" data-to="settings">‹ Settings</button><div class="card"><h2>Activity log</h2>' +
      '<p class="muted small">Every change on every phone, newest first (last 300). Nothing here can be edited.</p>' +
      (ui.recentLog ? logRows(ui.recentLog) : '<p class="muted">Loading…</p>') + '</div>';
  }

  /* ---------- COUNT ---------- */
  async function countScan(raw) {
    var code = C.normCode(raw), r, now = Date.now();
    await ensureItem(code);
    if (!S.count) return;
    try { r = C.countScan(S, raw, now); } catch (e) { return toast(e.message, 'bad'); }
    var d = r.item ? C.describe(r.item) : '';
    if (r.kind === 'ok') feedback('ok', 'Counted: ' + d);
    else if (r.kind === 'dup') feedback('warn', 'Already counted: ' + d);
    else if (r.kind === 'sold') feedback('bad', 'SOLD item on the rack: tag ' + r.item.code + '. Put it aside.');
    else if (r.kind === 'found') feedback('warn', 'Was marked ' + C.statusLabel(r.item.status) + ', now found: ' + d);
    else if (r.kind === 'scope') feedback('warn', 'Other category (' + r.item.cat + '), not part of this count.');
    else feedback('bad', 'Unknown tag ' + r.code + '. Put it aside.');
    var save = null;
    if (r.kind === 'unknown') save = countRef().update({ unknown: FV().arrayUnion(r.code) });
    else if (r.kind === 'ok' || r.kind === 'sold' || r.kind === 'found') save = countRef().update(path('scanned', r.item.code), now);
    if (save) save.catch(function (e) { toast('Count not saved online: ' + friendly(e), 'bad'); });
    render();
  }
  function codeList(codes, max) {
    return codes.slice(0, max).map(function (c) { return S.items[c] ? itemRow(S.items[c]) : ''; }).join('') +
      (codes.length > max ? '<p class="muted small">…and ' + (codes.length - max) + ' more.</p>' : '');
  }
  function viewCount() {
    if (!S.count) {
      var past = S.counts.slice().reverse().slice(0, 10).map(function (c) {
        return '<div class="line"><div class="grow"><b>' + fmtDate(c.finishedAt) + ' · ' + esc(c.scope || 'Whole shop') + '</b><small>' + c.counted + ' of ' + c.expected +
          ' found · ' + c.missing.length + ' missing (' + fmt(c.missingCost) + ')' + (c.soldOnRack.length ? ' · ' + c.soldOnRack.length + ' sold items on rack' : '') +
          (c.unknown.length ? ' · ' + c.unknown.length + ' unknown tags' : '') + '</small></div></div>';
      }).join('');
      return '<form class="card" data-form="count-start"><h2>Stock count</h2>' +
        '<p class="muted">Scan every piece on the racks. The system then shows what should be there but was not found.</p>' +
        '<label>What to count<select name="scope"><option value="">Whole shop</option>' + S.categories.filter(function (c) {
          return Object.keys(S.items).some(function (k) { return S.items[k].cat === c && S.items[k].status === 'in'; });
        }).map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
        '<button class="btn primary big">Start counting</button></form>' +
        '<div class="card"><h2>Past counts</h2>' + (past || '<p class="muted">None yet.</p>') + '</div>';
    }
    var c = S.count, r = C.countReview(S), pct = r.expected ? Math.round(100 * r.counted / r.expected) : 0;
    var head = '<div class="card"><h2>Counting: ' + esc(c.scope || 'whole shop') + '</h2><p class="muted small">Started ' + fmtDateTime(c.startedAt) + '. Selling can continue while you count.</p>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div><div class="tiles">' + tile('Counted', r.counted + ' of ' + r.expected) +
      tile('Still to find', r.missing.length, r.missing.length ? 'warn' : 'ok') + '</div>';
    if (ui.countView === 'review') {
      return head + '</div>' +
        '<div class="card"><h2>Not found <span class="pill bad">' + r.missing.length + '</span></h2>' +
        (r.missing.length ? '<p class="muted small">Worth ' + fmt(r.missingCost) + ' at buying price. Finishing the count marks these as missing.</p>' + codeList(r.missing, 200) : '<p class="muted">Everything was found.</p>') + '</div>' +
        (r.soldOnRack.length ? '<div class="card"><h2>Recorded as sold, but on the rack <span class="pill bad">' + r.soldOnRack.length + '</span></h2><p class="muted small">Either a return that was not recorded, or a sale entered against the wrong tag. Open each one to check.</p>' + codeList(r.soldOnRack, 100) + '</div>' : '') +
        (r.found.length ? '<div class="card"><h2>Found again <span class="pill">' + r.found.length + '</span></h2><p class="muted small">These were marked missing or written off. Finishing returns them to stock.</p>' + codeList(r.found, 100) + '</div>' : '') +
        (r.unknown.length ? '<div class="card"><h2>Unknown tags <span class="pill bad">' + r.unknown.length + '</span></h2><p>' + r.unknown.map(esc).join(', ') + '</p></div>' : '') +
        '<div class="card"><button class="btn primary big" data-act="count-finish">Finish count' + (r.missing.length ? ' and mark ' + r.missing.length + ' missing' : '') + '</button>' +
        '<button class="btn" data-act="count-view" data-view="scan">Keep counting</button>' +
        '<button class="btn ghost" data-act="count-cancel">Throw this count away</button></div>';
    }
    return head + '<button class="btn primary big" data-act="scan-toggle">' + ICON.cam + (Scanner.running() ? ' Close camera' : ' Scan tags') + '</button>' +
      '<form class="row" data-form="count-code"><input name="code" inputmode="numeric" placeholder="or type the tag number" autocomplete="off" aria-label="Tag number"><button class="btn">Count</button></form></div>' +
      '<div class="card"><button class="btn" data-act="count-remaining">' + (ui.showRemaining ? 'Hide' : 'Show') + ' what is still to find (' + r.missing.length + ')</button>' +
      (ui.showRemaining ? codeList(r.missing, 100) : '') +
      '<button class="btn primary" data-act="count-view" data-view="review">Review and finish</button></div>';
  }

  /* ---------- REPORTS ---------- */
  function repRange() {
    var f = ui.rep, now = Date.now(), t0 = startOfDay(now), d = new Date(t0);
    if (f.range === 'yesterday') return [t0 - C.DAY, t0, 'Yesterday'];
    if (f.range === 'week') return [startOfDay(t0 - 6 * C.DAY), t0 + C.DAY, 'Last 7 days'];
    if (f.range === 'month') return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), t0 + C.DAY, MONTHS[d.getMonth()] + ' ' + d.getFullYear()];
    if (f.range === 'lastmonth') {
      var a = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      return [a.getTime(), new Date(d.getFullYear(), d.getMonth(), 1).getTime(), MONTHS[a.getMonth()] + ' ' + a.getFullYear()];
    }
    if (f.range === 'custom' && f.from && f.to) {
      var x = new Date(f.from + 'T00:00:00').getTime(), y = new Date(f.to + 'T00:00:00').getTime();
      if (y < x) { var z = x; x = y; y = z; }
      return [x, startOfDay(y + 26 * 3600000), fmtDate(x) + ' to ' + fmtDate(y)];
    }
    return [t0, t0 + C.DAY, 'Today, ' + fmtDate(now)];
  }
  // Older sales are not kept on the phone all the time; fetch the chosen period when the report opens.
  function loadReport() {
    var rg = repRange(), key = rg[0] + '-' + rg[1];
    if (rg[0] >= dayStart) { ui.rep.loaded = key; ui.rep.loading = false; return; }   // today is always live
    ui.rep.loading = true; ui.rep.loaded = '';
    fetchItems(db.collection('items').where('soldAt', '>=', rg[0]).where('soldAt', '<', rg[1])).then(function () {
      ui.rep.loaded = key;
    }).catch(function (e) { toast('Could not load that period: ' + friendly(e), 'bad'); }).then(function () {
      ui.rep.loading = false; scheduleRender();
    });
  }
  function breakdown(map, withProfit) {
    var keys = Object.keys(map).sort(function (a, b) { return map[b].amount - map[a].amount; });
    if (!keys.length) return '<p class="muted">No sales.</p>';
    return keys.map(function (k) {
      return '<div class="line"><div class="grow"><b>' + esc(k) + '</b><small>' + map[k].n + ' item' + (map[k].n === 1 ? '' : 's') +
        (withProfit ? ' · profit ' + fmt(map[k].profit) : '') + '</small></div><b>' + fmt(map[k].amount) + '</b></div>';
    }).join('');
  }
  function reportData() { var rg = repRange(); return C.report({ items: S.items, log: ui.voids }, rg[0], rg[1]); }
  function viewReports() {
    var rg = repRange(), r = reportData(), st = C.stock(S, Date.now()), f = ui.rep;
    var margin = r.revenue ? Math.round(100 * r.profit / r.revenue) + '%' : '0%';
    var flags = '';
    if (r.belowTag.length) flags += '<h3>Sold below the tag price <span class="pill bad">' + r.belowTag.length + '</span></h3>' + r.belowTag.map(function (c) {
      var it = S.items[c];
      return '<div class="line" data-act="item" data-code="' + c + '"><div class="grow"><b>' + esc(C.describe(it)) + '</b><small>Tag ' + c + ' · ' + esc(it.soldBy || '') + ' · ' + fmtDate(it.soldAt) +
        '</small></div><span class="right"><b>' + fmt(it.soldPrice) + '</b><small>tag ' + fmt(it.tag) + '</small></span></div>';
    }).join('');
    if (r.belowCost.length) flags += '<h3>Sold below the buying price <span class="pill bad">' + r.belowCost.length + '</span></h3>' + codeList(r.belowCost, 50);
    if (r.voids.length) flags += '<h3>Cancelled sales <span class="pill bad">' + r.voids.length + '</span></h3>' + logRows(r.voids.slice().reverse());
    return '<div class="card"><div class="chips">' + [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', '7 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['custom', 'Dates']].map(function (c) {
      return '<button data-act="rep-range" data-range="' + c[0] + '"' + (f.range === c[0] ? ' class="on"' : '') + '>' + c[1] + '</button>';
    }).join('') + '</div>' +
      (f.range === 'custom' ? '<div class="two"><label>From<input type="date" data-change="rep-from" value="' + esc(f.from) + '"></label><label>To<input type="date" data-change="rep-to" value="' + esc(f.to) + '"></label></div>' : '') +
      '<h2>' + esc(rg[2]) + '</h2>' + (f.loading ? '<p class="muted">Loading this period…</p>' : '') +
      '<div class="tiles">' + tile('Items sold', r.n) + tile('Sales', fmt(r.revenue)) + tile('Cost of those items', fmt(r.cost)) +
      tile('Profit (' + margin + ')', fmt(r.profit), r.profit < 0 ? 'bad' : 'ok') + '</div>' +
      '<button class="btn" data-act="share-summary">Send this summary (WhatsApp)</button></div>' +
      '<div class="card"><h2>By payment</h2>' + breakdown(r.byPay) + '</div>' +
      '<div class="card"><h2>By sales person</h2>' + breakdown(r.byStaff) + '</div>' +
      '<div class="card"><h2>By category</h2>' + breakdown(r.byCat, true) + '</div>' +
      '<div class="card"><h2>To check</h2>' + (flags || '<p class="muted">Nothing unusual in this period.</p>') + '</div>' +
      '<div class="card"><h2>Stock right now</h2><div class="tiles">' + tile('In stock', st.inN + ' items') + tile('At buying price', fmt(st.inCost)) +
      tile('At tag price', fmt(st.inTag)) + tile('Missing', st.missingN + ' (' + fmt(st.missingCost) + ')', st.missingN ? 'bad' : '') +
      tile('Written off', st.writeoffN + ' (' + fmt(st.writeoffCost) + ')') + '</div>' +
      '<h3>On the rack over 60 days <span class="pill">' + st.slow.length + '</span></h3>' + (st.slow.length ? codeList(st.slow, 20) : '<p class="muted">None.</p>') + '</div>' +
      '<div class="card"><h2>Sales in this period</h2>' + saleRows(r.sales.slice(0, 200), true) + '</div>' +
      '<div class="card"><button class="btn" data-act="export-csv">Download everything for Excel (CSV)</button></div>';
  }
  function summaryText() {
    var rg = repRange(), r = reportData(), st = C.stock(S, Date.now());
    var lines = [S.shop.name + ': ' + rg[2], 'Items sold: ' + r.n, 'Sales: ' + fmt(r.revenue), 'Profit: ' + fmt(r.profit)];
    Object.keys(r.byPay).forEach(function (p) { lines.push(p + ': ' + fmt(r.byPay[p].amount)); });
    if (r.belowTag.length) lines.push('Sold below tag price: ' + r.belowTag.length);
    if (r.voids.length) lines.push('Cancelled sales: ' + r.voids.length);
    lines.push('In stock: ' + st.inN + ' items (' + fmt(st.inCost) + ' at cost)');
    if (st.missingN) lines.push('Missing: ' + st.missingN + ' items (' + fmt(st.missingCost) + ')');
    return lines.join('\n');
  }

  /* ---------- SETTINGS ---------- */
  function viewSettings() {
    var staff = shop.staff || {}, ids = Object.keys(staff);
    return '<form class="card" data-form="settings"><h2>Settings</h2>' +
      '<label>Shop name<input name="name" value="' + esc(S.shop.name) + '" required></label>' +
      '<label>Categories (one per line)<textarea name="categories" rows="8">' + esc(S.categories.join('\n')) + '</textarea></label>' +
      '<label>Sizes (one per line)<textarea name="sizes" rows="6">' + esc(S.sizes.join('\n')) + '</textarea></label>' +
      '<button class="btn primary">Save settings</button></form>' +
      '<div class="card"><h2>Sales people</h2><p class="muted small">Each sales person signs in on the shop phone with the email and password you set here. They can scan, sell and see today\'s sales. They cannot open tagging, counts, reports or settings.</p>' +
      (ids.length ? ids.map(function (id) {
        return '<div class="line"><div class="grow"><b>' + esc(staff[id].name) + '</b><small>' + esc(staff[id].email) + '</small></div>' +
          '<button class="btn small" data-act="staff-remove" data-uid="' + esc(id) + '">Remove</button></div>';
      }).join('') : '<p class="muted">None yet.</p>') +
      '<button class="btn primary" data-act="staff-add">Add a sales person</button></div>' +
      '<div class="card"><h2>Account</h2><p class="muted small">Signed in as owner (' + esc(me.email) + ')</p>' +
      '<button class="btn" data-act="go" data-to="log">Activity log</button>' +
      '<button class="btn" data-act="sign-out">Sign out</button></div>';
  }

  /* ---------- actions ---------- */
  function guard(fn) { try { return fn(); } catch (e) { if (e.user) { toast(e.message, 'bad'); return undefined; } throw e; } }

  var actions = {
    go: function (el) { go(el.dataset.to); },
    item: function (el) {
      if (role !== 'owner') return;
      ensureItem(el.dataset.code).then(function () { go('item', el.dataset.code); });
    },
    'sign-mode': function () { ui.signMode = ui.signMode === 'create' ? 'in' : 'create'; render(); },
    'sign-out': function () { stopScan(); return auth.signOut(); },
    disconnect: function () { try { localStorage.removeItem('shop-pos-firebase'); } catch (e) { /* ignore */ } location.reload(); },
    'clear-failed': function () { sync.failed = 0; render(); },
    'scan-toggle': function () { if (Scanner.running()) { stopScan(); render(); } else startScan(); },
    'scan-stop': function () { stopScan(); render(); },
    torch: function () { Scanner.toggleTorch(); },
    'basket-remove': function (el) { ui.basket.splice(+el.dataset.i, 1); render(); },
    'basket-clear': function () { ui.basket = []; render(); },
    pay: function (el) { ui.pay = el.dataset.pay; render(); },
    'complete-sale': completeSale,
    'labels-last': function () { ui.labelCodes = ui.lastTagged.slice(); go('labels'); },
    'labels-unprinted': function () { ui.labelCodes = null; go('labels'); },
    'print-labels': printLabels,
    'labels-done': function () {
      var ops = labelCodes().map(function (c) {
        S.items[c].printed = true; shadow[c] = JSON.stringify(S.items[c]);
        return ['update', db.collection('items').doc(c), { printed: true }];
      });
      commitOps(ops);
      ui.labelCodes = null; ui.lastTagged = []; toast('Marked as printed.'); go('tag');
    },
    'stock-status': function (el) {
      ui.stock.status = el.dataset.status; ui.stock.limit = 60; render();
      if (ui.stock.status === 'sold') {
        fetchItems(db.collection('items').orderBy('soldAt', 'desc').limit(200)).then(scheduleRender).catch(function (e) { toast(friendly(e), 'bad'); });
      }
    },
    'stock-more': function () { ui.stock.limit += 100; $('#stock-list').innerHTML = stockListHtml(); },
    'item-label': function () { ui.labelCodes = [routeArg]; go('labels'); },
    'item-edit': async function () {
      var it = S.items[routeArg];
      var v = await ask({
        title: 'Edit tag ' + it.code, okText: 'Save',
        fields: [{ name: 'cat', label: 'Category', value: it.cat, required: true }, { name: 'gender', label: 'For (Boys, Girls, Unisex)', value: it.gender },
          { name: 'size', label: 'Size', value: it.size }, { name: 'desc', label: 'Description', value: it.desc },
          { name: 'buy', label: 'Buying price', value: String(it.buy), inputmode: 'decimal', required: true },
          { name: 'tag', label: 'Tag price', value: String(it.tag || 0), inputmode: 'decimal' }]
      });
      if (!v) return;
      if (guard(function () { return mutate(function () { return C.editItem(S, it.code, v, who(), Date.now()); }); }) === undefined) return;
      loadHistory(it.code); render(); toast('Saved.');
    },
    'item-out': async function (el) {
      var status = el.dataset.status, code = routeArg;
      var v = await ask({ title: status === 'missing' ? 'Mark as missing?' : 'Write this item off?', okText: 'Confirm', danger: true,
        fields: [{ name: 'note', label: 'Note (what happened)', required: status === 'writeoff' }] });
      if (!v) return;
      guard(function () { mutate(function () { C.takeOut(S, code, status, v.note, who(), Date.now()); }); });
      loadHistory(code); render();
    },
    'item-return': async function () {
      var it = S.items[routeArg], code = routeArg;
      var v = await ask({ title: it.status === 'sold' ? 'Cancel this sale?' : 'Return to stock?', okText: 'Return to stock',
        html: it.status === 'sold' ? '<p class="muted">The sale of ' + fmt(it.soldPrice) + ' is removed from your sales and stays in the activity log as cancelled.</p>' : '',
        fields: [{ name: 'reason', label: 'Reason', required: true }] });
      if (!v) return;
      guard(function () { mutate(function () { C.returnToStock(S, code, v.reason, who(), Date.now()); }); });
      loadHistory(code); render();
    },
    'item-delete': async function () {
      var code = routeArg;
      var v = await ask({ title: 'Delete this item?', okText: 'Delete', danger: true,
        html: '<p class="muted">Use this only for an item tagged by mistake. The deletion stays in the activity log.</p>',
        fields: [{ name: 'reason', label: 'Reason', required: true }] });
      if (!v) return;
      if (guard(function () { mutate(function () { C.deleteItem(S, code, v.reason, who(), Date.now()); }); return true; })) go('stock');
    },
    'count-view': function (el) { ui.countView = el.dataset.view; if (ui.countView === 'review') stopScan(); render(); window.scrollTo(0, 0); },
    'count-remaining': function () { ui.showRemaining = !ui.showRemaining; render(); },
    'count-finish': async function () {
      var r = C.countReview(S);
      var v = await ask({ title: 'Finish the stock count?', okText: 'Finish', danger: r.missing.length > 0,
        html: '<p>' + r.counted + ' of ' + r.expected + ' items were found.' + (r.missing.length ? ' <b>' + r.missing.length + '</b> will be marked missing (' + fmt(r.missingCost) + ').' : '') + '</p>' });
      if (!v || !S.count) return;
      var summary = null;
      mutate(function () { summary = C.finishCount(S, who(), Date.now()); });
      commitOps([['set', db.collection('counts').doc(), clone(summary)], ['delete', countRef()]]);
      ui.countView = 'scan'; ui.showRemaining = false; render(); toast('Stock count saved.');
    },
    'count-cancel': async function () {
      var v = await ask({ title: 'Throw this count away?', okText: 'Throw away', danger: true, html: '<p class="muted">Nothing will be marked missing.</p>' });
      if (!v) return;
      mutate(function () { C.cancelCount(S, who(), Date.now()); }, [['delete', countRef()]]);
      ui.countView = 'scan'; render();
    },
    'rep-range': function (el) {
      ui.rep.range = el.dataset.range;
      if (ui.rep.range === 'custom' && !ui.rep.from) { ui.rep.from = ui.rep.to = C.isoDay(Date.now()); }
      loadReport(); render();
    },
    'share-summary': async function () {
      var text = summaryText();
      try { if (navigator.share) { await navigator.share({ text: text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    },
    'export-csv': async function () {
      toast('Preparing the file…');
      var snap = await db.collection('items').get(), items = {};
      snap.docs.forEach(function (d) { items[d.id] = d.data(); });
      download('shop-stock-' + C.isoDay(Date.now()) + '.csv', '﻿' + C.toCSV({ items: items }), 'text/csv');
    },
    'staff-add': async function () {
      var v = await ask({ title: 'Add a sales person', okText: 'Create login',
        html: '<p class="muted small">Needs internet. The email is only used as a login name; it does not have to receive mail.</p>',
        fields: [{ name: 'name', label: 'Name', required: true }, { name: 'email', label: 'Email (login name)', type: 'email', required: true },
          { name: 'pw', label: 'Password (at least 6 characters)', required: true }] });
      if (!v) return;
      if (v.pw.length < 6) return toast('The password must be at least 6 characters.', 'bad');
      try {
        // A second connection creates the login, so the owner stays signed in on this phone.
        var app2 = fb.apps.filter(function (a) { return a.name === 'staff-admin'; })[0] || fb.initializeApp(cfg, 'staff-admin');
        var cred = await app2.auth().createUserWithEmailAndPassword(v.email, v.pw);
        var uid = cred.user.uid;
        await app2.auth().signOut();
        await shopRef().update(path('staff', uid), { name: v.name, email: v.email });
        toast(v.name + ' can now sign in on the shop phone.');
      } catch (e) { toast(friendly(e), 'bad'); }
    },
    'staff-remove': async function (el) {
      var uid = el.dataset.uid, s = (shop.staff || {})[uid];
      var v = await ask({ title: 'Remove ' + (s ? s.name : 'this person') + '?', okText: 'Remove', danger: true, html: '<p class="muted">They will no longer be able to open the shop records.</p>' });
      if (!v) return;
      try { await shopRef().update(path('staff', uid), FV().delete()); } catch (e) { toast(friendly(e), 'bad'); }
    }
  };

  var forms = {
    connect: function (v) {
      var c = parseConfig(v.config);
      if (!c) return toast('That does not look like the Firebase settings block. It must contain apiKey, projectId and appId.', 'bad');
      try { localStorage.setItem('shop-pos-firebase', JSON.stringify(c)); } catch (e) { return toast('This browser will not store the settings (private mode?).', 'bad'); }
      location.reload();
    },
    signin: async function (v) {
      try {
        if (ui.signMode === 'create') {
          if (v.pw !== v.pw2) return toast('The two passwords are not the same.', 'bad');
          await auth.createUserWithEmailAndPassword(v.email, v.pw);
        } else await auth.signInWithEmailAndPassword(v.email, v.pw);
        ui.signMode = 'in';
      } catch (e) { toast(friendly(e), 'bad'); }
    },
    'create-shop': async function (v) {
      var base = C.newState();
      try {
        await shopRef().set({ name: v.name, currency: 'KES', ownerUid: me.uid, ownerEmail: me.email, staff: {}, categories: base.categories,
          sizes: base.sizes, label: base.label, seq: base.seq, createdAt: Date.now() });
      } catch (e) { toast((e.code || '').indexOf('permission-denied') >= 0 ? 'This shop already has an owner. Ask the owner to add you as a sales person.' : friendly(e), 'bad'); }
    },
    'add-code': function (v) { if (v.code) addToBasket(v.code); var i = $('#view [data-form=add-code] input'); if (i) i.value = ''; },
    'count-code': function (v) { if (v.code) countScan(v.code); var i = $('#view [data-form=count-code] input'); if (i) i.value = ''; },
    tag: async function (v) {
      if (ui.busy) return;
      // Check the form first, so numbers are not used up by a mistake.
      if (guard(function () { C.addItems(C.newState(), v, '', 0); return true; }) === undefined) return;
      if (!sync.online) return toast('Tagging needs internet, so two phones never give out the same number.', 'bad');
      var qty = Math.floor(Number(v.qty) || 1), seq;
      ui.busy = true;
      try {
        seq = await db.runTransaction(function (tx) {
          return tx.get(shopRef()).then(function (d) { var s = d.data().seq || 1000; tx.update(shopRef(), { seq: s + qty }); return s; });
        });
      } catch (e) { ui.busy = false; return toast('Could not reserve tag numbers: ' + friendly(e), 'bad'); }
      ui.busy = false;
      S.seq = seq;
      ui.lastTagged = mutate(function () { return C.addItems(S, v, who(), Date.now()); });
      ui.tagForm = { cat: v.cat, gender: v.gender, size: v.size, desc: '', buy: '', tag: '', qty: '1' };
      render(); window.scrollTo(0, 0);
    },
    'count-start': function (v) {
      if (guard(function () { mutate(function () { C.startCount(S, v.scope, who(), Date.now()); }); return true; }) === undefined) return;
      commitOps([['set', countRef(), clone(S.count)]]);
      ui.countView = 'scan'; render();
    },
    settings: async function (v) {
      var lines = function (t) { var seen = {}; return t.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { if (!s || seen[s]) return false; seen[s] = 1; return true; }); };
      var cats = lines(v.categories);
      if (!cats.length) return toast('Keep at least one category.', 'bad');
      shopRef().update({ name: v.name, categories: cats, sizes: lines(v.sizes) }).catch(function (e) { toast(friendly(e), 'bad'); });
      toast('Settings saved.');
    }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var fn = actions[el.dataset.act];
    if (fn) Promise.resolve().then(function () { return fn(el, e); }).catch(function (err) { console.error(err); toast('Something went wrong: ' + friendly(err), 'bad'); });
  });
  document.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    var v = {}; new FormData(form).forEach(function (val, k) { v[k] = String(val).trim(); });
    Promise.resolve().then(function () { return forms[form.dataset.form](v, form); }).catch(function (err) { console.error(err); toast('Something went wrong: ' + friendly(err), 'bad'); });
  });
  document.addEventListener('input', function (e) {
    var el = e.target, k = el.dataset && el.dataset.input;
    if (k === 'price') { ui.basket[+el.dataset.i].price = el.value.replace(/,/g, '').trim(); $('#basket-total').textContent = fmt(basketTotal()); }
    else if (k === 'stock-q') {
      ui.stock.q = el.value; ui.stock.limit = 60; $('#stock-list').innerHTML = stockListHtml();
      var code = C.normCode(el.value);
      if (C.validCode(code) && !S.items[code]) ensureItem(code).then(function () { if (ui.stock.q === el.value && $('#stock-list')) $('#stock-list').innerHTML = stockListHtml(); });
    }
  });
  document.addEventListener('change', function (e) {
    var el = e.target, k = el.dataset && el.dataset.change;
    if (!k) return;
    if (k === 'stock-cat') { ui.stock.cat = el.value; ui.stock.limit = 60; render(); }
    else if (k === 'label-size') { S.label.size = el.value; saveLabelPrefs(); render(); }
    else if (k === 'label-price') { S.label.price = el.checked; saveLabelPrefs(); render(); }
    else if (k === 'label-cut') { S.label.cut = el.checked; saveLabelPrefs(); render(); }
    else if (k === 'rep-from') { ui.rep.from = el.value; loadReport(); render(); }
    else if (k === 'rep-to') { ui.rep.to = el.value; loadReport(); render(); }
  });
  document.addEventListener('focusout', function () { if (renderDeferred) setTimeout(function () { if (renderDeferred) softRender(); }, 150); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopScan(); return; }
    // A new day started while the phone was asleep: follow today's sales, not yesterday's.
    if (screen === 'app' && dataStarted && startOfDay(Date.now()) !== dayStart && listeners.restartToday) listeners.restartToday();
    if (screen === 'app') scheduleRender();
  });
  window.addEventListener('online', function () { sync.online = true; scheduleRender(); });
  window.addEventListener('offline', function () { sync.online = false; scheduleRender(); });

  function boot() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline use is optional */ });
    }
    cfg = window.SHOP_FIREBASE_CONFIG || null; cfgFromFile = !!cfg;
    if (!cfg) { try { cfg = JSON.parse(localStorage.getItem('shop-pos-firebase')); } catch (e) { cfg = null; } }
    if (!cfg || !window.firebase) { screen = 'connect'; render(); return; }
    try {
      fb = window.firebase; fb.initializeApp(cfg);
      auth = fb.auth(); db = fb.firestore();
      // Keep a copy on the phone so the app opens and sells without internet.
      db.enablePersistence({ synchronizeTabs: true }).catch(function (e) { console.warn('offline copy not available', e && e.code); });
    } catch (e) {
      console.error(e); screen = 'connect'; render();
      toast('Those Firebase settings did not work: ' + friendly(e), 'bad');
      return;
    }
    render();
    auth.onAuthStateChanged(onAuth);
  }
  boot();
})();
