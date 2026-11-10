// Run with: node tests/core.test.js
const assert = require('assert');
const C = require('../js/core.js');
const DAY = C.DAY, T0 = new Date(2026, 10, 1, 9, 0).getTime();
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const throws = (fn, re) => assert.throws(fn, e => e.user && re.test(e.message));

ok('tag numbers carry a check digit and reject typos', () => {
  const code = C.makeCode(1001);
  assert.strictEqual(code.length, 5);
  assert.ok(C.validCode(code));
  for (let i = 0; i < code.length; i++) for (let d = 0; d < 10; d++) {
    if (String(d) === code[i]) continue;
    assert.ok(!C.validCode(code.slice(0, i) + d + code.slice(i + 1)), 'single-digit typo accepted');
  }
  assert.strictEqual(C.normCode(' 10-017 '), '10017');
});

ok('tagging creates one numbered item per piece with date and buying price', () => {
  const s = C.newState();
  const codes = C.addItems(s, { cat: 'Dresses', gender: 'Girls', size: '2-3y', buy: '450', tag: '900', qty: '3' }, 'Owner', T0);
  assert.strictEqual(codes.length, 3);
  assert.strictEqual(new Set(codes).size, 3);
  codes.forEach(c => { const it = s.items[c]; assert.ok(C.validCode(c)); assert.strictEqual(it.status, 'in'); assert.strictEqual(it.buy, 450); assert.strictEqual(it.taggedAt, T0); });
  throws(() => C.addItems(s, { cat: '', buy: '1' }, 'Owner', T0), /category/);
  throws(() => C.addItems(s, { cat: 'Tops', buy: '' }, 'Owner', T0), /buying price/);
  throws(() => C.addItems(s, { cat: 'Tops', buy: '10', qty: '0' }, 'Owner', T0), /Quantity/);
});

ok('selling records price, date, seller, payment and blocks double sales', () => {
  const s = C.newState();
  const [a, b, c] = C.addItems(s, { cat: 'Jeans', buy: 300, tag: 700, qty: 3 }, 'Owner', T0);
  const r = C.sell(s, [{ code: a, price: '700' }, { code: b, price: '650' }], { pay: 'M-Pesa', by: 'Mary', uid: 'u1', saleId: 'A1' }, T0 + DAY);
  assert.deepStrictEqual(r, { saleId: 'A1', total: 1350, count: 2 });
  assert.strictEqual(s.items[a].soldByUid, 'u1');
  assert.strictEqual(s.items[a].status, 'sold'); assert.strictEqual(s.items[a].soldAt, T0 + DAY);
  assert.strictEqual(s.items[b].soldPrice, 650); assert.strictEqual(s.items[b].soldBy, 'Mary'); assert.strictEqual(s.items[b].pay, 'M-Pesa');
  throws(() => C.sell(s, [{ code: a, price: 700 }], {}, T0 + DAY), /not in stock/);
  throws(() => C.sell(s, [{ code: c, price: '' }], {}, T0 + DAY), /selling price/);
  throws(() => C.sell(s, [{ code: c, price: 5 }, { code: c, price: 5 }], {}, T0 + DAY), /twice/);
  throws(() => C.sell(s, [{ code: '99999', price: 5 }], {}, T0 + DAY), /not in the system/);
  assert.strictEqual(s.items[c].status, 'in', 'a failed sale must change nothing');
});

ok('cancelling a sale returns the item and leaves a trace', () => {
  const s = C.newState();
  const [a] = C.addItems(s, { cat: 'Tops', buy: 200, tag: 500 }, 'Owner', T0);
  C.sell(s, [{ code: a, price: 500 }], { pay: 'Cash', by: 'Mary' }, T0 + 1);
  C.returnToStock(s, a, 'Customer returned', 'Owner', T0 + 2);
  assert.strictEqual(s.items[a].status, 'in'); assert.strictEqual(s.items[a].soldPrice, undefined);
  const v = s.log.filter(l => l.type === 'void'); assert.strictEqual(v.length, 1); assert.ok(/500/.test(v[0].info) && /Mary/.test(v[0].info));
  assert.strictEqual(C.report(s, T0, T0 + DAY).n, 0);
  assert.strictEqual(C.report(s, T0, T0 + DAY).voids.length, 1);
});

