(function () {
  'use strict';

  // ---------- pool math (hardcoded defaults, mirrors design defaults) ----------
  var DISC = 8; // % discount
  var POOL_ID = 'AUG-LPT-07';

  var BANDS = ['Under ₹50k', '₹50k–70k', '₹70k–90k', 'Above ₹90k'];
  var BANDP = ['under ₹50k', 'in ₹50k–70k', 'in ₹70k–90k', 'above ₹90k'];
  var PSHORT = { game: 'gaming', code: 'coding', bal: 'everyday use', des: 'design work' };

  var K = '#1C1C1E', G = '#3A3A3C';
  var CATALOG = {
    game: [
      { id: 'g1', band: 1, brand: 'HP', model: 'Victus 15', c: ['RTX 2050', '16GB RAM', '512GB SSD'], why: 'Cheapest real GPU. Valorant at 144 fps.', price: 61490, lid: K },
      { id: 'g2', band: 2, brand: 'Lenovo', model: 'LOQ 15', c: ['RTX 4050', '16GB RAM', '144Hz'], why: 'Best fps per rupee right now.', price: 79990, lid: G },
      { id: 'g3', band: 2, brand: 'ASUS', model: 'TUF Gaming F15', c: ['RTX 4050', '16GB RAM', 'MUX switch'], why: 'Tank build, survives hostel life.', price: 83990, lid: K },
      { id: 'g4', band: 3, brand: 'Acer', model: 'Nitro V16', c: ['RTX 4060', '16GB RAM', '165Hz'], why: 'Desktop-class 1080p gaming.', price: 102990, lid: G },
    ],
    code: [
      { id: 'c1', band: 0, brand: 'Lenovo', model: 'IdeaPad Slim 3', c: ['Ryzen 5 7530U', '16GB RAM', '512GB SSD'], why: 'Handles VS Code, light Docker.', price: 46990, lid: G },
      { id: 'c2', band: 1, brand: 'ASUS', model: 'Vivobook 15', c: ['i5-13500H', '16GB RAM', '512GB SSD'], why: 'H-series chip, fast compiles.', price: 57990, lid: K },
      { id: 'c3', band: 1, brand: 'HP', model: 'Pavilion 14', c: ['Ryzen 7 7730U', '16GB RAM', 'Backlit KB'], why: 'Quiet, great keyboard for long code.', price: 64990, lid: G },
      { id: 'c4', band: 2, brand: 'Apple', model: 'MacBook Air M2', c: ['M2', '16GB RAM', '18h battery'], why: 'Silent, Unix shell, campus favourite.', price: 78990, lid: K },
      { id: 'c5', band: 3, brand: 'Apple', model: 'MacBook Air M3', c: ['M3', '16GB RAM', '512GB SSD'], why: 'Flies through big builds.', price: 108990, lid: G },
    ],
    bal: [
      { id: 'b1', band: 0, brand: 'Acer', model: 'Aspire Lite', c: ['Ryzen 5', '16GB RAM', '512GB SSD'], why: 'Everything a fresher needs, nothing extra.', price: 37990, lid: G },
      { id: 'b2', band: 0, brand: 'HP', model: '15s', c: ['i5-1235U', '16GB RAM', 'FHD'], why: 'Safe, serviceable everywhere.', price: 44990, lid: K },
      { id: 'b3', band: 1, brand: 'ASUS', model: 'Vivobook 16', c: ['Ryzen 7', '16GB RAM', '16in screen'], why: 'Big screen, still light.', price: 55990, lid: G },
      { id: 'b4', band: 2, brand: 'Apple', model: 'MacBook Air M2', c: ['M2', '16GB RAM', '18h battery'], why: 'Lasts all four years.', price: 74990, lid: K },
    ],
    des: [
      { id: 'd1', band: 1, brand: 'Lenovo', model: 'IdeaPad Slim 5 OLED', c: ['OLED 2.8K', 'Ryzen 7', '16GB RAM'], why: '100% DCI-P3 colour on a budget.', price: 61990, lid: G },
      { id: 'd2', band: 2, brand: 'ASUS', model: 'Vivobook Pro 15 OLED', c: ['RTX 3050', 'OLED', '16GB RAM'], why: 'OLED plus CUDA for Premiere.', price: 82990, lid: K },
      { id: 'd3', band: 3, brand: 'Apple', model: 'MacBook Air M3', c: ['M3', '16GB RAM', 'P3 display'], why: 'Final Cut, colour-true screen.', price: 114990, lid: G },
      { id: 'd4', band: 3, brand: 'HP', model: 'Omen 16', c: ['RTX 4060', '16GB RAM', 'QHD 240Hz'], why: 'Heavy 3D and render rigs.', price: 119990, lid: K },
    ],
  };
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
  function poolPrice(n) { return Math.round(n * (1 - DISC / 100) / 10) * 10; }
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
    cart: {}, week: null, intent: null,
    name: '', phone: '', otp: ['', '', '', ''], tried: false,
  };
  var state = Object.assign({}, initialState);
  var pendingTimer = null;
  var pendingFocusId = null;
  var forceCaretEnd = false;

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
  function enterPicks() {
    clearTimeout(pendingTimer);
    setState({ screen: 'picks', loading: true });
    pendingTimer = setTimeout(function () { setState({ loading: false }); }, 900);
  }
  function restart() {
    setState(Object.assign({}, initialState, { cart: {}, otp: ['', '', '', ''] }));
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
  function checkPlainIcon() {
    return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M 2 6.5 L 4.8 9.2 L 10 3.4" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  }
  function checkCircleIcon() {
    return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5.4" fill="#34C759"></circle><path d="M 3.4 6.2 L 5.2 8 L 8.6 4.4" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
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
          '<button class="btn-secondary" data-action="not-sure">Skip, text me picks later</button>' +
        '</div>';
    } else if (ready) {
      var cards = list.map(function (l) {
        var on = !!state.cart[l.id];
        return '' +
          '<div class="laptop-card' + (on ? ' is-added' : '') + '">' +
            '<div class="laptop-thumb">' + laptopIconLarge(l.lid) + '</div>' +
            '<div class="laptop-body">' +
              '<div><div class="laptop-brand">' + l.brand + '</div><div class="laptop-model">' + l.model + '</div></div>' +
              '<div class="laptop-specs"><span class="spec-pill">' + l.c[0] + '</span><span class="spec-pill">' + l.c[1] + '</span><span class="spec-pill">' + l.c[2] + '</span></div>' +
              '<div class="laptop-why">' + l.why + '</div>' +
              '<div class="laptop-foot">' +
                '<span class="laptop-price">' + fmt(l.price) + '</span>' +
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
          '<button class="not-sure-row" data-action="not-sure">Not sure yet, show me options later' + arrowRightIcon() + '</button>' +
        '</div>';
    }

    var cartIds = Object.keys(state.cart).filter(function (k) { return state.cart[k]; });
    var footer = ready ? ('' +
      '<div class="cart-bar">' +
        '<span class="cart-count"><span class="cart-badge' + (cartIds.length ? ' has-items' : '') + '">' + cartIds.length + '</span>shortlisted</span>' +
        '<button class="btn-primary' + (cartIds.length ? '' : ' is-disabled') + '" data-action="go-timeline">Continue</button>' +
      '</div>') : '';

    return '' +
      '<div class="screen screen-fixed">' +
        '<div class="screen-inner-scroll">' +
          '<div class="page-head">' +
            '<h1 class="page-title">' + title + '</h1>' +
            (ready ? '<p class="picks-hint">Mark the ones you would actually buy. Pick as many as you like.</p>' : '') +
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
    var otpDone = state.otp.every(function (v) { return v !== ''; });

    var otpBoxes = state.otp.map(function (v, i) {
      return '<input type="tel" inputmode="numeric" maxlength="1" class="otp-input' + (v ? ' is-filled' : '') + '" id="field-otp-' + i + '" data-i="' + i + '" data-field="otp" value="' + escAttr(v) + '">';
    }).join('');

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
            (phoneOk ? ('' +
              '<div class="otp-box">' +
                '<span class="otp-title">Verify now, or later. Your call.</span>' +
                '<span class="otp-note">Code sent to +91 ' + escAttr(state.phone) + '. You can skip this and verify when your pool fills.</span>' +
                '<div class="otp-inputs">' + otpBoxes + '</div>' +
                (otpDone ? '<span class="otp-verified">' + checkCircleIcon() + 'Number verified</span>' : '') +
              '</div>') : '') +
          '</div>' +
        '</div>' +
        '<div class="contact-footer">' +
          '<button class="btn-primary" data-action="join-pool">Join the pool</button>' +
          '<p class="contact-footnote">Pool updates only. No spam, no sales calls, and we never share your number.</p>' +
        '</div>' +
      '</div>';
  }

  function doneScreen() {
    var cartIds = Object.keys(state.cart).filter(function (k) { return state.cart[k]; });
    var cartItems = ALL_LAPTOPS.filter(function (l) { return cartIds.indexOf(l.id) !== -1; });
    var savingsN = cartItems.reduce(function (a, l) { return a + (l.price - poolPrice(l.price)); }, 0);
    var phoneOk = /^\d{10}$/.test(state.phone);
    var maskedPhone = phoneOk ? '+91 ' + state.phone.slice(0, 2) + '••••••' + state.phone.slice(8) : 'you';
    var waMsg = 'Freshers laptop pool on Picapool. The price drops as more of us join. Join pool ' + POOL_ID;
    var waHref = 'https://wa.me/?text=' + encodeURIComponent(waMsg);

    var cartSection;
    if (cartItems.length > 0) {
      var rows = cartItems.map(function (l) {
        return '' +
          '<div class="cart-summary-row">' +
            '<div class="cart-summary-thumb">' + laptopIconSmall(l.lid) + '</div>' +
            '<div class="cart-summary-body"><div class="cart-summary-name">' + l.brand + ' ' + l.model + '</div><div class="cart-summary-market"><s>' + fmt(l.price) + '</s> market</div></div>' +
            '<div class="cart-summary-price"><div class="cart-summary-pool">' + fmt(poolPrice(l.price)) + '</div><div class="cart-summary-pool-label">pool price</div></div>' +
          '</div>';
      }).join('');
      cartSection = '' +
        '<div class="cart-summary">' +
          '<div class="cart-summary-head"><span class="cart-summary-title">Your laptops</span><button class="edit-link" data-action="edit-picks">Edit</button></div>' +
          rows +
          '<div class="savings-row"><span class="savings-label">Projected saving when the pool fills</span><span class="savings-value">' + fmt(savingsN) + '</span></div>' +
        '</div>';
    } else {
      cartSection = '' +
        '<div class="no-cart-card">' +
          '<span class="no-cart-title">No laptops locked yet</span>' +
          '<span class="no-cart-sub">We will text you three matched picks ' + BANDP[state.budget != null ? state.budget : 1] + ' for ' + PSHORT[state.purpose || 'bal'] + '.</span>' +
          '<button class="browse-link" data-action="edit-picks">Browse picks now</button>' +
        '</div>';
    }

    return '' +
      '<div class="screen screen-fixed">' +
        '<div class="screen-inner-scroll">' +
          '<div class="done-hero">' +
            doneHeroSvg() +
            '<h1 class="done-title">You are in the pool</h1>' +
            '<p class="done-sub">We text ' + maskedPhone + ' when it fills.</p>' +
          '</div>' +
          cartSection +
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
    var restoreId = pendingFocusId || focusId;
    var caretEnd = forceCaretEnd;
    pendingFocusId = null;
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
        setState({ budget: +btn.dataset.budget, bumped: false, cart: {} });
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(enterPicks, 240);
        break;
      case 'toggle-cart': {
        var id = btn.dataset.id;
        setState(function (st) { return { cart: Object.assign({}, st.cart, (function () { var o = {}; o[id] = !st.cart[id]; return o; })()) }; });
        break;
      }
      case 'not-sure':
        setState({ cart: {} });
        go('timeline');
        break;
      case 'bump-band':
        setState({ budget: +btn.dataset.band, bumped: true });
        enterPicks();
        break;
      case 'go-timeline': {
        var cartIds = Object.keys(state.cart).filter(function (k) { return state.cart[k]; });
        if (!cartIds.length) return;
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
        var nameOk = state.name.trim().length > 0;
        var phoneOk = /^\d{10}$/.test(state.phone);
        if (nameOk && phoneOk) go('done'); else setState({ tried: true });
        break;
      }
      case 'edit-picks':
        enterPicks();
        break;
      case 'restart':
        restart();
        break;
    }
  }

  function onInput(e) {
    var field = e.target.dataset.field;
    if (!field) return;
    if (field === 'name') {
      setState({ name: e.target.value });
    } else if (field === 'phone') {
      var digits = e.target.value.replace(/\D/g, '').slice(0, 10);
      forceCaretEnd = true;
      setState({ phone: digits });
    } else if (field === 'otp') {
      var i = +e.target.dataset.i;
      var v = e.target.value.replace(/\D/g, '').slice(-1);
      var otp = state.otp.slice();
      otp[i] = v;
      if (v && i < 3) pendingFocusId = 'field-otp-' + (i + 1);
      setState({ otp: otp });
    }
  }

  function onKeydown(e) {
    if (e.target && e.target.dataset && e.target.dataset.field === 'otp' && e.key === 'Backspace' && !e.target.value) {
      var i = +e.target.dataset.i;
      if (i > 0) {
        var prev = document.getElementById('field-otp-' + (i - 1));
        if (prev) prev.focus();
      }
    }
  }

  phoneEl.addEventListener('click', onClick);
  phoneEl.addEventListener('input', onInput);
  phoneEl.addEventListener('keydown', onKeydown);

  render();
})();
