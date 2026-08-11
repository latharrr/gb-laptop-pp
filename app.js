(function () {
  'use strict';

  // ---------- pool math (hardcoded defaults, mirrors design defaults) ----------
  var DISC = 8; // % discount
  var POOL_ID = 'AUG-LPT-07';

  // ---------- google sheet ----------
  // Paste the Apps Script web app URL here, the one ending in /exec. The script
  // and its setup steps live in google-sheet.gs. Leaving this empty is safe: the
  // form still works end to end and every response is logged to the console
  // instead, so the sheet can be wired up later without touching anything else.
  var SHEET_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwZQmKE5tGvaq-SpbmV_f9D9YA0FCv6aofU-r13uUNNuh_Wc7sRXPGc4VE6yKBKROow_g/exec';
  var SHEET_SECRET = ''; // must match SHARED_SECRET in google-sheet.gs, if set there
  var QUEUE_KEY = 'pp_sheet_queue';
  var VISIT_KEY = 'pp_visit_logged';
  var SEEN_KEY = 'pp_seen_before';

  // ---------- where the visitor came from ----------
  // The first path segment is the campaign tag, so laptop.picapool.tech/test
  // stamps every response from that link as "test". Hand a different tag to the
  // WhatsApp group, the poster QR and the Instagram bio and the sheet tells you
  // which one actually worked. Vercel rewrites unknown paths back to index.html,
  // so every tag opens the same home screen.
  var SOURCE = (function () {
    var seg = location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
    return seg ? seg.slice(0, 40).toLowerCase() : 'direct';
  })();

  // Budget bands follow the FOT DU guide brackets so the picks line up with it.
  var BANDS = ['Under ₹60k', '₹60k–70k', '₹70k–80k', 'Above ₹80k'];
  var BANDP = ['under ₹60k', 'in ₹60k–70k', 'in ₹70k–80k', 'above ₹80k'];
  var BAND_MAX = [60000, 70000, 80000, Infinity];
  var PSHORT = { game: 'gaming', code: 'coding', bal: 'everyday use', des: 'design work' };
  var PLABEL = { game: 'Gaming', code: 'Heavy coding and dev', bal: 'Balanced everyday use', des: 'Design and editing' };

  var K = '#1C1C1E', G = '#3A3A3C';

  // ---------- catalog ----------
  // src = where the row came from, so the next person to touch a price knows how
  //       much to trust it:
  //   'guide'  FOT DU Laptop Group Buy Guide 2026, verified against retailer
  //            listings and price trackers on 8 and 9 August 2026.
  //   'prior'  carried over from the catalog that shipped before the guide
  //            landed. Checked once, but not against the guide. Recheck these.
  //   'added'  asked for by name and not in either list. Recheck these first.
  //
  // price = indicative street price, rounded to a x,999 ending for display. The
  //         exact figures the guide verified are in the PDF. This also decides
  //         which budget band the laptop shows up in.
  // mrp   = list price, shown struck through. Only set where a source gave one.
  // img   = product photo from the brand's own CDN. Falls back to the
  //         illustration if it 404s or gets hotlink blocked.
  //
  // Prices in India move every sale. Recheck before each campaign.
  var PRICES_CHECKED = '9 Aug 2026';
  function asusImg(id) { return 'https://dlcdnwebimgs.asus.com/gain/' + id + '/w400'; }
  var IMG_MBA = 'https://www.apple.com/v/macbook-air/z/images/overview/design/color/design_side_midnight__flnancj2vlme_large.jpg';
  var IMG_MBP = 'https://www.apple.com/v/macbook-pro/ax/images/overview/product-viewer/pv_colors_spaceblack__dwfpyrbaf4cy_large.jpg';
  var IMG_VIVO16 = asusImg('e7bccfbd-9a96-4922-ad06-1814a770579a');

  var CATALOG = {
    game: [
      { id: 'g1', src: 'guide', brand: 'Lenovo', model: 'LOQ', c: ['RTX 3050 6GB', 'Ryzen 5 7235HS', '144Hz 100% sRGB'], why: 'The batch favourite. The one bright, colour true screen in this bracket.', price: 57999, lid: K },
      { id: 'g2', src: 'guide', brand: 'HP', model: 'Victus 15 RTX 2050', c: ['RTX 2050', 'i5-12450H', 'RAM to 64GB'], why: 'Cheapest CUDA card for ML labs. Only if the budget is capped.', price: 53999, lid: G },
      { id: 'g3', src: 'guide', brand: 'HP', model: 'Victus 15 RTX 4050', c: ['RTX 4050', 'i5-13420H', 'DLSS 3.5'], why: 'Cheapest real RTX 4050, but only at sale prices. Set an alert.', price: 64999, lid: G },
      { id: 'g4', src: 'prior', brand: 'ASUS', model: 'TUF Gaming A15', c: ['RTX 3050', 'Ryzen 7 7435HS', '16GB DDR5'], why: 'Valorant past 200 fps, and the RAM opens up later.', price: 64999, lid: K },
      { id: 'g5', src: 'guide', brand: 'MSI', model: 'Thin 15', c: ['RTX 3050', 'i5-13420H', '1.86 kg'], why: 'The one gaming laptop light enough to carry every day.', price: 66999, lid: K },
      { id: 'g6', src: 'guide', brand: 'Acer', model: 'Nitro V 15', c: ['RTX 4050', 'Ryzen 5 6600H', '165Hz 300 nits'], why: 'Highest fps in its class, and the best screen with it.', price: 73999, lid: G },
      { id: 'g7', src: 'guide', brand: 'Dell', model: 'G15-5530', c: ['RTX 3050 6GB', 'i5-13450HX', '1TB SSD'], why: 'Worth it only if you need 1TB of storage on day one.', price: 74999, lid: K },
      { id: 'g8', src: 'guide', brand: 'ASUS', model: 'Gaming V16', c: ['RTX 3050 6GB', 'Core 5 210H', '16in 16:10'], why: 'Taller screen for code plus gaming, with Office bundled.', price: 79999, lid: K },
      { id: 'g9', src: 'guide', brand: 'HP', model: 'Victus 15 i7', c: ['RTX 4050', 'i7-13620H', '300 nits'], why: 'The i7 pays off if you compile and stream at the same time.', price: 102999, lid: G },
      { id: 'g10', src: 'guide', brand: 'ASUS', model: 'TUF A16', c: ['RTX 4050 140W', 'Ryzen 7 7445HS', '1TB SSD'], why: 'Best cooling here, so it holds speed through long sessions.', price: 102999, lid: K },
      { id: 'g11', src: 'prior', brand: 'ASUS', model: 'TUF Gaming F16', c: ['RTX 5050', 'i5-13450HX', '165Hz'], why: 'MIL-STD build that survives four years of hostel life.', price: 124999, lid: K },
      { id: 'g12', src: 'guide', brand: 'HP', model: 'Omen 16', c: ['RTX 4060 8GB', 'QHD 165Hz', '1TB SSD'], why: 'The 8GB card matters for AI coursework and 1440p.', price: 129999, lid: G },
    ],
    code: [
      { id: 'c1', src: 'guide', brand: 'Lenovo', model: 'IdeaPad Slim 3x', c: ['Snapdragon X', '16GB RAM', 'Dual M.2 slots'], why: 'Two SSD slots and a shell that shrugs off a daily commute.', price: 47999, lid: G },
      { id: 'c2', src: 'guide', brand: 'ASUS', model: 'Vivobook 16', c: ['Snapdragon X', '16GB RAM', '14 hr battery'], why: 'Runs Python, Java and VS Code all day without a charger.', price: 51999, lid: G, img: IMG_VIVO16 },
      { id: 'c3', src: 'guide', brand: 'Acer', model: 'Aspire Go 14', c: ['Core Ultra 5 125H', '16GB DDR5', '512GB SSD'], why: 'Fastest chip in this bracket, and the RAM goes to 32GB later.', price: 52999, lid: K },
      { id: 'c4', src: 'guide', brand: 'Motorola', model: 'Motobook 60', c: ['Core 5 210H', '16GB to 32GB', '2.8K 120Hz OLED'], why: 'The best screen you can code on down here. Keep the charger close.', price: 59999, lid: G },
      { id: 'c5', src: 'guide', brand: 'Apple', model: 'MacBook Neo', c: ['A18 Pro', '8GB unified', '13in Retina'], why: 'Cheapest Mac ever with a college ID. Not for SolidWorks branches.', price: 59999, mrp: 69999, lid: G },
      { id: 'c6', src: 'prior', brand: 'Lenovo', model: 'IdeaPad Slim 5 OLED', c: ['Ryzen 7', '16GB RAM', '2.8K OLED'], why: 'OLED this sharp usually costs ten thousand more.', price: 61999, lid: G },
      { id: 'c7', src: 'guide', brand: 'HP', model: 'Pavilion 16', c: ['Core Ultra 5 125U', '16GB LPDDR5', '16in WUXGA'], why: 'Big screen for split view coding. RAM is soldered though.', price: 64999, lid: G },
      { id: 'c8', src: 'guide', brand: 'ASUS', model: 'Vivobook S 15 OLED', c: ['i7 12th Gen H', '16GB RAM', '1TB SSD'], why: 'Solid large OLED, though newer chips undercut it now.', price: 68999, lid: K },
      { id: 'c9', src: 'guide', brand: 'Lenovo', model: 'IdeaPad Slim 5', c: ['Ryzen 7 7735HS', '16GB RAM', 'OLED options'], why: 'Safe all rounder with real service cover across Delhi NCR.', price: 73999, lid: G },
      { id: 'c10', src: 'guide', brand: 'HP', model: 'OmniBook 5', c: ['Ryzen AI 7 350', '16GB RAM', '16in 2K OLED'], why: 'Current gen chip and NPU. Built to still feel fine in year four.', price: 75999, lid: K },
      { id: 'c11', src: 'guide', brand: 'ASUS', model: 'Gaming V16', c: ['RTX 3050 6GB', 'Core 5 210H', '16in 16:10'], why: 'A CUDA card and a tall screen, if ML coursework is coming.', price: 79999, lid: K },
      { id: 'c12', src: 'prior', brand: 'Lenovo', model: 'Yoga Slim 7', c: ['Core Ultra 5 125H', '16GB RAM', '2.8K OLED'], why: '1.3 kg, quiet, and a real screen for long days.', price: 84999, lid: G },
      { id: 'c13', src: 'guide', brand: 'Apple', model: 'MacBook Air M4', c: ['M4', '16GB RAM', '18 hr battery'], why: 'Best battery, screen and resale value, if macOS suits your labs.', price: 89999, lid: K, img: IMG_MBA },
      { id: 'c14', src: 'added', brand: 'Apple', model: 'MacBook Air M5', c: ['M5', '16GB RAM', '512GB SSD'], why: 'The newest Air. Silent, Unix shell, and it never feels slow.', price: 113999, mrp: 119999, lid: K, img: IMG_MBA },
      { id: 'c15', src: 'prior', brand: 'Apple', model: 'MacBook Pro 14 M5', c: ['M5', '16GB RAM', 'XDR display'], why: 'Flies through the longest builds without throttling.', price: 169999, mrp: 169999, lid: G, img: IMG_MBP },
    ],
    bal: [
      { id: 'b1', src: 'prior', brand: 'Acer', model: 'Aspire Lite', c: ['Ryzen 5', '16GB RAM', '512GB SSD'], why: 'Everything a fresher needs and nothing extra.', price: 42999, lid: G },
      { id: 'b2', src: 'prior', brand: 'HP', model: '15s', c: ['i5-1335U', '16GB RAM', '512GB SSD'], why: 'Safe pick, serviceable in almost every small town.', price: 45999, lid: K },
      { id: 'b3', src: 'guide', brand: 'Lenovo', model: 'IdeaPad Slim 3x', c: ['Snapdragon X', '16GB RAM', 'MIL-STD-810H'], why: 'Military grade shell and the only 5MP webcam in this bracket.', price: 47999, lid: G },
      { id: 'b4', src: 'guide', brand: 'ASUS', model: 'Vivobook 16', c: ['Snapdragon X', '16GB RAM', '14 hr battery'], why: 'A full college day without carrying the charger.', price: 51999, lid: G, img: IMG_VIVO16 },
      { id: 'b5', src: 'guide', brand: 'Acer', model: 'Aspire Go 14', c: ['Core Ultra 5 125H', '16GB DDR5', '1.5 kg'], why: 'The guide top pick. Fast, light and upgradeable.', price: 52999, lid: K },
      { id: 'b6', src: 'guide', brand: 'Apple', model: 'MacBook Neo', c: ['A18 Pro', '8GB unified', '16 hr battery'], why: 'Fanless, silent, and it lasts a full day of classes.', price: 59999, mrp: 69999, lid: G },
      { id: 'b7', src: 'prior', brand: 'Lenovo', model: 'IdeaPad Slim 5 OLED', c: ['Ryzen 7', '16GB RAM', '2.8K OLED'], why: 'The cheapest screen here that you will actually enjoy.', price: 61999, lid: G },
      { id: 'b8', src: 'guide', brand: 'HP', model: 'Pavilion 16', c: ['Core Ultra 5 125U', '16in WUXGA', 'Face unlock'], why: 'Made for online classes. Sharp 1080p camera, stays silent.', price: 64999, lid: G },
      { id: 'b9', src: 'guide', brand: 'Lenovo', model: 'IdeaPad Slim 5', c: ['Ryzen 7 7735HS', '16GB RAM', 'Metal body'], why: 'Quick service in Delhi when something breaks mid semester.', price: 73999, lid: G },
      { id: 'b10', src: 'guide', brand: 'HP', model: 'OmniBook 5', c: ['Ryzen AI 7 350', '16GB RAM', '16in 2K OLED'], why: 'Premium build that still feels current in four years.', price: 75999, lid: K },
      { id: 'b11', src: 'prior', brand: 'Lenovo', model: 'Yoga Slim 7', c: ['Core Ultra 5 125H', '16GB RAM', '2.8K OLED'], why: 'Light, quiet and easy to live with all day.', price: 84999, lid: G },
      { id: 'b12', src: 'guide', brand: 'ASUS', model: 'Zenbook 14 OLED', c: ['Core Ultra or X Elite', '16GB RAM', '14in 3K OLED'], why: 'The closest Windows gets to a MacBook Air.', price: 86999, lid: K },
      { id: 'b13', src: 'guide', brand: 'Apple', model: 'MacBook Air M4', c: ['M4', '16GB RAM', '1.24 kg'], why: 'Silent, fanless and good for all four years.', price: 89999, lid: K, img: IMG_MBA },
      { id: 'b14', src: 'added', brand: 'Apple', model: 'MacBook Air M5', c: ['M5', '16GB RAM', '512GB SSD'], why: 'The newest Air, with double the storage of the M4 base.', price: 113999, mrp: 119999, lid: K, img: IMG_MBA },
    ],
    des: [
      { id: 'd1', src: 'guide', brand: 'Lenovo', model: 'LOQ', c: ['RTX 3050 6GB', '100% sRGB', '300 nits'], why: 'The cheapest machine here with colour you can actually trust.', price: 57999, lid: K },
      { id: 'd2', src: 'guide', brand: 'Motorola', model: 'Motobook 60', c: ['14in 2.8K OLED', '120Hz', '100% DCI-P3'], why: 'A flagship panel at a mid range price. Battery is the trade off.', price: 59999, lid: G },
      { id: 'd3', src: 'prior', brand: 'Lenovo', model: 'IdeaPad Slim 5 OLED', c: ['2.8K OLED', 'Ryzen 7', '16GB RAM'], why: '100% DCI-P3 colour without leaving the budget.', price: 61999, lid: G },
      { id: 'd4', src: 'guide', brand: 'HP', model: 'Victus 15 RTX 4050', c: ['RTX 4050', 'DLSS 3.5', '300 nits'], why: 'Cheapest way to get a card that renders and trains.', price: 64999, lid: G },
      { id: 'd5', src: 'guide', brand: 'ASUS', model: 'Vivobook S 15 OLED', c: ['15.6in OLED', 'i7 12th Gen H', '1TB SSD'], why: 'Large OLED with room for footage and project files.', price: 68999, lid: K },
      { id: 'd6', src: 'guide', brand: 'Acer', model: 'Nitro V 15', c: ['RTX 4050', 'Ryzen 5 6600H', '165Hz 300 nits'], why: 'The GPU SolidWorks, ANSYS and Blender actually want.', price: 73999, lid: G },
      { id: 'd7', src: 'guide', brand: 'HP', model: 'OmniBook 5', c: ['16in 2K OLED', 'Ryzen AI 7 350', 'Touch options'], why: 'OLED touch panel in a slim aluminium body.', price: 75999, lid: K },
      { id: 'd8', src: 'prior', brand: 'ASUS', model: 'Vivobook S14 OLED', c: ['Core Ultra 5', '16GB RAM', 'OLED'], why: '1.4 kg with a colour true panel. Easy to carry to studio.', price: 84999, lid: K },
      { id: 'd9', src: 'guide', brand: 'ASUS', model: 'Zenbook 14 OLED', c: ['14in 3K OLED', 'Core Ultra or X Elite', 'Under 1.3 kg'], why: 'Colour true and still light enough to carry all day.', price: 86999, lid: K },
      { id: 'd10', src: 'guide', brand: 'ASUS', model: 'TUF A16', c: ['RTX 4050 140W', 'Ryzen 7 7445HS', '1TB SSD'], why: 'Sustained power for CAD and long render queues.', price: 102999, lid: K },
      { id: 'd11', src: 'guide', brand: 'HP', model: 'Omen 16', c: ['RTX 4060 8GB', 'QHD 165Hz', '1TB SSD'], why: 'For heavy 3D, render queues and AI work.', price: 129999, lid: G },
      { id: 'd12', src: 'prior', brand: 'Apple', model: 'MacBook Pro 14 M5', c: ['M5', '16GB RAM', 'XDR display'], why: 'Final Cut, colour true screen, and it never gets loud.', price: 169999, mrp: 169999, lid: K, img: IMG_MBP },
    ],
  };

  // Band comes from the price so a card can never sit in a bracket its own price
  // contradicts. Ranges in the guide are keyed off their low end.
  function bandFor(price) {
    for (var i = 0; i < BAND_MAX.length; i++) if (price < BAND_MAX[i]) return i;
    return BAND_MAX.length - 1;
  }
  Object.keys(CATALOG).forEach(function (p) {
    CATALOG[p].forEach(function (l) { l.band = bandFor(l.price); });
  });
  var ALL_LAPTOPS = [].concat(CATALOG.game, CATALOG.code, CATALOG.bal, CATALOG.des);

  var INTENTS = [
    { key: 'now', title: 'Ready to buy, just want the pool price', desc: 'Money in hand, waiting on the drop' },
    { key: 'price', title: 'Will buy if the price gets good enough', desc: 'The discount decides it' },
    { key: 'look', title: 'Still comparing, keep me posted', desc: 'Watching pools, no promises' },
  ];
  var WEEK_COUNT = 6;
  var STEPS = ['purpose', 'budget', 'picks', 'timeline', 'intent', 'contact'];
  var ORDER = ['landing', 'purpose', 'budget', 'picks', 'timeline', 'intent', 'contact', 'done'];

  function fmt(n) { return '₹' + n.toLocaleString('en-IN'); }
  // Every number on screen lands on a x,999 ending. Retail prices in India are
  // written this way, and it keeps the pool price and the saving from coming out
  // as ragged figures like ₹48,759.
  function pretty(n) { return Math.round(n / 1000) * 1000 - 1; }
  function poolPrice(n) { return pretty(n * (1 - DISC / 100)); }
  function matches(purpose, band) { return (CATALOG[purpose] || []).filter(function (l) { return l.band === band; }); }
  function nextBandWith(purpose, band) {
    var cands = [band + 1, band + 2, band - 1, band - 2];
    for (var i = 0; i < cands.length; i++) {
      var b = cands[i];
      if (b >= 0 && b <= 3 && matches(purpose, b).length) return b;
    }
    return band;
  }
  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---------- buying windows (week bands, not exact dates) ----------
  function buildWeeks() {
    var today = new Date();
    var out = [];
    for (var i = 0; i < WEEK_COUNT; i++) {
      var s = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i * 7);
      var e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
      out.push({ i: i, start: s, end: e });
    }
    return out;
  }
  function weekRange(w) {
    var sm = w.start.toLocaleString('en', { month: 'short' });
    var em = w.end.toLocaleString('en', { month: 'short' });
    if (sm === em) return w.start.getDate() + '–' + w.end.getDate() + ' ' + sm;
    return w.start.getDate() + ' ' + sm + ' – ' + w.end.getDate() + ' ' + em;
  }
  function weekRelative(i) {
    if (i === 0) return 'This week';
    if (i === 1) return 'Next week';
    return 'In ' + (i + 1) + ' weeks';
  }

  // ---------- state ----------
  var initialState = {
    screen: 'landing', purpose: null, budget: null, loading: false, bumped: false,
    cart: {}, custom: '', week: null, intent: null, fromDone: false,
    name: '', phone: '', tried: false, leadId: null,
  };
  var state = Object.assign({}, initialState);
  var pendingTimer = null;
  var autoTimer = null;
  var forceCaretEnd = false;
  var AUTO_JOIN_MS = 2000;

  function setState(patch) {
    var next = typeof patch === 'function' ? patch(state) : patch;
    state = Object.assign({}, state, next);
    render();
  }
  function go(screen, delay) {
    clearTimeout(pendingTimer);
    if (delay) { pendingTimer = setTimeout(function () { setState({ screen: screen }); }, delay); return; }
    setState({ screen: screen });
  }
  function enterPicks(extra) {
    clearTimeout(pendingTimer);
    setState(Object.assign({ screen: 'picks', loading: true }, extra || {}));
    pendingTimer = setTimeout(function () { setState({ loading: false }); }, 900);
  }
  function restart() {
    clearAutoJoin();
    setState(Object.assign({}, initialState, { cart: {} }));
  }
  // The single door into the pool screen, from the button, from auto capture and
  // from coming back after an edit. The lead ID is minted once and reused, so a
  // second send updates that person's row instead of adding another.
  function enterDone() {
    clearAutoJoin();
    clearTimeout(pendingTimer);
    setState({ screen: 'done', fromDone: false, leadId: state.leadId || newLeadId() });
    sendToSheet();
  }

  // ---------- sending responses to the sheet ----------
  function cartLaptops() {
    var ids = Object.keys(state.cart).filter(function (k) { return state.cart[k]; });
    return ALL_LAPTOPS.filter(function (l) { return ids.indexOf(l.id) !== -1; });
  }
  function newLeadId() {
    return 'pp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }
  function intentTitle(key) {
    for (var i = 0; i < INTENTS.length; i++) if (INTENTS[i].key === key) return INTENTS[i].title;
    return '';
  }
  function weekLabel() {
    if (state.week === 'unsure') return 'Not sure yet';
    if (typeof state.week !== 'number') return '';
    var weeks = buildWeeks();
    return weekRange(weeks[state.week]) + ' (' + weekRelative(state.week).toLowerCase() + ')';
  }
  // One flat object per response. Flat because every key becomes a sheet column.
  function leadPayload() {
    var items = cartLaptops();
    return {
      leadId: state.leadId,
      poolId: POOL_ID,
      submittedAt: new Date().toISOString(),
      name: state.name.trim(),
      phone: '+91' + state.phone,
      purpose: PLABEL[state.purpose] || '',
      budget: state.budget != null ? BANDS[state.budget] : '',
      picks: items.map(function (l) { return l.brand + ' ' + l.model + ' ' + fmt(l.price); }).join(' | '),
      pickCount: items.length,
      custom: state.custom.trim(),
      week: weekLabel(),
      readiness: intentTitle(state.intent),
      poolTotal: items.reduce(function (a, l) { return a + poolPrice(l.price); }, 0),
      listTotal: items.reduce(function (a, l) { return a + (l.mrp || l.price); }, 0),
      source: SOURCE,
      host: location.hostname || 'local',
    };
  }
  // text/plain keeps this a simple request, so the browser skips the preflight
  // that Apps Script cannot answer. no-cors means the response is opaque, so a
  // rejected promise (offline, DNS, blocked) is the only failure we can see.
  function post(body) {
    return fetch(SHEET_ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
      keepalive: true,
    });
  }
  function readQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { return []; }
  }
  function writeQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-20))); } catch (e) { /* private mode */ }
  }
  function queueBody(body) {
    var q = readQueue();
    q.push(body);
    writeQueue(q);
  }
  function send(body) {
    post(body).catch(function () { queueBody(body); });
  }
  // Anything that failed while the phone was offline goes out on the next visit.
  function flushQueue() {
    if (!SHEET_ENDPOINT) return;
    var q = readQueue();
    if (!q.length) return;
    writeQueue([]);
    q.forEach(send);
  }
  function sendToSheet() {
    var payload = leadPayload();
    if (SHEET_SECRET) payload.secret = SHEET_SECRET;
    if (!SHEET_ENDPOINT) {
      console.log('[picapool] SHEET_ENDPOINT is empty, response not sent:', payload);
      return;
    }
    send(JSON.stringify(payload));
  }
  // One tap on the link is one row in the Taps sheet, whether or not the person
  // ever fills the form. Taps against responses is what tells you if a link is
  // being ignored or the form is losing people. Guarded by sessionStorage so a
  // refresh or a back button is not counted twice.
  function pingTap() {
    if (!SHEET_ENDPOINT) return;
    var repeat = false;
    try {
      if (sessionStorage.getItem(VISIT_KEY)) return;
      sessionStorage.setItem(VISIT_KEY, '1');
      repeat = !!localStorage.getItem(SEEN_KEY);
      localStorage.setItem(SEEN_KEY, '1');
    } catch (e) { /* private mode, log the tap anyway */ }
    var payload = {
      type: 'tap',
      tappedAt: new Date().toISOString(),
      source: SOURCE,
      path: location.pathname,
      repeat: repeat ? 'yes' : 'no',
      referrer: document.referrer || '',
      host: location.hostname || 'local',
      poolId: POOL_ID,
    };
    if (SHEET_SECRET) payload.secret = SHEET_SECRET;
    send(JSON.stringify(payload));
  }

  // ---------- auto capture ----------
  // Contact details save themselves once both fields are valid, so nobody has to
  // hunt for a button. Every keystroke pushes the deadline back.
  function contactReady(st) {
    return st.name.trim().length > 0 && /^\d{10}$/.test(st.phone);
  }
  function clearAutoJoin() {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
  function scheduleAutoJoin() {
    clearAutoJoin();
    if (!contactReady(state)) return;
    autoTimer = setTimeout(function () {
      autoTimer = null;
      if (state.screen === 'contact' && contactReady(state)) enterDone();
    }, AUTO_JOIN_MS);
  }

  // ---------- icons ----------
  function backIcon() {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M14.5 5.5 L8 12 L14.5 18.5" stroke="#1C1C1E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  }
  function logoIcon() {
    return '<svg width="26" height="26" viewBox="0 0 36 36" fill="#FF2F01"><g transform="translate(0.097,0)"><path d="M 14.248 0 C 14.242 0.094 14.231 0.188 14.231 0.281 C 14.231 4.844 14.231 9.407 14.231 13.969 C 14.231 14.15 14.143 14.24 13.966 14.24 C 10.622 14.24 7.278 14.24 3.933 14.24 C 3.744 14.24 3.649 14.337 3.648 14.531 C 3.648 15.212 3.648 15.893 3.648 16.573 C 3.648 17.158 3.641 17.743 3.649 18.328 C 3.684 20.704 4.236 22.951 5.367 25.044 C 6.5 27.139 8.061 28.851 10.045 30.17 C 11.252 30.973 12.553 31.584 13.949 31.982 C 14.101 32.025 14.161 32.085 14.16 32.252 C 14.152 33.374 14.156 34.495 14.156 35.617 C 14.156 35.679 14.151 35.74 14.146 35.829 C 14.027 35.802 13.926 35.778 13.825 35.756 C 12.339 35.441 10.924 34.929 9.583 34.215 C 7.509 33.11 5.706 31.666 4.187 29.87 C 2.392 27.747 1.152 25.34 0.496 22.636 C 0.287 21.774 0.128 20.902 0.091 20.014 C 0.058 19.209 0.022 18.403 0.021 17.598 C 0.015 11.819 0.018 6.041 0.017 0.262 C 0.017 0.175 0.006 0.087 0 0 L 14.248 0 Z"></path><path transform="translate(21.433,0)" d="M 14.433 0 C 14.427 0.094 14.417 0.188 14.417 0.282 C 14.416 3.509 14.417 6.736 14.413 9.962 C 14.412 11.153 14.39 12.343 14.391 13.534 C 14.391 14.938 14.442 16.344 14.407 17.748 C 14.337 20.604 13.826 23.372 12.619 25.985 C 11.666 28.048 10.331 29.832 8.684 31.389 C 7.431 32.575 6.033 33.555 4.495 34.334 C 3.124 35.028 1.683 35.524 0.182 35.851 C 0.039 35.882 0.001 35.837 0.001 35.705 C 0.003 34.558 0.004 33.411 0 32.264 C -0.001 32.123 0.075 32.081 0.187 32.047 C 0.674 31.9 1.17 31.776 1.645 31.596 C 3.751 30.802 5.555 29.554 7.065 27.888 C 8.775 26.002 9.916 23.81 10.448 21.319 C 10.606 20.579 10.705 19.817 10.736 19.061 C 10.798 17.545 10.794 16.027 10.816 14.509 C 10.82 14.241 10.815 14.24 10.539 14.24 C 7.182 14.24 3.825 14.24 0.468 14.24 C 0.292 14.24 0.204 14.15 0.204 13.969 C 0.204 9.4 0.204 4.831 0.203 0.262 C 0.203 0.175 0.192 0.087 0.186 0 C 4.935 0 9.684 0 14.433 0 Z"></path><path transform="translate(7.308,17.975)" d="M 10.584 0.004 C 14.009 0.004 17.435 0.004 20.861 0.004 C 21.134 0.004 21.14 0.004 21.132 0.267 C 20.994 4.524 19.079 7.699 15.333 9.736 C 14.276 10.311 13.129 10.645 11.929 10.79 C 9.746 11.054 7.668 10.712 5.714 9.693 C 3.767 8.677 2.271 7.197 1.231 5.259 C 0.63 4.138 0.25 2.943 0.09 1.684 C 0.028 1.199 0.034 0.706 0.001 0.216 C -0.01 0.052 0.044 -0.001 0.213 0 C 1.466 0.006 2.719 0.003 3.972 0.003 C 6.176 0.003 8.379 0.003 10.583 0.003 L 10.584 0.004 Z"></path></g></svg>';
  }
  function landingHeroSvg() {
    return '<svg viewBox="0 0 342 218" class="landing-hero-svg"><circle cx="228" cy="104" r="88" fill="#FFE5DA"></circle><circle cx="228" cy="104" r="60" fill="none" stroke="#FFB199" stroke-width="2" stroke-dasharray="3 7" stroke-linecap="round"></circle><path d="M 0 218 A 64 64 0 0 1 64 154 L 64 218 Z" fill="#C78922"></path><rect x="18" y="26" width="18" height="18" rx="5" fill="#0EC5FF" transform="rotate(16 27 35)"></rect><circle cx="52" cy="96" r="10" fill="#1C1C1E"></circle><circle cx="84" cy="58" r="7" fill="#F03506"></circle><circle cx="96" cy="140" r="8" fill="#C78922"></circle><path d="M 62 96 C 110 96 130 104 158 112" stroke="#C7C7CC" stroke-width="2" stroke-dasharray="1 6" stroke-linecap="round" fill="none"></path><path d="M 91 62 C 120 74 138 84 160 96" stroke="#C7C7CC" stroke-width="2" stroke-dasharray="1 6" stroke-linecap="round" fill="none"></path><path d="M 104 138 C 130 132 144 128 162 124" stroke="#C7C7CC" stroke-width="2" stroke-dasharray="1 6" stroke-linecap="round" fill="none"></path><rect x="164" y="52" width="128" height="82" rx="8" fill="#1C1C1E"></rect><rect x="172" y="60" width="112" height="66" rx="4" fill="#FFFFFF"></rect><rect x="180" y="70" width="52" height="10" rx="5" fill="#FFB199"></rect><rect x="180" y="86" width="72" height="10" rx="5" fill="#F03506"></rect><rect x="180" y="102" width="40" height="10" rx="5" fill="#FFE5DA"></rect><circle cx="268" cy="92" r="14" fill="#F03506"></circle><path d="M 262 92 L 266.5 96.5 L 274.5 87.5" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"></path><path d="M 150 134 L 306 134 L 296 152 C 294.8 154.2 292.5 155.5 290 155.5 L 166 155.5 C 163.5 155.5 161.2 154.2 160 152 Z" fill="#E1E1E3"></path><rect x="208" y="134" width="40" height="5" rx="2.5" fill="#C7C7CC"></rect></svg>';
  }
  function gameIcon() {
    return '<svg width="40" height="40" viewBox="0 0 40 40"><rect x="4" y="12" width="32" height="19" rx="9.5" fill="#1C1C1E"></rect><rect x="10" y="19" width="9" height="3.2" rx="1.6" fill="#FFFFFF"></rect><rect x="12.9" y="16.1" width="3.2" height="9" rx="1.6" fill="#FFFFFF"></rect><circle cx="27" cy="19" r="2.2" fill="#F03506"></circle><circle cx="31" cy="23.5" r="2.2" fill="#FFB199"></circle></svg>';
  }
  function codeIcon() {
    return '<svg width="40" height="40" viewBox="0 0 40 40"><rect x="4" y="8" width="32" height="24" rx="4" fill="#1C1C1E"></rect><path d="M 13 16 L 9 20 L 13 24" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"></path><rect x="18" y="23" width="9" height="2.6" rx="1.3" fill="#F03506"></rect><circle cx="9" cy="12" r="1.3" fill="#FF8769"></circle><circle cx="13" cy="12" r="1.3" fill="#FFE5DA"></circle></svg>';
  }
  function balIcon() {
    return '<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="15" cy="21" r="11" fill="#F03506"></circle><rect x="17" y="11" width="17" height="17" rx="4" fill="#1C1C1E"></rect><circle cx="20.5" cy="21" r="2.4" fill="#FFFFFF"></circle></svg>';
  }
  function desIcon() {
    return '<svg width="40" height="40" viewBox="0 0 40 40"><path d="M 20 5 L 28.5 20 L 20 27.5 L 11.5 20 Z" fill="#1C1C1E"></path><circle cx="20" cy="20" r="2.6" fill="#FFFFFF"></circle><path d="M 6 34 C 14 26 26 31 34 22" stroke="#F03506" stroke-width="3" stroke-linecap="round" fill="none"></path></svg>';
  }
  function emptyIllustration() {
    return '<svg width="128" height="112" viewBox="0 0 128 112"><circle cx="64" cy="52" r="46" fill="none" stroke="#FFB199" stroke-width="2" stroke-dasharray="3 7" stroke-linecap="round"></circle><rect x="38" y="34" width="52" height="33" rx="4" fill="#E1E1E3"></rect><rect x="42" y="38" width="44" height="25" rx="2" fill="#FFFFFF"></rect><path d="M 30 70 L 98 70 L 93 79 C 92.3 80.3 91 81 89.5 81 L 38.5 81 C 37 81 35.7 80.3 35 79 Z" fill="#C7C7CC"></path><circle cx="82" cy="60" r="17" fill="#FFE5DA"></circle><circle cx="82" cy="60" r="17" fill="none" stroke="#F03506" stroke-width="3.5"></circle><rect x="93.2" y="72.4" width="16" height="5" rx="2.5" fill="#F03506" transform="rotate(45 93.2 72.4)"></rect></svg>';
  }
  function laptopIconLarge(lid) {
    return '<svg width="66" height="47" viewBox="0 0 64 46"><rect x="10" y="2" width="44" height="29" rx="3" fill="' + lid + '"></rect><rect x="14" y="6" width="36" height="21" rx="1.5" fill="#FFFFFF"></rect><rect x="18" y="10" width="14" height="4" rx="2" fill="#FFB199"></rect><rect x="18" y="17" width="22" height="4" rx="2" fill="#FFE5DA"></rect><path d="M 4 33 L 60 33 L 56 40 C 55.4 41.2 54.2 42 52.8 42 L 11.2 42 C 9.8 42 8.6 41.2 8 40 Z" fill="#E1E1E3"></path><rect x="25" y="33" width="14" height="3" rx="1.5" fill="#C7C7CC"></rect></svg>';
  }
  function laptopIconSmall(lid) {
    return '<svg width="32" height="23" viewBox="0 0 64 46"><rect x="10" y="2" width="44" height="29" rx="3" fill="' + lid + '"></rect><rect x="14" y="6" width="36" height="21" rx="1.5" fill="#FFFFFF"></rect><path d="M 4 33 L 60 33 L 56 40 C 55.4 41.2 54.2 42 52.8 42 L 11.2 42 C 9.8 42 8.6 41.2 8 40 Z" fill="#E1E1E3"></path></svg>';
  }
  // Photo sits on top of the illustration. If it 404s or gets hotlink blocked it
  // removes itself and the illustration underneath shows instead.
  function photoLayer(l, alt) {
    if (!l.img) return '';
    return '<img class="laptop-photo" src="' + escAttr(l.img) + '" alt="' + escAttr(alt ? l.brand + ' ' + l.model : '') + '" onerror="this.remove()">';
  }
  function laptopThumbLarge(l) {
    return '<div class="laptop-thumb">' + laptopIconLarge(l.lid) + photoLayer(l, true) + '</div>';
  }
  function laptopThumbSmall(l) {
    return '<div class="cart-summary-thumb">' + laptopIconSmall(l.lid) + photoLayer(l, false) + '</div>';
  }
  function checkPlainIcon() {
    return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M 2 6.5 L 4.8 9.2 L 10 3.4" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  }
  function checkCircleIcon() {
    return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5.4" fill="#34C759"></circle><path d="M 3.4 6.2 L 5.2 8 L 8.6 4.4" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  }
  function dotsMarkup() {
    return '<span class="auto-dots"><i></i><i></i><i></i></span>';
  }
  function plusIcon() {
    return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2.5 L7 11.5 M2.5 7 L11.5 7" stroke="#F03506" stroke-width="2" stroke-linecap="round"></path></svg>';
  }
  function arrowRightIcon() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 5.5 L15.5 12 L9 18.5" stroke="#72777B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  }
  function lockIcon() {
    return '<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><rect x="2.5" y="5" width="7" height="5" rx="1.2" stroke="#A3A3A3" stroke-width="1.4"></rect><path d="M 4 5 L 4 3.6 C 4 2.5 4.9 1.6 6 1.6 C 7.1 1.6 8 2.5 8 3.6 L 8 5" stroke="#A3A3A3" stroke-width="1.4" fill="none"></path></svg>';
  }
  function doneHeroSvg() {
    return '<svg width="104" height="104" viewBox="0 0 104 104"><circle cx="52" cy="52" r="50" fill="#FFE5DA"></circle><circle cx="52" cy="52" r="36" fill="none" stroke="#FFB199" stroke-width="2" stroke-dasharray="3 7" stroke-linecap="round"></circle><circle cx="52" cy="52" r="24" fill="#F03506"></circle><path d="M 42 52.5 L 49 59.5 L 62.5 45.5" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"></path><circle cx="90" cy="26" r="5" fill="#C78922"></circle><rect x="10" y="72" width="10" height="10" rx="3" fill="#0EC5FF" transform="rotate(14 15 77)"></rect></svg>';
  }
  function whatsappIcon() {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="#FFFFFF"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm0 18.03c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.26 8.26 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 4.54 0 8.24 3.7 8.24 8.24 0 4.55-3.7 8.24-8.24 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z"></path></svg>';
  }

  // ---------- screen renderers ----------
  function headerMarkup() {
    var si = STEPS.indexOf(state.screen);
    if (si < 0) return '';
    var pct = Math.round(((si + 1) / 6) * 100);
    return '' +
      '<div class="header">' +
        '<button aria-label="Back" class="back-btn" data-action="go-back">' + backIcon() + '</button>' +
        '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="step-label">' + (si + 1) + ' / 6</span>' +
      '</div>';
  }

  function landingScreen() {
    return '' +
      '<div class="screen screen-fixed">' +
        '<div class="landing-top">' + logoIcon() + '<span class="landing-logo-text">Picapool</span></div>' +
        '<div class="landing-mid">' +
          landingHeroSvg() +
          '<h1 class="landing-title">Buy together, pay less</h1>' +
          '<p class="landing-sub">Join your campus pool. Every fresher who joins drops the price on the same laptop. Same model, same warranty.</p>' +
          '<div class="live-chip-row"><div class="live-chip"><span class="live-dot"></span><span class="live-text">214 freshers pooling right now</span></div></div>' +
        '</div>' +
        '<div class="landing-footer"><button class="btn-primary" data-action="go-start">Find my laptop</button></div>' +
      '</div>';
  }

  function purposeScreen() {
    function card(key, icon, title, desc) {
      var sel = state.purpose === key;
      return '' +
        '<button class="option-card' + (sel ? ' is-selected' : '') + '" data-action="pick-purpose" data-purpose="' + key + '">' +
          icon +
          '<span class="option-title">' + title + '</span>' +
          '<span class="option-desc">' + desc + '</span>' +
        '</button>';
    }
    return '' +
      '<div class="screen screen-scroll">' +
        '<div class="page-head"><h1 class="page-title">What will you mainly use it for?</h1></div>' +
        '<div class="purpose-grid">' +
          card('game', gameIcon(), 'Gaming', 'High fps, heavy titles') +
          card('code', codeIcon(), 'Heavy coding and dev', 'Compilers, VMs, long builds') +
          card('bal', balIcon(), 'Balanced everyday use', 'Classes, notes, streaming') +
          card('des', desIcon(), 'Design and editing', 'Photo, video, 3D work') +
        '</div>' +
      '</div>';
  }

  function budgetScreen() {
    var rows = BANDS.map(function (label, i) {
      var sel = state.budget === i;
      return '' +
        '<button class="radio-row' + (sel ? ' is-selected' : '') + '" data-action="pick-budget" data-budget="' + i + '">' +
          '<span class="radio-dot"><span class="radio-dot-fill"></span></span>' +
          '<span class="radio-label">' + label + '</span>' +
          '<span class="radio-hint">' + (i === 1 ? 'Most picked' : '') + '</span>' +
        '</button>';
    }).join('');
    return '' +
      '<div class="screen screen-scroll">' +
        '<div class="page-head"><h1 class="page-title">What is your budget?</h1></div>' +
        '<div class="radio-list">' + rows + '</div>' +
      '</div>';
  }

  // Optional escape hatch from the shortlist. Somebody who already knows the
  // exact model, or wants a brand we do not stock, can say so in their own words
  // and still count towards the pool.
  function customAskMarkup() {
    var typed = state.custom.trim().length > 0;
    return '' +
      '<div class="custom-ask' + (typed ? ' is-filled' : '') + '">' +
        '<span class="custom-ask-title">Want a specific model or brand?</span>' +
        '<span class="custom-ask-sub">Optional. Name it even if it is not listed here and we will count it in.</span>' +
        '<input type="text" id="field-custom" data-field="custom" class="text-input" maxlength="80" ' +
          'placeholder="e.g. Lenovo LOQ RTX 4050, or just Dell" value="' + escAttr(state.custom) + '">' +
        (typed ? '<span class="field-ok">' + checkCircleIcon() + 'Added to your request</span>' : '') +
      '</div>';
  }

  function picksScreen() {
    var loading = state.loading;
    var list = (state.purpose != null && state.budget != null) ? matches(state.purpose, state.budget) : [];
    var empty = !loading && list.length === 0;
    var ready = !loading && list.length > 0;
    var bandIdx = state.budget != null ? state.budget : 0;
    var purposeLabel = PSHORT[state.purpose] || 'everyday use';
    var purposeTitleCase = purposeLabel === 'everyday use' ? 'Everyday' : purposeLabel[0].toUpperCase() + purposeLabel.slice(1);
    var title = loading ? 'Matching laptops…'
      : empty ? 'Slim pickings'
      : (state.bumped ? 'Stretched ' : '') + purposeTitleCase + ' picks ' + BANDP[bandIdx];

    var body = '';
    if (loading) {
      body = '<div class="shimmer-list"><div class="shimmer-card"></div><div class="shimmer-card"></div><div class="shimmer-card"></div></div>';
    } else if (empty) {
      var nextBand = nextBandWith(state.purpose, state.budget);
      body = '' +
        '<div class="empty-state">' +
          emptyIllustration() +
          '<h2 class="empty-title">No solid ' + PSHORT[state.purpose || 'bal'] + ' picks ' + BANDP[bandIdx] + '</h2>' +
          '<p class="empty-sub">Stretch the budget one band up, or skip and we text you matched picks.</p>' +
          '<button class="btn-primary small" data-action="bump-band" data-band="' + nextBand + '">Show ' + BANDS[nextBand] + ' picks instead</button>' +
          (state.fromDone
            ? '<button class="btn-secondary" data-action="back-to-pool">Back to my pool</button>'
            : '<button class="btn-secondary" data-action="not-sure">Skip, text me picks later</button>') +
        '</div>' +
        '<div class="custom-ask-wrap">' + customAskMarkup() + '</div>';
    } else if (ready) {
      var cards = list.map(function (l) {
        var on = !!state.cart[l.id];
        return '' +
          '<div class="laptop-card' + (on ? ' is-added' : '') + '">' +
            laptopThumbLarge(l) +
            '<div class="laptop-body">' +
              '<div><div class="laptop-brand">' + l.brand + '</div><div class="laptop-model">' + l.model + '</div></div>' +
              '<div class="laptop-specs"><span class="spec-pill">' + l.c[0] + '</span><span class="spec-pill">' + l.c[1] + '</span><span class="spec-pill">' + l.c[2] + '</span></div>' +
              '<div class="laptop-why">' + l.why + '</div>' +
              '<div class="laptop-foot">' +
                (on
                  ? '<button class="btn-added" data-action="toggle-cart" data-id="' + l.id + '">' + checkPlainIcon() + 'Interested</button>'
                  : '<button class="btn-add" data-action="toggle-cart" data-id="' + l.id + '">I\'m interested</button>') +
              '</div>' +
            '</div>' +
          '</div>';
      }).join('');
      body = '' +
        '<div class="picks-list">' +
          cards +
          customAskMarkup() +
          (state.fromDone ? '' : '<button class="not-sure-row" data-action="not-sure">Not sure yet, show me options later' + arrowRightIcon() + '</button>') +
        '</div>';
    }

    var cartIds = Object.keys(state.cart).filter(function (k) { return state.cart[k]; });
    var hasCustom = state.custom.trim().length > 0;
    var footer = '';
    if (ready) {
      footer = '' +
        '<div class="cart-bar">' +
          '<span class="cart-count">' +
            '<span class="cart-badge' + (cartIds.length ? ' has-items' : '') + '">' + cartIds.length + '</span>' +
            (hasCustom ? 'shortlisted, plus yours' : 'shortlisted') +
          '</span>' +
          (state.fromDone
            ? '<button class="btn-primary" data-action="back-to-pool">Save to my pool</button>'
            : '<button class="btn-primary' + (cartIds.length || hasCustom ? '' : ' is-disabled') + '" data-action="go-timeline">Continue</button>') +
        '</div>';
    } else if (empty && hasCustom && !state.fromDone) {
      // Nothing matched, but they named a model themselves. That is enough to
      // carry on, otherwise the empty screen swallows what they just typed.
      footer = '<div class="footer-bar"><button class="btn-primary" data-action="go-timeline">Continue</button></div>';
    }

    return '' +
      '<div class="screen screen-fixed">' +
        '<div class="screen-inner-scroll">' +
          '<div class="page-head">' +
            '<h1 class="page-title">' + title + '</h1>' +
            (ready ? '<p class="picks-hint">Mark the ones you would actually buy. Pick as many as you like.</p><p class="price-note">We negotiate the price once we know how many of us want the same model.</p>' : '') +
          '</div>' +
          body +
        '</div>' +
        footer +
      '</div>';
  }

  function timelineScreen() {
    var weeks = buildWeeks();
    var cards = weeks.map(function (w) {
      var sel = state.week === w.i;
      return '' +
        '<button class="week-card' + (sel ? ' is-selected' : '') + '" data-action="pick-week" data-week="' + w.i + '">' +
          '<span class="week-range">' + weekRange(w) + '</span>' +
          '<span class="week-rel">' + weekRelative(w.i) + '</span>' +
        '</button>';
    }).join('');

    var unsure = state.week === 'unsure';
    var hasWhen = state.week !== null;
    var note = unsure ? 'No rush. We keep you posted as pools fill up.'
      : typeof state.week === 'number' ? 'Buying around ' + weekRange(weeks[state.week]) + '. We match you with freshers buying in that same week.'
      : 'A rough week is enough. You can change it anytime.';

    return '' +
      '<div class="screen screen-fixed">' +
        '<div class="screen-inner-scroll">' +
          '<div class="page-head">' +
            '<h1 class="page-title">Which week are you buying in?</h1>' +
            '<p class="page-sub">Pick the window that feels closest. Nothing is locked in.</p>' +
          '</div>' +
          '<div class="week-grid">' + cards + '</div>' +
          '<button class="week-unsure' + (unsure ? ' is-selected' : '') + '" data-action="pick-week" data-week="unsure">Not sure yet</button>' +
          '<p class="date-note">' + note + '</p>' +
        '</div>' +
        '<div class="footer-bar"><button class="btn-primary' + (hasWhen ? '' : ' is-disabled') + '" data-action="go-intent">Continue</button></div>' +
      '</div>';
  }

  function intentScreen() {
    var rows = INTENTS.map(function (r) {
      var sel = state.intent === r.key;
      return '' +
        '<button class="radio-row tall' + (sel ? ' is-selected' : '') + '" data-action="pick-intent" data-intent="' + r.key + '">' +
          '<span class="radio-dot"><span class="radio-dot-fill"></span></span>' +
          '<span class="radio-text-col"><span class="radio-title-lg">' + r.title + '</span><span class="radio-desc">' + r.desc + '</span></span>' +
        '</button>';
    }).join('');
    return '' +
      '<div class="screen screen-scroll">' +
        '<div class="page-head"><h1 class="page-title">How ready are you?</h1></div>' +
        '<div class="radio-list">' + rows + '</div>' +
      '</div>';
  }

  function contactScreen() {
    var nameOk = state.name.trim().length > 0;
    var phoneOk = /^\d{10}$/.test(state.phone);
    var nameErr = state.tried && !nameOk;
    var phoneErr = state.tried && !phoneOk;
    var autoOn = nameOk && phoneOk;

    return '' +
      '<div class="screen screen-fixed">' +
        '<div class="screen-inner-scroll">' +
          '<div class="page-head">' +
            '<h1 class="page-title">Where should we send your pool price?</h1>' +
            '<p class="page-sub">We text you the moment your pool unlocks a lower price. That is the only reason we ask.</p>' +
          '</div>' +
          '<div class="field-list">' +
            '<label class="field-label">' +
              '<span class="field-label-text">Your name</span>' +
              '<input type="text" autocomplete="name" placeholder="First name is fine" id="field-name" data-field="name" class="text-input' + (nameErr ? ' has-error' : '') + '" value="' + escAttr(state.name) + '">' +
              (nameErr ? '<span class="field-error">We need a name to hold your seat</span>' : '') +
            '</label>' +
            '<div class="phone-field">' +
              '<span class="field-label-text">Mobile number</span>' +
              '<div class="phone-row">' +
                '<span class="phone-prefix">+91' + lockIcon() + '</span>' +
                '<input type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="10 digit mobile number" id="field-phone" data-field="phone" class="phone-input' + (phoneErr ? ' has-error' : '') + '" value="' + escAttr(state.phone) + '">' +
              '</div>' +
              (phoneErr ? '<span class="field-error">Enter the 10 digit number after +91</span>' : '') +
              (phoneOk ? '<span class="field-ok">' + checkCircleIcon() + 'Looks good</span>' : '') +
            '</div>' +
            (autoOn ? ('' +
              '<div class="auto-box">' +
                '<span class="auto-title">Saving your number' + dotsMarkup() + '</span>' +
                '<span class="auto-note">Nothing else to do. Keep typing if you need to fix it.</span>' +
                '<div class="auto-track"><div class="auto-fill"></div></div>' +
              '</div>') : '') +
          '</div>' +
        '</div>' +
        '<div class="contact-footer">' +
          '<button class="btn-primary" data-action="join-pool">' + (autoOn ? 'Join now' : 'Join the pool') + '</button>' +
          '<p class="contact-footnote">Pool updates only. No spam, no sales calls, and we never share your number.</p>' +
        '</div>' +
      '</div>';
  }

  function doneScreen() {
    var cartItems = cartLaptops();
    var custom = state.custom.trim();
    var phoneOk = /^\d{10}$/.test(state.phone);
    var maskedPhone = phoneOk ? '+91 ' + state.phone.slice(0, 2) + '••••••' + state.phone.slice(8) : 'you';
    var waMsg = 'Freshers laptop pool on Picapool. The price drops as more of us join. Join pool ' + POOL_ID;
    var waHref = 'https://wa.me/?text=' + encodeURIComponent(waMsg);

    var cartSection;
    if (cartItems.length > 0) {
      var rows = cartItems.map(function (l) {
        return '' +
          '<div class="cart-summary-row">' +
            laptopThumbSmall(l) +
            '<div class="cart-summary-body"><div class="cart-summary-name">' + l.brand + ' ' + l.model + '</div><div class="cart-summary-spec">' + l.c.join(', ') + '</div></div>' +
          '</div>';
      }).join('');
      cartSection = '' +
        '<div class="cart-summary">' +
          '<div class="cart-summary-head"><span class="cart-summary-title">Your laptops</span><button class="edit-link" data-action="edit-picks">Edit</button></div>' +
          rows +
          '<div class="quote-row">We take these numbers to sellers and text you what they come back with.</div>' +
        '</div>';
    } else if (custom) {
      cartSection = '' +
        '<div class="no-cart-card">' +
          '<span class="no-cart-title">Nothing off the shortlist yet</span>' +
          '<span class="no-cart-sub">We are counting your own request below. Add a listed model too if you want both quoted.</span>' +
          '<button class="browse-link" data-action="edit-picks">Browse picks now</button>' +
        '</div>';
    } else {
      cartSection = '' +
        '<div class="no-cart-card">' +
          '<span class="no-cart-title">No laptops locked yet</span>' +
          '<span class="no-cart-sub">We will text you three matched picks ' + BANDP[state.budget != null ? state.budget : 1] + ' for ' + PSHORT[state.purpose || 'bal'] + '.</span>' +
          '<button class="browse-link" data-action="edit-picks">Browse picks now</button>' +
        '</div>';
    }

    var customSection = custom ? ('' +
      '<div class="custom-summary">' +
        '<div class="custom-summary-head">' +
          '<span class="custom-summary-label">Asked for by name</span>' +
          '<button class="edit-link" data-action="edit-picks">Edit</button>' +
        '</div>' +
        '<div class="custom-summary-value">' + escAttr(custom) + '</div>' +
        '<div class="custom-summary-note">We check the price on this one and quote it back to you.</div>' +
      '</div>') : '';

    return '' +
      '<div class="screen screen-fixed">' +
        '<div class="screen-inner-scroll">' +
          '<div class="done-hero">' +
            doneHeroSvg() +
            '<h1 class="done-title">You are in the pool</h1>' +
            '<p class="done-sub">We text ' + maskedPhone + ' with pricing updates as the pool fills.</p>' +
          '</div>' +
          cartSection +
          customSection +
          (cartItems.length > 0
            ? '<button class="add-more-btn" data-action="edit-picks">' + plusIcon() + 'Show interest in more laptops</button>'
            : '') +
          '<p class="done-footnote">More freshers joining means a lower price.</p>' +
        '</div>' +
        '<div class="done-footer">' +
          '<a href="' + escAttr(waHref) + '" target="_blank" rel="noopener" class="btn-whatsapp">' + whatsappIcon() + 'Invite friends, drop the price</a>' +
          '<button class="btn-start-over" data-action="restart">Start over</button>' +
        '</div>' +
      '</div>';
  }

  function screenMarkup() {
    switch (state.screen) {
      case 'landing': return landingScreen();
      case 'purpose': return purposeScreen();
      case 'budget': return budgetScreen();
      case 'picks': return picksScreen();
      case 'timeline': return timelineScreen();
      case 'intent': return intentScreen();
      case 'contact': return contactScreen();
      case 'done': return doneScreen();
      default: return '';
    }
  }

  // ---------- render + focus preservation ----------
  var phoneEl = document.getElementById('phone');

  function render() {
    var active = document.activeElement;
    var focusId = null, selStart = null, selEnd = null;
    if (active && active.id && phoneEl.contains(active)) {
      focusId = active.id;
      if (typeof active.selectionStart === 'number') { selStart = active.selectionStart; selEnd = active.selectionEnd; }
    }
    var restoreId = focusId;
    var caretEnd = forceCaretEnd;
    forceCaretEnd = false;

    phoneEl.innerHTML = headerMarkup() + screenMarkup();

    if (restoreId) {
      var el = document.getElementById(restoreId);
      if (el && typeof el.focus === 'function') {
        el.focus();
        if (typeof el.setSelectionRange === 'function') {
          var len = el.value.length;
          try {
            if (caretEnd) { el.setSelectionRange(len, len); }
            else if (selStart != null && restoreId === focusId) { el.setSelectionRange(Math.min(selStart, len), Math.min(selEnd, len)); }
          } catch (e) { /* not all input types support selection */ }
        }
      }
    }
  }

  // ---------- events ----------
  function onClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    switch (action) {
      case 'go-back': {
        clearAutoJoin();
        var i = ORDER.indexOf(state.screen);
        go(ORDER[Math.max(0, i - 1)]);
        break;
      }
      case 'go-start':
        go('purpose');
        break;
      case 'pick-purpose':
        setState({ purpose: btn.dataset.purpose });
        go('budget', 240);
        break;
      case 'pick-budget':
        setState(function (st) { return { budget: +btn.dataset.budget, bumped: false, cart: st.fromDone ? st.cart : {} }; });
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(function () { enterPicks(); }, 240);
        break;
      case 'toggle-cart': {
        var id = btn.dataset.id;
        setState(function (st) { return { cart: Object.assign({}, st.cart, (function () { var o = {}; o[id] = !st.cart[id]; return o; })()) }; });
        break;
      }
      case 'not-sure':
        setState({ cart: {}, custom: '' });
        go('timeline');
        break;
      case 'bump-band':
        setState({ budget: +btn.dataset.band, bumped: true });
        enterPicks();
        break;
      case 'go-timeline': {
        var cartIds = Object.keys(state.cart).filter(function (k) { return state.cart[k]; });
        if (!cartIds.length && !state.custom.trim()) return;
        go('timeline');
        break;
      }
      case 'pick-week': {
        var w = btn.dataset.week;
        setState({ week: w === 'unsure' ? 'unsure' : +w });
        break;
      }
      case 'go-intent': {
        if (state.week === null) return;
        go('intent');
        break;
      }
      case 'pick-intent':
        setState({ intent: btn.dataset.intent });
        go('contact', 240);
        break;
      case 'join-pool': {
        clearAutoJoin();
        if (contactReady(state)) enterDone(); else setState({ tried: true });
        break;
      }
      case 'edit-picks':
        enterPicks({ fromDone: true });
        break;
      case 'back-to-pool':
        enterDone();
        break;
      case 'restart':
        restart();
        break;
    }
  }

  function onInput(e) {
    var field = e.target.dataset.field;
    if (!field) return;
    if (field === 'custom') {
      setState({ custom: e.target.value });
      return;
    }
    if (field === 'name') {
      setState({ name: e.target.value });
    } else if (field === 'phone') {
      var digits = e.target.value.replace(/\D/g, '').slice(0, 10);
      forceCaretEnd = true;
      // A complete number with no name would otherwise sit there waiting forever.
      if (digits.length === 10 && !state.name.trim()) setState({ phone: digits, tried: true });
      else setState({ phone: digits });
    }
    scheduleAutoJoin();
  }

  phoneEl.addEventListener('click', onClick);
  phoneEl.addEventListener('input', onInput);

  flushQueue();
  pingTap();
  render();
})();