ok('stock count finds missing items, sold items on the rack and unknown tags', () => {
  const s = C.newState();
  const codes = C.addItems(s, { cat: 'Shorts', buy: 100, tag: 250, qty: 5 }, 'Owner', T0);
  const [other] = C.addItems(s, { cat: 'Hats & mittens', buy: 50, qty: 1 }, 'Owner', T0);
  C.sell(s, [{ code: codes[4], price: 250 }], { by: 'Mary' }, T0 + 10);       // sold before the count
  C.startCount(s, '', 'Owner', T0 + DAY);
  assert.strictEqual(C.countScan(s, codes[0], T0 + DAY + 1).kind, 'ok');
  assert.strictEqual(C.countScan(s, codes[0], T0 + DAY + 2).kind, 'dup');
  assert.strictEqual(C.countScan(s, codes[1], T0 + DAY + 3).kind, 'ok');
  assert.strictEqual(C.countScan(s, codes[4], T0 + DAY + 4).kind, 'sold');
  assert.strictEqual(C.countScan(s, '123456', T0 + DAY + 5).kind, 'unknown');
  assert.strictEqual(C.countScan(s, other, T0 + DAY + 6).kind, 'ok');
  // an item scanned, then sold while the count is still running, is not a problem
  C.sell(s, [{ code: codes[1], price: 250 }], { by: 'Mary' }, T0 + DAY + 7);
  const r = C.countReview(s);
  assert.deepStrictEqual(r.missing.sort(), [codes[2], codes[3]].sort());
  assert.deepStrictEqual(r.soldOnRack, [codes[4]]);
  assert.deepStrictEqual(r.unknown, ['123456']);
  assert.strictEqual(r.missingCost, 200);
  const sum = C.finishCount(s, 'Owner', T0 + DAY + 100);
  assert.strictEqual(sum.missing.length, 2);
  assert.strictEqual(s.items[codes[2]].status, 'missing'); assert.strictEqual(s.count, null);
  // next count: one of the missing items turns up again
  C.startCount(s, 'Shorts', 'Owner', T0 + 2 * DAY);
  assert.strictEqual(C.countScan(s, codes[2], T0 + 2 * DAY + 1).kind, 'found');
  assert.strictEqual(C.countScan(s, other, T0 + 2 * DAY + 2).kind, 'scope');
  C.countScan(s, codes[0], T0 + 2 * DAY + 3);
  const sum2 = C.finishCount(s, 'Owner', T0 + 2 * DAY + 9);
  assert.strictEqual(s.items[codes[2]].status, 'in'); assert.strictEqual(sum2.missing.length, 0);
  assert.strictEqual(s.items[other].status, 'in', 'items outside the counted category are untouched');
});

ok('report adds up sales, profit and flags discounts', () => {
  const s = C.newState();
  const [a, b, c] = C.addItems(s, { cat: 'Dresses', buy: 400, tag: 900, qty: 3 }, 'Owner', T0);
  const [d] = C.addItems(s, { cat: 'Socks & stockings', buy: 50, tag: 120 }, 'Owner', T0);
  C.sell(s, [{ code: a, price: 900 }, { code: d, price: 120 }], { pay: 'Cash', by: 'Mary' }, T0 + DAY + 5);
  C.sell(s, [{ code: b, price: 350 }], { pay: 'M-Pesa', by: 'Joy' }, T0 + DAY + 9);   // below tag and below cost
  C.sell(s, [{ code: c, price: 900 }], { pay: 'Cash', by: 'Mary' }, T0 + 5 * DAY);    // outside the range
  const r = C.report(s, T0 + DAY, T0 + 2 * DAY);
  assert.strictEqual(r.n, 3); assert.strictEqual(r.revenue, 1370); assert.strictEqual(r.cost, 850); assert.strictEqual(r.profit, 520);
  assert.strictEqual(r.byPay.Cash.amount, 1020); assert.strictEqual(r.byPay['M-Pesa'].amount, 350);
  assert.strictEqual(r.byStaff.Mary.n, 2); assert.strictEqual(r.byCat.Dresses.profit, 450);
  assert.deepStrictEqual(r.belowTag, [b]); assert.deepStrictEqual(r.belowCost, [b]);
  const st = C.stock(s, T0 + 70 * DAY);
  assert.strictEqual(st.inN, 0); assert.strictEqual(st.soldN, 4);
});

ok('edit, write-off, delete and CSV', () => {
  const s = C.newState();
  const [a, b] = C.addItems(s, { cat: 'Tops', desc: 'red, "frilly"', buy: 200, tag: 500, qty: 2 }, 'Owner', T0);
  assert.strictEqual(C.editItem(s, a, { buy: '250', cat: 'Blouses' }, 'Owner', T0 + 1), 2);
  assert.strictEqual(s.items[a].buy, 250);
  C.takeOut(s, b, 'writeoff', 'Torn', 'Owner', T0 + 2);
  throws(() => C.deleteItem(s, b, '', 'Owner', T0 + 3), /in stock/);
  const csv = C.toCSV(s).split('\r\n');
  assert.strictEqual(csv.length, 3); assert.ok(csv[1].includes('"red, ""frilly"""'));
  C.deleteItem(s, a, 'mistake', 'Owner', T0 + 4);
  assert.strictEqual(s.items[a], undefined); assert.ok(s.log.some(l => l.type === 'deleted'));
});

console.log('\n' + n + ' groups passed');
