// Checks the catalog and the pure helpers in app.js without a browser.
//   node test-catalog.js
'use strict';
const fs = require('fs');

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok    ' + name);
  else { failures++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const src = fs.readFileSync('app.js', 'utf8');
const slice = (startMark, endMark) => {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a) + endMark.length;
  return src.slice(a, b);
};

const K = 'K', G = 'G', IMG_MBA = 'mba', IMG_MBP = 'mbp', IMG_VIVO16 = 'vivo';
const CATALOG = eval('(function(){' + slice('var CATALOG = {', '\n  };') + ' return CATALOG;})()');
const BAND_MAX = [60000, 70000, 80000, Infinity];
const BANDS = ['Under ₹60k', '₹60k–70k', '₹70k–80k', 'Above ₹80k'];
const DISC = 8;
const bandFor = p => { for (let i = 0; i < BAND_MAX.length; i++) if (p < BAND_MAX[i]) return i; return BAND_MAX.length - 1; };
const pretty = n => Math.round(n / 1000) * 1000 - 1;
const poolPrice = n => pretty(n * (1 - DISC / 100));

const purposes = Object.keys(CATALOG);
const all = [].concat(...purposes.map(p => CATALOG[p]));

console.log('\nCatalog\n');

check('four purposes', purposes.length === 4 && purposes.join() === 'game,code,bal,des', purposes);
check('ids are globally unique', new Set(all.map(l => l.id)).size === all.length);
check('every row has brand, model, why', all.every(l => l.brand && l.model && l.why));
check('every row has exactly three spec pills', all.every(l => Array.isArray(l.c) && l.c.length === 3),
  all.filter(l => l.c.length !== 3).map(l => l.id));
check('every row carries a src tag', all.every(l => ['guide', 'prior', 'added'].indexOf(l.src) !== -1),
  all.filter(l => !l.src).map(l => l.id));

check('every price ends in 999', all.every(l => l.price % 1000 === 999),
  all.filter(l => l.price % 1000 !== 999).map(l => l.id + ':' + l.price));
check('every mrp ends in 999', all.every(l => !l.mrp || l.mrp % 1000 === 999),
  all.filter(l => l.mrp && l.mrp % 1000 !== 999).map(l => l.id + ':' + l.mrp));
check('no mrp below its price', all.every(l => !l.mrp || l.mrp >= l.price),
  all.filter(l => l.mrp && l.mrp < l.price).map(l => l.id));
check('every pool price ends in 999', all.every(l => poolPrice(l.price) % 1000 === 999));
check('pool price is always below street price', all.every(l => poolPrice(l.price) < l.price));
check('effective discount stays between 6 and 10 percent', all.every(l => {
  const pct = (l.price - poolPrice(l.price)) / l.price * 100;
  return pct >= 6 && pct <= 10;
}), all.map(l => l.id + ':' + ((l.price - poolPrice(l.price)) / l.price * 100).toFixed(1)).slice(0, 4));

console.log('\nBand coverage\n');
let empties = [];
purposes.forEach(p => {
  for (let b = 0; b < 4; b++) {
    const n = CATALOG[p].filter(l => bandFor(l.price) === b).length;
    if (!n) empties.push(p + '/' + BANDS[b]);
  }
});
check('no purpose and band combination is empty', empties.length === 0, empties);
check('every band label matches the prices inside it', purposes.every(p =>
  CATALOG[p].every(l => {
    const b = bandFor(l.price);
    const lo = b === 0 ? 0 : BAND_MAX[b - 1];
    return l.price >= lo && l.price < BAND_MAX[b];
  })));
purposes.forEach(p => {
  const counts = [0, 1, 2, 3].map(b => CATALOG[p].filter(l => bandFor(l.price) === b).length);
  console.log('  ' + p.padEnd(6) + counts.map((c, i) => BANDS[i] + ' ' + c).join('   '));
});

console.log('\nCopy rules\n');
check('no em or en dashes anywhere in card copy',
  all.every(l => !/[—–]/.test(l.why + l.model + l.c.join(''))),
  all.filter(l => /[—–]/.test(l.why)).map(l => l.id));
check('no rupee figure in any card description', all.every(l => !/₹/.test(l.why)),
  all.filter(l => /₹/.test(l.why)).map(l => l.id + ': ' + l.why));
check('descriptions stay under 80 characters', all.every(l => l.why.length <= 80),
  all.filter(l => l.why.length > 80).map(l => l.id + ':' + l.why.length));
check('models are unique within a purpose', purposes.every(p => {
  const names = CATALOG[p].map(l => l.brand + ' ' + l.model);
  return new Set(names).size === names.length;
}), purposes.filter(p => {
  const names = CATALOG[p].map(l => l.brand + ' ' + l.model);
  return new Set(names).size !== names.length;
}));

console.log('\nSource path parsing\n');
const parseSource = pathname => {
  const seg = pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
  return seg ? seg.slice(0, 40).toLowerCase() : 'direct';
};
const cases = [['/', 'direct'], ['/test', 'test'], ['/test/', 'test'], ['/TEST', 'test'],
  ['//whatsapp//', 'whatsapp'], ['/insta/bio', 'insta'], ['/qr-poster', 'qr-poster']];
cases.forEach(([input, want]) => check('"' + input + '" tags as ' + want, parseSource(input) === want, parseSource(input)));
check('an absurdly long path is capped at 40 characters', parseSource('/' + 'x'.repeat(200)).length === 40);

console.log('\nApp wiring\n');
check('every data-action in markup has a handler', (() => {
  const emitted = new Set([...src.matchAll(/data-action="([a-z-]+)"/g)].map(m => m[1]));
  const handled = new Set([...src.matchAll(/case '([a-z-]+)':/g)].map(m => m[1]));
  const orphans = [...emitted].filter(a => !handled.has(a));
  if (orphans.length) console.log('    orphans: ' + orphans.join(', '));
  return orphans.length === 0;
})());
check('the picks card renders a formatted price', /class="laptop-price">' \+ fmt\(l\.price\)/.test(src));
check('the picks card shows mrp struck through only when the catalog sets one above price',
  /class="laptop-mrp">' \+ fmt\(l\.mrp\)/.test(src) && /l\.mrp && l\.mrp > l\.price/.test(src));
check('fmt() is used only for the sheet payload and the picks card price/mrp', (() => {
  const uses = [...src.matchAll(/fmt\(/g)].length;
  return uses === 4;   // definition, leadPayload's picks string, laptop-price, laptop-mrp
})(), [...src.matchAll(/.{40}fmt\(.{30}/g)].map(m => m[0]));
check('price renders in Indian digit grouping (xx,xxx under 1L, x,xx,xxx at 1L+)',
  (57999).toLocaleString('en-IN') === '57,999' && (102999).toLocaleString('en-IN') === '1,02,999');
check('no event logs a name or phone value',
  !/track\([^)]*state\.(name|phone)/.test(src));
check('contact fields still have stable ids for focus restore',
  /id="field-name"/.test(src) && /id="field-phone"/.test(src) && /id="field-custom"/.test(src));
check('sheet endpoint is set to a script.google.com url',
  /SHEET_ENDPOINT = 'https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec'/.test(src));
check('no leftover debug endpoint', !/__probe|localhost:4173/.test(src));

console.log('\n' + (failures ? failures + ' FAILED' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
