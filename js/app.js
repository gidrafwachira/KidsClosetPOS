/* Shop inventory + POS: screens and actions. Data rules live in core.js. */
(function () {
  'use strict';

  var C = window.Core, Scanner = window.Scanner;
  var S = null;                 // all shop data
  var role = 'sales';           // 'sales' or 'owner'
  var route = 'sell', routeArg = null;
  var hiddenAt = 0;
  var ui = {
    basket: [], pay: 'Cash', seller: '',
    stock: { q: '', status: 'in', cat: '', limit: 60 },
    rep: { range: 'today', from: '', to: '' },
    lastTagged: [], tagForm: { gender: 'Boys', qty: '1' },
    labelCodes: null, countView: 'scan', showRemaining: false
  };

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
  function who() { return role === 'owner' ? 'Owner' : (ui.seller || S.staff[0] || 'Sales person'); }
  function daysAgo(t) { return Math.floor((Date.now() - t) / C.DAY); }

  var ICON = {
    sell: '<svg viewBox="0 0 24 24"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.3"/></svg>',
    stock: '<svg viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v8l-9 5-9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
    count: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/></svg>',
    reports: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg>',
    today: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4V8z"/><circle cx="12" cy="13" r="3.5"/></svg>'
  };

  /* ---------- storage: kept on this phone ---------- */
  var Store = {
    db: null,
    open: function () {
      return new Promise(function (res) {
        try {
          var r = indexedDB.open('shop-pos', 1);
          r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
          r.onsuccess = function () { Store.db = r.result; res(); };
          r.onerror = function () { res(); };
        } catch (e) { res(); }
      });
    },
    load: function () {
      if (!Store.db) { try { return Promise.resolve(JSON.parse(localStorage.getItem('shop-pos-state'))); } catch (e) { return Promise.resolve(null); } }
      return new Promise(function (res) {
        var q = Store.db.transaction('kv').objectStore('kv').get('state');
        q.onsuccess = function () { res(q.result || null); };
        q.onerror = function () { res(null); };
      });
    },
    save: function (state) {
      if (!Store.db) { localStorage.setItem('shop-pos-state', JSON.stringify(state)); return Promise.resolve(); }
      return new Promise(function (res, rej) {
        var tx = Store.db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(state, 'state');
        tx.oncomplete = function () { res(); };
        tx.onerror = tx.onabort = function () { rej(tx.error); };
      });
    }
  };
  function save() {
    return Store.save(S).catch(function (e) { toast('Could not save on this phone: ' + (e && e.message || e), 'bad'); });
  }

  async function hash(text) {
    var input = 'shop-pos:' + text;
    if (window.crypto && crypto.subtle) {
      var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return p2(b.toString(16)); }).join('');
    }
    var h = 5381; for (var i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    return 'x' + (h >>> 0).toString(16);
  }

  /* ---------- small UI helpers ---------- */
  var toastTimer = null;
  function toast(text, kind) {
    var t = $('#toast');
    t.textContent = text; t.className = 'show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, kind === 'bad' ? 5000 : 2600);
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
      var done = function (v) { if (settled) return; settled = true; if (d.open) d.close(); res(v); };
      form.onsubmit = function (e) {
        e.preventDefault();
        var out = {}; new FormData(form).forEach(function (v, k) { out[k] = String(v).trim(); });
        done(out);
      };
      var cancel = $('[data-dlg=cancel]', d);
      if (cancel) cancel.onclick = function () { done(null); };
      d.oncancel = function (e) { if (o.noCancel) e.preventDefault(); else done(null); };
      if (o.onOpen) o.onOpen(d, done);
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

  /* ---------- navigation ---------- */
  var OWNER_TABS = [['sell', 'Sell'], ['tag', 'Tag'], ['stock', 'Stock'], ['count', 'Count'], ['reports', 'Reports']];
  var SALES_TABS = [['sell', 'Sell'], ['today', 'Today']];

  function go(to, arg) {
    if (role !== 'owner' && to !== 'sell' && to !== 'today') to = 'sell';
    if (to !== route || (to !== 'sell' && to !== 'count')) stopScan();
    route = to; routeArg = arg == null ? null : arg;
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    if (!S.pinHash) { $('#top-actions').innerHTML = ''; $('#tabs').innerHTML = ''; $('#role-line').textContent = 'First-time setup'; $('#view').innerHTML = viewSetup(); return; }
    $('#shop-name').textContent = S.shop.name;
    $('#role-line').textContent = role === 'owner' ? 'Owner mode' : 'Sales mode';
    document.body.className = role;
    $('#top-actions').innerHTML = role === 'owner'
      ? '<button class="icon-btn" data-act="go" data-to="settings" aria-label="Settings">' + ICON.gear + '</button>' +
        '<button class="btn small" data-act="lock">' + ICON.lock + ' Lock</button>'
      : '<button class="btn small" data-act="unlock">' + ICON.lock + ' Owner</button>';
    var tabs = role === 'owner' ? OWNER_TABS : SALES_TABS;
    var base = route === 'item' ? 'stock' : route === 'labels' ? 'tag' : route;
    $('#tabs').innerHTML = tabs.map(function (t) {
      return '<button data-act="go" data-to="' + t[0] + '"' + (t[0] === base ? ' class="on"' : '') + '>' + ICON[t[0]] + '<span>' + t[1] + '</span></button>';
    }).join('');
    var views = { sell: viewSell, today: viewToday, tag: viewTag, labels: viewLabels, stock: viewStock, item: viewItem,
      count: viewCount, reports: viewReports, settings: viewSettings, log: viewLog };
    $('#view').innerHTML = (views[route] || viewSell)();
    renderBanner();
  }

  function renderBanner() {
    var html = '';
    var n = Object.keys(S.items).length;
    if (role === 'owner' && n > 0 && Date.now() - (S.lastBackup || 0) > 7 * C.DAY) {
      html = '<div class="banner"><span>' + (S.lastBackup ? 'Last backup was ' + daysAgo(S.lastBackup) + ' days ago.' : 'No backup yet.') +
        ' All records live on this phone only.</span><button class="btn small" data-act="backup">Back up now</button></div>';
    }
    $('#banner').innerHTML = html;
  }

  /* ---------- setup and owner PIN ---------- */
  function viewSetup() {
    return '<form class="card" data-form="setup"><h2>Set up your shop</h2>' +
      '<p class="muted">Choose an owner PIN. Without it, the phone can only scan and sell. With it, you can tag stock, see buying prices and profit, run stock counts and change settings.</p>' +
      '<label>Shop name<input name="name" value="' + esc(S.shop.name) + '" required></label>' +
      '<label>Owner PIN (4 to 8 digits)<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" required autocomplete="off"></label>' +
      '<label>Repeat the PIN<input name="pin2" type="password" inputmode="numeric" pattern="[0-9]{4,8}" required autocomplete="off"></label>' +
      '<button class="btn primary big">Start</button>' +
      '<p class="muted small">Moving from another phone? <button type="button" class="link" data-act="restore-pick">Restore from a backup file</button></p></form>';
  }

  async function unlock() {
    var v = await ask({
      title: 'Owner PIN', okText: 'Unlock',
      fields: [{ name: 'pin', label: 'Enter the owner PIN', type: 'password', inputmode: 'numeric', required: true }],
      html: '<p class="muted small"><button type="button" class="link" data-dlg-act="forgot">Forgot the PIN?</button></p>',
      onOpen: function (d, done) { $('[data-dlg-act=forgot]', d).onclick = function () { done({ forgot: true }); }; }
    });
    if (!v) return;
    if (v.forgot) return forgotPin();
    if (await hash(v.pin) !== S.pinHash) { toast('Wrong PIN.', 'bad'); return; }
    setRole('owner');
  }
  async function forgotPin() {
    var v = await ask({
      title: 'Reset the owner PIN', okText: 'Reset PIN',
      fields: [{ name: 'rec', label: 'Recovery code (given when the shop was set up)', inputmode: 'numeric', required: true },
        { name: 'pin', label: 'New PIN (4 to 8 digits)', type: 'password', inputmode: 'numeric', required: true }]
    });
    if (!v) return;
    if (await hash('rec:' + v.rec.replace(/\D/g, '')) !== S.recoveryHash) { toast('That recovery code is not correct.', 'bad'); return; }
    if (!/^\d{4,8}$/.test(v.pin)) { toast('The PIN must be 4 to 8 digits.', 'bad'); return; }
    S.pinHash = await hash(v.pin); await save();
    toast('PIN changed.'); setRole('owner');
  }
  function setRole(r) {
    role = r;
    try { sessionStorage.setItem('shop-pos-role', r); } catch (e) { /* ignore */ }
    go(r === 'owner' ? route : 'sell');
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
  function addToBasket(raw) {
    var code = C.normCode(raw);
    if (!C.validCode(code)) return feedback('bad', code ? 'Tag number ' + code + ' is not valid. Check the digits.' : 'That is not a shop tag.');
    var it = S.items[code];
    if (!it) return feedback('bad', 'Tag ' + code + ' is not in the system. Tell the owner.');
    if (it.status === 'sold') return feedback('bad', 'Tag ' + code + ' was already sold on ' + fmtDate(it.soldAt) + '. Keep it aside and tell the owner.');
    if (it.status !== 'in') return feedback('bad', 'Tag ' + code + ' is marked ' + C.statusLabel(it.status) + '. Keep it aside and tell the owner.');
    if (ui.basket.some(function (l) { return l.code === code; })) return feedback('warn', 'Tag ' + code + ' is already in this sale.');
    ui.basket.push({ code: code, price: it.tag > 0 ? String(it.tag) : '' });
    feedback('ok', 'Added: ' + C.describe(it));
    render();
  }
  function basketTotal() { return ui.basket.reduce(function (s, l) { return s + (Number(l.price) || 0); }, 0); }

  function viewSell() {
    var seller = role === 'sales' && S.staff.length > 1
      ? '<label class="inline">Who is selling?<select data-change="seller">' + S.staff.map(function (n) {
        return '<option' + (n === who() ? ' selected' : '') + '>' + esc(n) + '</option>';
      }).join('') + '</select></label>' : '';
    var html = '<div class="card">' + seller +
      '<button class="btn primary big" data-act="scan-toggle">' + ICON.cam + (Scanner.running() ? ' Close camera' : ' Scan a tag') + '</button>' +
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
    var res;
    try { res = C.sell(S, ui.basket, { pay: ui.pay, by: who() }, Date.now()); }
    catch (e) { if (e.user) return toast(e.message, 'bad'); throw e; }
    await save();
    ui.basket = [];
    Scanner.beep('ok');
    render();
    await ask({
      title: 'Sale #' + res.saleId + ' recorded', okText: 'Next customer', noCancel: true,
      html: '<p class="bigsum">' + fmt(res.total) + '</p><p class="muted center">' + res.count + (res.count === 1 ? ' item' : ' items') + ' · ' + esc(ui.pay) + ' · ' + fmtDateTime(Date.now()) + '</p>'
    });
  }

  /* ---------- TODAY (sales person's cash-up) ---------- */
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
      '</div></div><div class="card"><h2>Sales</h2>' + saleRows(r.sales, false) + '</div>';
  }
  function tile(label, value, cls) { return '<div class="tile ' + (cls || '') + '"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>'; }

  /* ---------- TAG ---------- */
  function viewTag() {
    var f = ui.tagForm, st = C.stock(S, Date.now()), html = '';
    if (ui.lastTagged.length) {
      var codes = ui.lastTagged;
      html += '<div class="card good"><h2>' + codes.length + (codes.length === 1 ? ' item tagged' : ' items tagged') + '</h2>' +
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
      '<p class="muted small">Each piece gets its own number. The tag price is what you expect to sell at; a sale below it is flagged in your reports.</p>' +
      '<button class="btn primary big">Save and create tag' + '</button></form>';
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

  /* ---------- STOCK ---------- */
  function stockMatches() {
    var f = ui.stock, words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    var list = Object.keys(S.items).map(function (c) { return S.items[c]; }).filter(function (it) {
      if (f.status && it.status !== f.status) return false;
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
    if (!list.length) return '<p class="muted pad center">' + (Object.keys(S.items).length ? 'Nothing matches.' : 'No stock yet. Go to Tag to add your first items.') + '</p>';
    return '<p class="muted small">' + list.length + ' item' + (list.length === 1 ? '' : 's') + '</p>' + list.slice(0, f.limit).map(itemRow).join('') +
      (list.length > f.limit ? '<button class="btn ghost" data-act="stock-more">Show more</button>' : '');
  }
  function viewStock() {
    var st = C.stock(S, Date.now()), f = ui.stock;
    return '<div class="card"><div class="tiles">' + tile('In stock', st.inN) + tile('Stock at cost', fmt(st.inCost)) +
      tile('Sold', st.soldN) + tile('Missing', st.missingN, st.missingN ? 'bad' : '') + '</div></div>' +
      '<div class="card"><input type="search" data-input="stock-q" value="' + esc(f.q) + '" placeholder="Search tag number, category, size…" aria-label="Search stock">' +
      '<div class="chips">' + [['in', 'In stock'], ['sold', 'Sold'], ['missing', 'Missing'], ['writeoff', 'Written off'], ['', 'All']].map(function (s) {
        return '<button data-act="stock-status" data-status="' + s[0] + '"' + (f.status === s[0] ? ' class="on"' : '') + '>' + s[1] + '</button>';
      }).join('') + '</div>' +
      '<select data-change="stock-cat" aria-label="Category"><option value="">All categories</option>' + S.categories.map(function (c) {
        return '<option' + (c === f.cat ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('') + '</select><div id="stock-list">' + stockListHtml() + '</div></div>';
  }

  function viewItem() {
    var it = S.items[routeArg];
    if (!it) return '<div class="card"><p>This item no longer exists.</p><button class="btn" data-act="go" data-to="stock">Back to stock</button></div>';
    var rows = [['Tag number', it.code], ['Category', it.cat], ['For', it.gender], ['Size', it.size], ['Description', it.desc],
      ['Buying price', fmt(it.buy)], ['Tag price', it.tag > 0 ? fmt(it.tag) : 'not set'], ['Date tagged', fmtDateTime(it.taggedAt)],
      ['Status', C.statusLabel(it.status)]];
    if (it.status === 'sold') {
      rows.push(['Date sold', fmtDateTime(it.soldAt)], ['Selling price', fmt(it.soldPrice)], ['Profit', fmt(it.soldPrice - it.buy)],
        ['Payment', it.pay], ['Sold by', it.soldBy], ['Sale number', '#' + it.saleId]);
    } else if (it.status !== 'in') { rows.push(['Since', fmtDateTime(it.outAt)], ['Note', it.note]); }
    var acts = '<button class="btn" data-act="item-edit">Edit details</button><button class="btn" data-act="item-label">Print label</button>';
    if (it.status === 'in') {
      acts += '<button class="btn" data-act="item-out" data-status="missing">Mark missing</button>' +
        '<button class="btn" data-act="item-out" data-status="writeoff">Write off (damaged, gift)</button>' +
        '<button class="btn danger-outline" data-act="item-delete">Delete (tagged by mistake)</button>';
    } else {
      acts += '<button class="btn" data-act="item-return">' + (it.status === 'sold' ? 'Cancel the sale, return to stock' : 'Found, return to stock') + '</button>';
    }
    var hist = S.log.filter(function (l) { return l.code === it.code; }).reverse();
    return '<button class="btn ghost back" data-act="go" data-to="stock">‹ Stock</button>' +
      '<div class="card"><h2>' + esc(C.describe(it)) + ' <span class="st ' + it.status + '">' + C.statusLabel(it.status) + '</span></h2>' +
      '<div class="lbl-preview" style="--w:70mm;--h:30mm">' + labelHtml(it) + '</div>' +
      '<dl>' + rows.filter(function (r) { return r[1] !== '' && r[1] != null; }).map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>' +
      '<div class="acts">' + acts + '</div></div>' +
      '<div class="card"><h2>History</h2>' + logRows(hist) + '</div>';
  }
  function logRows(list) {
    if (!list.length) return '<p class="muted">Nothing yet.</p>';
    var names = { tagged: 'Tagged', sold: 'Sold', 'void': 'Sale cancelled', found: 'Returned to stock', missing: 'Marked missing',
      writeoff: 'Written off', edited: 'Edited', deleted: 'Deleted', 'count-start': 'Stock count started',
      'count-finish': 'Stock count finished', 'count-cancel': 'Stock count cancelled', restore: 'Backup restored' };
    return list.map(function (l) {
      return '<div class="line"><div class="grow"><b>' + (names[l.type] || l.type) + (l.code ? ' · tag ' + l.code : '') + '</b><small>' +
        fmtDateTime(l.t) + (l.by ? ' · ' + esc(l.by) : '') + (l.info ? ' · ' + esc(l.info) : '') + '</small></div></div>';
    }).join('');
  }
  function viewLog() {
    var list = S.log.slice(-300).reverse();
    return '<button class="btn ghost back" data-act="go" data-to="settings">‹ Settings</button><div class="card"><h2>Activity log</h2>' +
      '<p class="muted small">Every change, newest first (last 300). Nothing here can be edited.</p>' + logRows(list) + '</div>';
  }

  /* ---------- COUNT ---------- */
  function countScan(raw) {
    var r;
    try { r = C.countScan(S, raw, Date.now()); } catch (e) { return toast(e.message, 'bad'); }
    var d = r.item ? C.describe(r.item) : '';
    if (r.kind === 'ok') feedback('ok', 'Counted: ' + d);
    else if (r.kind === 'dup') feedback('warn', 'Already counted: ' + d);
    else if (r.kind === 'sold') feedback('bad', 'SOLD item on the rack: tag ' + r.item.code + '. Put it aside.');
    else if (r.kind === 'found') feedback('warn', 'Was marked ' + C.statusLabel(r.item.status) + ', now found: ' + d);
    else if (r.kind === 'scope') feedback('warn', 'Other category (' + r.item.cat + '), not part of this count.');
    else feedback('bad', 'Unknown tag ' + r.code + '. Put it aside.');
    save();
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
  function breakdown(map, withProfit) {
    var keys = Object.keys(map).sort(function (a, b) { return map[b].amount - map[a].amount; });
    if (!keys.length) return '<p class="muted">No sales.</p>';
    return keys.map(function (k) {
      return '<div class="line"><div class="grow"><b>' + esc(k) + '</b><small>' + map[k].n + ' item' + (map[k].n === 1 ? '' : 's') +
        (withProfit ? ' · profit ' + fmt(map[k].profit) : '') + '</small></div><b>' + fmt(map[k].amount) + '</b></div>';
    }).join('');
  }
  function viewReports() {
    var rg = repRange(), r = C.report(S, rg[0], rg[1]), st = C.stock(S, Date.now()), f = ui.rep;
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
      '<h2>' + esc(rg[2]) + '</h2><div class="tiles">' + tile('Items sold', r.n) + tile('Sales', fmt(r.revenue)) + tile('Cost of those items', fmt(r.cost)) +
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
    var rg = repRange(), r = C.report(S, rg[0], rg[1]), st = C.stock(S, Date.now());
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
    return '<form class="card" data-form="settings"><h2>Settings</h2>' +
      '<label>Shop name<input name="name" value="' + esc(S.shop.name) + '" required></label>' +
      '<label>Sales people (one name per line)<textarea name="staff" rows="3">' + esc(S.staff.join('\n')) + '</textarea></label>' +
      '<label>Categories (one per line)<textarea name="categories" rows="8">' + esc(S.categories.join('\n')) + '</textarea></label>' +
      '<label>Sizes (one per line)<textarea name="sizes" rows="6">' + esc(S.sizes.join('\n')) + '</textarea></label>' +
      '<button class="btn primary">Save settings</button></form>' +
      '<div class="card"><h2>Backup</h2><p class="muted">All records are stored on this phone only. A backup file lets you recover them if the phone is lost, reset or replaced. ' +
      (S.lastBackup ? 'Last backup: ' + fmtDateTime(S.lastBackup) + '.' : 'No backup made yet.') + '</p>' +
      '<button class="btn primary" data-act="backup">Save a backup file</button>' +
      '<button class="btn" data-act="restore-pick">Restore from a backup file</button>' +
      '<input type="file" id="restore-file" accept="application/json,.json" hidden></div>' +
      '<div class="card"><h2>Security</h2><button class="btn" data-act="change-pin">Change owner PIN</button>' +
      '<button class="btn" data-act="go" data-to="log">Activity log</button></div>';
  }
  async function backup() {
    var name = 'shop-backup-' + C.isoDay(Date.now()) + '.json', text = JSON.stringify(S);
    S.lastBackup = Date.now();
    try {
      var file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
      } else { download(name, text, 'application/json'); }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      download(name, text, 'application/json');
    }
    await save(); render();
    toast('Backup saved. Keep the file somewhere off this phone (email, WhatsApp to yourself, Google Drive).');
  }
  async function restoreFrom(file) {
    var obj;
    try { obj = C.checkBackup(JSON.parse(await file.text())); }
    catch (e) { return toast(e.user ? e.message : 'That file could not be read.', 'bad'); }
    var n = Object.keys(obj.items).length, mine = S ? Object.keys(S.items).length : 0;
    var v = await ask({
      title: 'Restore this backup?', danger: mine > 0, okText: 'Restore',
      html: '<p>The backup has <b>' + n + '</b> items. ' + (mine ? 'It will <b>replace</b> the ' + mine + ' items now on this phone.' : '') + '</p>'
    });
    if (!v) return;
    S = obj;
    S.log.push({ t: Date.now(), type: 'restore', code: '', by: 'Owner', info: n + ' items' });
    await save();
    toast('Backup restored. Unlock with the owner PIN from that backup.');
    setRole('sales');
  }

  /* ---------- actions ---------- */
  var actions = {
    go: function (el) { go(el.dataset.to); },
    item: function (el) { if (role === 'owner') go('item', el.dataset.code); },
    lock: function () { setRole('sales'); },
    unlock: unlock,
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
    'labels-done': async function () {
      labelCodes().forEach(function (c) { S.items[c].printed = true; });
      await save(); ui.labelCodes = null; ui.lastTagged = []; toast('Marked as printed.'); go('tag');
    },
    'stock-status': function (el) { ui.stock.status = el.dataset.status; ui.stock.limit = 60; render(); },
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
      try { C.editItem(S, it.code, v, who(), Date.now()); } catch (e) { if (e.user) return toast(e.message, 'bad'); throw e; }
      await save(); render(); toast('Saved.');
    },
    'item-out': async function (el) {
      var status = el.dataset.status;
      var v = await ask({ title: status === 'missing' ? 'Mark as missing?' : 'Write this item off?', okText: 'Confirm', danger: true,
        fields: [{ name: 'note', label: 'Note (what happened)', required: status === 'writeoff' }] });
      if (!v) return;
      try { C.takeOut(S, routeArg, status, v.note, who(), Date.now()); } catch (e) { if (e.user) return toast(e.message, 'bad'); throw e; }
      await save(); render();
    },
    'item-return': async function () {
      var it = S.items[routeArg];
      var v = await ask({ title: it.status === 'sold' ? 'Cancel this sale?' : 'Return to stock?', okText: 'Return to stock',
        html: it.status === 'sold' ? '<p class="muted">The sale of ' + fmt(it.soldPrice) + ' is removed from your sales and stays in the activity log as cancelled.</p>' : '',
        fields: [{ name: 'reason', label: 'Reason', required: true }] });
      if (!v) return;
      try { C.returnToStock(S, routeArg, v.reason, who(), Date.now()); } catch (e) { if (e.user) return toast(e.message, 'bad'); throw e; }
      await save(); render();
    },
    'item-delete': async function () {
      var v = await ask({ title: 'Delete this item?', okText: 'Delete', danger: true,
        html: '<p class="muted">Use this only for an item tagged by mistake. The deletion stays in the activity log.</p>',
        fields: [{ name: 'reason', label: 'Reason', required: true }] });
      if (!v) return;
      try { C.deleteItem(S, routeArg, v.reason, who(), Date.now()); } catch (e) { if (e.user) return toast(e.message, 'bad'); throw e; }
      await save(); go('stock');
    },
    'count-view': function (el) { ui.countView = el.dataset.view; if (ui.countView === 'review') stopScan(); render(); window.scrollTo(0, 0); },
    'count-remaining': function () { ui.showRemaining = !ui.showRemaining; render(); },
    'count-finish': async function () {
      var r = C.countReview(S);
      var v = await ask({ title: 'Finish the stock count?', okText: 'Finish', danger: r.missing.length > 0,
        html: '<p>' + r.counted + ' of ' + r.expected + ' items were found.' + (r.missing.length ? ' <b>' + r.missing.length + '</b> will be marked missing (' + fmt(r.missingCost) + ').' : '') + '</p>' });
      if (!v) return;
      C.finishCount(S, who(), Date.now());
      await save(); ui.countView = 'scan'; ui.showRemaining = false; render(); toast('Stock count saved.');
    },
    'count-cancel': async function () {
      var v = await ask({ title: 'Throw this count away?', okText: 'Throw away', danger: true, html: '<p class="muted">Nothing will be marked missing.</p>' });
      if (!v) return;
      C.cancelCount(S, who(), Date.now()); await save(); ui.countView = 'scan'; render();
    },
    'rep-range': function (el) {
      ui.rep.range = el.dataset.range;
      if (ui.rep.range === 'custom' && !ui.rep.from) { ui.rep.from = ui.rep.to = C.isoDay(Date.now()); }
      render();
    },
    'share-summary': async function () {
      var text = summaryText();
      try { if (navigator.share) { await navigator.share({ text: text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    },
    'export-csv': function () { download('shop-stock-' + C.isoDay(Date.now()) + '.csv', '﻿' + C.toCSV(S), 'text/csv'); },
    backup: backup,
    'restore-pick': function () {
      var input = $('#restore-file') || document.body.appendChild(Object.assign(document.createElement('input'), { type: 'file', id: 'restore-file', accept: 'application/json,.json', hidden: true }));
      input.onchange = function () { if (input.files[0]) restoreFrom(input.files[0]); input.value = ''; };
      input.click();
    },
    'change-pin': async function () {
      var v = await ask({ title: 'Change owner PIN', okText: 'Change',
        fields: [{ name: 'old', label: 'Current PIN', type: 'password', inputmode: 'numeric', required: true },
          { name: 'pin', label: 'New PIN (4 to 8 digits)', type: 'password', inputmode: 'numeric', required: true }] });
      if (!v) return;
      if (await hash(v.old) !== S.pinHash) return toast('Current PIN is wrong.', 'bad');
      if (!/^\d{4,8}$/.test(v.pin)) return toast('The PIN must be 4 to 8 digits.', 'bad');
      S.pinHash = await hash(v.pin); await save(); toast('PIN changed.');
    }
  };

  var forms = {
    setup: async function (v) {
      if (!/^\d{4,8}$/.test(v.pin)) return toast('The PIN must be 4 to 8 digits.', 'bad');
      if (v.pin !== v.pin2) return toast('The two PINs are not the same.', 'bad');
      var rec = String(Math.floor(10000000 + Math.random() * 90000000));
      if (window.crypto && crypto.getRandomValues) { var a = new Uint32Array(1); crypto.getRandomValues(a); rec = String(10000000 + (a[0] % 90000000)); }
      S.shop.name = v.name; S.pinHash = await hash(v.pin); S.recoveryHash = await hash('rec:' + rec);
      await save();
      if (navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch (e) { /* optional */ } }
      role = 'owner'; try { sessionStorage.setItem('shop-pos-role', 'owner'); } catch (e) { /* ignore */ }
      route = 'tag'; render();
      await ask({ title: 'Write down your recovery code', okText: 'I have written it down', noCancel: true,
        html: '<p class="bigsum">' + rec.slice(0, 4) + ' ' + rec.slice(4) + '</p><p class="muted">If you forget the PIN, this code is the only way to set a new one. It is shown once. Keep it at home, not in the shop.</p>' });
    },
    'add-code': function (v, form) { if (v.code) addToBasket(v.code); var i = $('#view [data-form=add-code] input'); if (i) i.focus(); },
    'count-code': function (v) { if (v.code) countScan(v.code); var i = $('#view [data-form=count-code] input'); if (i) i.focus(); },
    tag: async function (v) {
      var codes;
      try { codes = C.addItems(S, v, who(), Date.now()); } catch (e) { if (e.user) return toast(e.message, 'bad'); throw e; }
      await save();
      ui.lastTagged = codes;
      ui.tagForm = { cat: v.cat, gender: v.gender, size: v.size, desc: '', buy: '', tag: '', qty: '1' };
      render(); window.scrollTo(0, 0);
    },
    'count-start': async function (v) {
      try { C.startCount(S, v.scope, who(), Date.now()); } catch (e) { if (e.user) return toast(e.message, 'bad'); throw e; }
      await save(); ui.countView = 'scan'; render();
    },
    settings: async function (v) {
      var lines = function (t) { var seen = {}; return t.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { if (!s || seen[s]) return false; seen[s] = 1; return true; }); };
      var cats = lines(v.categories), staff = lines(v.staff);
      if (!cats.length) return toast('Keep at least one category.', 'bad');
      if (!staff.length) return toast('Keep at least one sales person.', 'bad');
      S.shop.name = v.name; S.categories = cats; S.sizes = lines(v.sizes); S.staff = staff;
      await save(); render(); toast('Settings saved.');
    }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || !S) return;
    var fn = actions[el.dataset.act];
    if (fn) Promise.resolve(fn(el, e)).catch(function (err) { console.error(err); toast('Something went wrong: ' + err.message, 'bad'); });
  });
  document.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    var v = {}; new FormData(form).forEach(function (val, k) { v[k] = String(val).trim(); });
    Promise.resolve(forms[form.dataset.form](v, form)).catch(function (err) { console.error(err); toast('Something went wrong: ' + err.message, 'bad'); });
  });
  document.addEventListener('input', function (e) {
    var el = e.target, k = el.dataset && el.dataset.input;
    if (k === 'price') { ui.basket[+el.dataset.i].price = el.value.replace(/,/g, '').trim(); $('#basket-total').textContent = fmt(basketTotal()); }
    else if (k === 'stock-q') { ui.stock.q = el.value; ui.stock.limit = 60; $('#stock-list').innerHTML = stockListHtml(); }
  });
  document.addEventListener('change', function (e) {
    var el = e.target, k = el.dataset && el.dataset.change;
    if (!k) return;
    if (k === 'seller') { ui.seller = el.value; try { localStorage.setItem('shop-pos-seller', el.value); } catch (err) { /* ignore */ } }
    else if (k === 'stock-cat') { ui.stock.cat = el.value; ui.stock.limit = 60; render(); }
    else if (k === 'label-size') { S.label.size = el.value; save(); render(); }
    else if (k === 'label-price') { S.label.price = el.checked; save(); render(); }
    else if (k === 'label-cut') { S.label.cut = el.checked; save(); render(); }
    else if (k === 'rep-from') { ui.rep.from = el.value; render(); }
    else if (k === 'rep-to') { ui.rep.to = el.value; render(); }
  });
  // If the phone is put down for a while in owner mode, go back to sales mode.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); stopScan(); }
    else {
      if (S && S.pinHash && role === 'owner' && hiddenAt && Date.now() - hiddenAt > 10 * 60000) { role = 'sales'; route = 'sell'; try { sessionStorage.setItem('shop-pos-role', 'sales'); } catch (e) { /* ignore */ } }
      if (S) render();
    }
  });

  async function boot() {
    await Store.open();
    S = (await Store.load()) || C.newState();
    try {
      ui.seller = localStorage.getItem('shop-pos-seller') || '';
      if (S.pinHash && sessionStorage.getItem('shop-pos-role') === 'owner') role = 'owner';
    } catch (e) { /* ignore */ }
    if (S.staff.indexOf(ui.seller) < 0) ui.seller = '';
    route = 'sell';
    render();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline use is optional */ });
    }
  }
  window.__shop = { state: function () { return S; } };
  boot();
})();
