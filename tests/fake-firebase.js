/* Test stand-in for the Firebase browser library: same calls the app uses, records kept in localStorage so two
   tabs behave like two phones. It also applies the same access rules as firestore.rules. */
(function () {
  var DEL = { __del: 1 };
  function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  var data = load('fakedb', {}), users = load('fakeusers', {});
  var watchers = [];
  function persist() { localStorage.setItem('fakedb', JSON.stringify(data)); fire(); }
  function fire() { watchers.slice().forEach(function (w) { w(); }); }
  window.addEventListener('storage', function (e) { if (e.key === 'fakedb') { data = load('fakedb', {}); fire(); } if (e.key === 'fakeusers') users = load('fakeusers', {}); });
  function deny() { var e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; return e; }
  function cp(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

  function makeAuth(persistKey) {
    var cur = persistKey ? load(persistKey, null) : null, cbs = [];
    if (persistKey) { try { cur = JSON.parse(sessionStorage.getItem(persistKey)); } catch (e) { cur = null; } }
    function set(u) { cur = u; if (persistKey) sessionStorage.setItem(persistKey, JSON.stringify(u)); cbs.forEach(function (cb) { setTimeout(function () { cb(cur); }, 0); }); }
    return {
      get currentUser() { return cur; },
      onAuthStateChanged: function (cb) { cbs.push(cb); setTimeout(function () { cb(cur); }, 0); },
      signInWithEmailAndPassword: function (email, pw) {
        users = load('fakeusers', {});
        var u = users[email]; if (!u || u.pw !== pw) { var e = new Error('bad'); e.code = 'auth/invalid-credential'; return Promise.reject(e); }
        set({ uid: u.uid, email: email }); return Promise.resolve({ user: cur });
      },
      createUserWithEmailAndPassword: function (email, pw) {
        users = load('fakeusers', {});
        if (users[email]) { var e = new Error('exists'); e.code = 'auth/email-already-in-use'; return Promise.reject(e); }
        if (pw.length < 6) { var e2 = new Error('weak'); e2.code = 'auth/weak-password'; return Promise.reject(e2); }
        users[email] = { uid: 'u' + (Object.keys(users).length + 1) + Math.random().toString(36).slice(2, 6), pw: pw };
        localStorage.setItem('fakeusers', JSON.stringify(users));
        set({ uid: users[email].uid, email: email }); return Promise.resolve({ user: cur });
      },
      signOut: function () { set(null); return Promise.resolve(); }
    };
  }
  var mainAuth = makeAuth('fakeauth');
  function uid() { return mainAuth.currentUser && mainAuth.currentUser.uid; }

  // ---- the same rules as firestore.rules ----
  function shopData() { return (data.shop || {}).main; }
  function isOwner() { var s = shopData(); return !!uid() && !!s && s.ownerUid === uid(); }
  function isStaff() { var s = shopData(); return !!uid() && !!s && !!(s.staff || {})[uid()]; }
  function changedKeys(a, b) { var ks = {}; Object.keys(a).concat(Object.keys(b)).forEach(function (k) { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) ks[k] = 1; }); return Object.keys(ks); }
  function allowed(op, coll, id, before, after) {
    if (!uid()) return false;
    if (coll === 'shop' && id === 'main') {
      if (op === 'get') return !before || before.ownerUid === uid() || !!(before.staff || {})[uid()];
      if (op === 'create') return after.ownerUid === uid();
      if (op === 'update') return before.ownerUid === uid() && after.ownerUid === before.ownerUid;
      return false;
    }
    if (coll === 'items') {
      if (op === 'get' || op === 'list') return isOwner() || isStaff();
      if (op === 'create' || op === 'delete') return isOwner();
      if (op === 'update') return isOwner() || (isStaff() && before.status === 'in' && after.status === 'sold' && after.soldByUid === uid() &&
        changedKeys(before, after).every(function (k) { return ['status', 'soldAt', 'soldPrice', 'soldBy', 'soldByUid', 'pay', 'saleId'].indexOf(k) >= 0; }));
    }
    if (coll === 'log') {
      if (op === 'get' || op === 'list') return isOwner();
      if (op === 'create') return isOwner() || (isStaff() && after.uid === uid() && after.type === 'sold');
      return false;
    }
    if (coll === 'counts' || coll === 'state') return isOwner();
    return false;
  }

  function applyPatch(base, patch) {
    var out = cp(base);
    Object.keys(patch).forEach(function (k) {
      var v = patch[k], parts = k.split('\u0000'), o = out;
      for (var i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
      var last = parts[parts.length - 1];
      if (v === DEL) delete o[last];
      else if (v && v.__union) { o[last] = (o[last] || []).slice(); v.__union.forEach(function (x) { if (o[last].indexOf(x) < 0) o[last].push(x); }); }
      else o[last] = cp(v);
    });
    return out;
  }
  // returns a function that performs the write, or throws
  function plan(kind, ref, arg) {
    var coll = ref._c, id = ref.id, before = (data[coll] || {})[id], after;
    if (kind === 'set') { JSON.stringify(arg, function (k, v) { if (v === undefined) throw new Error('undefined field ' + k); return v; }); after = cp(arg); if (!allowed(before ? 'update' : 'create', coll, id, before, after)) throw deny(); }
    else if (kind === 'update') { if (!before) { var e = new Error('No document to update'); e.code = 'not-found'; throw e; } after = applyPatch(before, arg); if (!allowed('update', coll, id, before, after)) throw deny(); }
    else { if (!allowed('delete', coll, id, before, null)) throw deny(); }
    return function () { data[coll] = data[coll] || {}; if (kind === 'delete') delete data[coll][id]; else data[coll][id] = after; };
  }
  function normPatch(a, b) { if (a && a.__path) { var o = {}; o[a.__path.join('\u0000')] = b; return o; } return a; }
  function docSnap(coll, id) { var d = (data[coll] || {})[id]; return { id: id, exists: d !== undefined, data: function () { return cp(d); }, metadata: { hasPendingWrites: false, fromCache: false } }; }

  function docRef(coll, id) {
    var ref = { _c: coll, id: id,
      get: function () { return new Promise(function (res, rej) { if (!allowed('get', coll, id, (data[coll] || {})[id])) return rej(deny()); res(docSnap(coll, id)); }); },
      set: function (d) { return new Promise(function (res, rej) { try { plan('set', ref, d)(); persist(); res(); } catch (e) { rej(e); } }); },
      update: function (a, b) { return new Promise(function (res, rej) { try { plan('update', ref, normPatch(a, b))(); persist(); res(); } catch (e) { rej(e); } }); },
      delete: function () { return new Promise(function (res, rej) { try { plan('delete', ref)(); persist(); res(); } catch (e) { rej(e); } }); },
      onSnapshot: function (next, err) {
        var last = null;
        var w = function () { if (!allowed('get', coll, id, (data[coll] || {})[id])) { stop(); if (err) err(deny()); return; } var j = JSON.stringify((data[coll] || {})[id]); if (j === last) return; last = j; next(docSnap(coll, id)); };
        var stop = function () { var i = watchers.indexOf(w); if (i >= 0) watchers.splice(i, 1); };
        watchers.push(w); setTimeout(w, 0); return stop;
      } };
    return ref;
  }
  function query(coll, filters, order, lim) {
    function run() {
      var rows = Object.keys(data[coll] || {}).map(function (id) { return { id: id, d: data[coll][id] }; }).filter(function (r) {
        return filters.every(function (f) { var v = r.d[f[0]]; if (v === undefined) return false;
          return f[1] === '==' ? v === f[2] : f[1] === 'in' ? f[2].indexOf(v) >= 0 : f[1] === '>=' ? v >= f[2] : f[1] === '<' ? v < f[2] : false; });
      });
      if (order) { rows = rows.filter(function (r) { return r.d[order[0]] !== undefined; }); rows.sort(function (a, b) { return (a.d[order[0]] - b.d[order[0]]) * (order[1] === 'desc' ? -1 : 1); }); }
      if (lim) rows = rows.slice(0, lim);
      return rows;
    }
    return {
      doc: function (id) { return docRef(coll, id || 'auto' + Date.now() + Math.random().toString(36).slice(2, 8)); },
      where: function (f, op, v) { return query(coll, filters.concat([[f, op, v]]), order, lim); },
      orderBy: function (f, dir) { return query(coll, filters, [f, dir || 'asc'], lim); },
      limit: function (n) { return query(coll, filters, order, n); },
      get: function () { return new Promise(function (res, rej) { if (!allowed('list', coll)) return rej(deny()); res({ docs: run().map(function (r) { return docSnap(coll, r.id); }) }); }); },
      onSnapshot: function (a, b, c) {
        var next = typeof a === 'function' ? a : b, err = typeof a === 'function' ? b : c, prev = {}, first = true;
        var w = function () {
          if (!allowed('list', coll)) { stop(); if (err) err(deny()); return; }
          var rows = run(), now = {}, changes = [];
          rows.forEach(function (r) { now[r.id] = JSON.stringify(r.d); if (!(r.id in prev)) changes.push({ type: 'added', doc: docSnap(coll, r.id) }); else if (prev[r.id] !== now[r.id]) changes.push({ type: 'modified', doc: docSnap(coll, r.id) }); });
          Object.keys(prev).forEach(function (id) { if (!(id in now)) changes.push({ type: 'removed', doc: { id: id, exists: false, data: function () { return JSON.parse(prev[id]); }, metadata: {} } }); });
          var old = prev; prev = now;
          if (!first && !changes.length) return; first = false;
          next({ docs: rows.map(function (r) { return docSnap(coll, r.id); }), docChanges: function () { return changes; }, metadata: { hasPendingWrites: false } });
        };
        var stop = function () { var i = watchers.indexOf(w); if (i >= 0) watchers.splice(i, 1); };
        watchers.push(w); setTimeout(w, 0); return stop;
      }
    };
  }
  var db = {
    enablePersistence: function () { return Promise.resolve(); },
    collection: function (c) { return query(c, [], null, 0); },
    batch: function () {
      var ops = [];
      return { set: function (r, d) { ops.push(['set', r, d]); }, update: function (r, a, b) { ops.push(['update', r, normPatch(a, b)]); }, delete: function (r) { ops.push(['delete', r]); },
        commit: function () { return new Promise(function (res, rej) {
          if (window.__fakeOffline) return;   // like the real thing: waits until back online
          try { var snapshot = JSON.stringify(data), fns = [];
            try { ops.forEach(function (o) { var f = plan(o[0], o[1], o[2]); f(); }); } catch (e) { data = JSON.parse(snapshot); throw e; }
            persist(); res(); } catch (e) { window.__lastDenied = (window.__lastDenied || 0) + 1; rej(e); } }); } };
    },
    runTransaction: function (fn) {
      var tx = { get: function (r) { return r.get(); }, update: function (r, d) { tx._w = [r, d]; } };
      return Promise.resolve(fn(tx)).then(function (out) { if (tx._w) { plan('update', tx._w[0], tx._w[1])(); persist(); } return out; });
    }
  };
  var firestore = function () { return db; };
  firestore.FieldValue = { delete: function () { return DEL; }, arrayUnion: function () { return { __union: [].slice.call(arguments) }; } };
  firestore.FieldPath = function () { this.__path = [].slice.call(arguments); };
  var apps = [];
  window.firebase = {
    apps: apps,
    initializeApp: function (cfg, name) { var a = { name: name || '[DEFAULT]', auth: name ? (function () { var x = makeAuth(null); return function () { return x; }; })() : function () { return mainAuth; } }; apps.push(a); return a; },
    auth: function () { return mainAuth; }, firestore: firestore
  };
  window.SHOP_FIREBASE_CONFIG = { apiKey: 'test', projectId: 'test', appId: 'test' };
})();
