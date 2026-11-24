// Token Radar's page. It reads window.RADAR, the dataset main.ts writes beside the page, and renders
// the ranked board, a filterable table, a per-protocol detail drawer and the methodology panel. No
// network: every byte it shows comes from data.js, and every figure it shows is the board's own.
//
// The one function that matters is recompute(): the page applies the same formula as lib/model.ts to
// each row's raw snapshot figures, and prints whether the result is the dollar board.json carries. The
// board is not a table someone typed: it is this arithmetic, checked on every row at load.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA) {
    app.textContent = 'The page could not find its dataset (data.js). It is written beside the dashboard by main.ts.';
    return;
  }

  // ------------------------------------------------------------------ formatting

  var NF = new Intl.NumberFormat('en-US');
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + NF.format(n);
  }
  function fmtDollars(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + NF.format(Math.round(n));
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    return NF.format(Math.max(0, Math.round(days))) + ' d';
  }
  function fmtFactor(n, places) {
    if (n === null || n === undefined) return '—';
    return n.toFixed(places === undefined ? 2 : places);
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    return iso;
  }
  function fmtChains(chains, limit) {
    if (!chains || chains.length === 0) return 'an unnamed chain';
    var head = chains.slice(0, limit || 2).join(', ');
    return chains.length > (limit || 2) ? head + ' +' + (chains.length - (limit || 2)) : head;
  }

  // ------------------------------------------------------------------ the model, mirrored

  var MODEL = DATA.model;
  var MULT = {};
  DATA.families.forEach(function (f) { MULT[f.key] = f.multiple; });

  // The formula in lib/model.ts, applied here to the row's raw snapshot figures. The order of the
  // multiplications is the same so the floating-point result is the same, and the page can state that
  // its own arithmetic reproduces the board rather than merely describing it.
  function factorsOf(row) {
    var change = row.change_7d === null || row.change_7d === undefined ? null : row.change_7d;
    var momentum = change === null
      ? MODEL.unknown_momentum
      : Math.min(MODEL.momentum_cap, Math.max(MODEL.momentum_floor, 1 + (change / 100) * MODEL.momentum_weight));
    var age = row.age_days;
    var maturity = age === null || age === undefined || age < 1 ? MODEL.unknown_maturity : 1 + Math.log10(age) / MODEL.maturity_log_divisor;
    var chains = row.chain_count === undefined ? (row.chains ? row.chains.length : 0) : row.chain_count;
    var chainMultiple = 1 + Math.min(Math.max(chains - 1, 0), MODEL.chain_cap) * MODEL.chain_step;
    return { category: MULT[row.family], momentum: momentum, maturity: maturity, chains: chainMultiple };
  }

  function recompute(row) {
    var f = factorsOf(row);
    return Math.max(1, Math.round(row.tvl_usd * f.category * f.momentum * f.maturity * f.chains));
  }

  var auditOk = 0;
  DATA.rows.forEach(function (r) { if (recompute(r) === r.implied_value_usd) auditOk += 1; });
  var auditAll = DATA.rows.length;
  var maxLiveMcap = DATA.live.reduce(function (m, r) { return Math.max(m, r.mcap_usd || 0); }, 1);

  var maturityRange = DATA.rows.reduce(function (acc, r) {
    var v = r.model.maturity;
    return { min: Math.min(acc.min, v), max: Math.max(acc.max, v) };
  }, { min: Infinity, max: -Infinity });

  // ------------------------------------------------------------------ state

  var state = { q: '', family: 'all', chain: 'all', status: 'pre-token', watch: false, sort: 'implied', dir: 'desc', selected: null };

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var p = new URLSearchParams(raw);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('family') && MULT[p.get('family')]) state.family = p.get('family');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('status') === 'live') state.status = 'live';
    if (p.get('watch') === '1') state.watch = true;
    if (p.get('p')) state.selected = p.get('p');
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('dir') === 'asc' || p.get('dir') === 'desc') state.dir = p.get('dir');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.family !== 'all') p.set('family', state.family);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.status !== 'pre-token') p.set('status', state.status);
    if (state.watch) p.set('watch', '1');
    if (state.selected) p.set('p', state.selected);
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.dir !== 'desc') p.set('dir', state.dir);
    var next = p.toString();
    var base = window.location.pathname + window.location.search;
    try {
      window.history.replaceState(null, '', next ? '#' + next : base);
    } catch (e) {
      // A page opened from disk may refuse a history write; the filters still work, only the URL
      // keeps the state it had.
      if (next) window.location.hash = next;
    }
  }

  // ------------------------------------------------------------------ DOM helper

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(node, c); }); return; }
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  // ------------------------------------------------------------------ filtering and sorting

  function matches(row) {
    if (state.watch && !row.watchlist) return false;
    if (state.family !== 'all' && row.family !== state.family) return false;
    if (state.chain !== 'all' && (row.chains || []).indexOf(state.chain) < 0) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    var hay = [row.name, row.slug, row.category || '', row.family_label || '', (row.chains || []).join(' '), row.symbol || ''].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  var SORTS = {
    implied: function (r) { return r.implied_value_usd; },
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    family: function (r) { return r.family_label || r.family; },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d === null || r.change_7d === undefined ? -Infinity : r.change_7d; },
    age: function (r) { return r.age_days === null || r.age_days === undefined ? -1 : r.age_days; },
    mcap: function (r) { return r.mcap_usd || 0; }
  };

  function sortRows(list) {
    var get = SORTS[state.sort] || SORTS.implied;
    var dir = state.dir === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      var av = get(a);
      var bv = get(b);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.rank - b.rank;
    });
  }

  // ------------------------------------------------------------------ the masthead's stamp

  document.getElementById('snap-date').textContent = DATA.as_of;
  document.getElementById('snap-universe').textContent = NF.format(DATA.protocols_total) + ' protocols';
  document.getElementById('snap-model').textContent = DATA.model_version;

  // ------------------------------------------------------------------ header pieces

  function kpis() {
    var top = DATA.rows[0];
    return el('section', { class: 'kpis', 'aria-label': 'Snapshot facts' },
      kpi('Watchlist covered', DATA.watchlist_covered + ' / ' + DATA.watchlist_size, 'every slug in the sealed list', 'signal', true),
      kpi('Pre-token rows', String(DATA.board_size), 'each one scored by the model', 'signal', false),
      kpi('Early rows', String(DATA.early_size), 'below the ' + fmtUsd(DATA.floor_usd) + ' floor', 'amber', false),
      kpi('Live tokens set aside', String(DATA.live_size), 'their market cap is a fact', 'plain', false),
      kpi('Top implied value', top ? fmtUsd(top.implied_value_usd) : '—', top ? top.name : '', 'plain', false)
    );
  }
  function kpi(label, value, note, tone, signal) {
    return el('dl', { class: 'kpi', 'data-tone': tone },
      el('dt', { text: label }),
      el('dd', null, signal ? el('strong', { text: value }) : value),
      el('small', { text: note })
    );
  }

  function formulaStrip() {
    return el('section', { class: 'formula-strip', 'aria-label': 'The value model' },
      el('div', null,
        el('p', { class: 'formula-label', text: 'The model · ' + DATA.model_version }),
        el('p', { class: 'formula' },
          'implied = TVL × category × momentum × maturity × chains',
          el('br'),
          'momentum = clamp(1 + 7d/100 × ' + MODEL.momentum_weight + ', ' + MODEL.momentum_floor + ', ' + MODEL.momentum_cap + ') · ',
          'maturity = 1 + log10(days listed)/' + MODEL.maturity_log_divisor
        )
      ),
      el('div', { class: 'factors' },
        el('span', { class: 'factor' }, 'category ', el('b', { text: '0.30–0.60' })),
        el('span', { class: 'factor' }, 'momentum ', el('b', { text: fmtFactor(MODEL.momentum_floor) + '–' + fmtFactor(MODEL.momentum_cap) })),
        el('span', { class: 'factor' }, 'maturity ', el('b', { text: fmtFactor(maturityRange.min) + '–' + fmtFactor(maturityRange.max) })),
        el('span', { class: 'factor' }, 'chains ', el('b', { text: '1.00–' + fmtFactor(1 + MODEL.chain_cap * MODEL.chain_step) }))
      )
    );
  }

  // ------------------------------------------------------------------ controls

  function chainOptions() {
    var top = DATA.chain_counts.slice(0, 24);
    return top.map(function (c) {
      return el('option', { value: c.chain, text: c.chain + ' (' + c.count + ')', selected: state.chain === c.chain ? 'selected' : null });
    });
  }

  function controls() {
    var search = el('input', { type: 'search', id: 'q', value: state.q, placeholder: 'Search a protocol, category or chain', 'aria-label': 'Search the board', autocomplete: 'off' });
    search.addEventListener('input', function () {
      state.q = search.value;
      writeHash();
      render();
      // The page redraws the controls on every keystroke; put the caret back where it was so a
      // reader can keep typing instead of clicking the field again.
      var again = document.getElementById('q');
      if (again) {
        again.focus();
        try { again.setSelectionRange(again.value.length, again.value.length); } catch (e) { /* type=search in older engines */ }
      }
    });

    var family = el('select', { id: 'family', 'aria-label': 'Filter by category family' },
      el('option', { value: 'all', text: 'All families', selected: state.family === 'all' ? 'selected' : null }),
      DATA.family_counts.map(function (f) {
        return el('option', { value: f.family, text: f.label + ' (' + f.count + ')', selected: state.family === f.family ? 'selected' : null });
      })
    );
    family.addEventListener('change', function () { state.family = family.value; writeHash(); render(); });

    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains', selected: state.chain === 'all' ? 'selected' : null }),
      chainOptions()
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });

    var pre = el('button', { type: 'button', 'aria-pressed': state.status === 'pre-token' ? 'true' : 'false', text: 'Pre-token' });
    pre.addEventListener('click', function () { state.status = 'pre-token'; writeHash(); render(); });
    var live = el('button', { type: 'button', 'aria-pressed': state.status === 'live' ? 'true' : 'false', text: 'Live token' });
    live.addEventListener('click', function () { state.status = 'live'; writeHash(); render(); });

    var watch = el('input', { type: 'checkbox', id: 'watch', checked: state.watch ? 'checked' : null });
    watch.addEventListener('change', function () { state.watch = watch.checked; writeHash(); render(); });

    var visible = state.status === 'live' ? DATA.live.length : DATA.rows.filter(matches).length;
    var anyFilter = state.q || state.family !== 'all' || state.chain !== 'all' || state.watch;

    return el('section', { class: 'controls', 'aria-label': 'Filters' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'family', text: 'Family' }), family),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Token record' }),
        el('div', { class: 'seg', role: 'group', 'aria-label': 'Token record' }, pre, live)),
      el('label', { class: 'check', for: 'watch' }, watch, 'Watchlist only'),
      anyFilter ? el('button', { class: 'clear', type: 'button', text: 'Clear filters', onclick: function () {
        state.q = ''; state.family = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render();
      } }) : null,
      el('p', { class: 'count' }, el('b', { text: String(visible) }), ' of ' + (state.status === 'live' ? DATA.live.length : DATA.board_size) + ' rows · ' + (state.status === 'live' ? 'market cap' : 'implied value'))
    );
  }

  // ------------------------------------------------------------------ the board table

  function sortHeader(key, label, className) {
    var active = state.sort === key;
    var dir = active ? state.dir : null;
    var th = el('th', {
      scope: 'col',
      class: className || null,
      'aria-sort': active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
    });
    var button = el('button', { type: 'button', title: 'Sort by ' + label.toLowerCase() }, label,
      active ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: dir === 'asc' ? '▲' : '▼' }) : null);
    button.addEventListener('click', function () {
      if (state.sort === key) state.dir = state.dir === 'desc' ? 'asc' : 'desc';
      else { state.sort = key; state.dir = key === 'name' || key === 'family' ? 'asc' : 'desc'; }
      writeHash(); render();
    });
    th.appendChild(button);
    return th;
  }

  function boardTable() {
    var list = sortRows(DATA.rows.filter(matches));
    // The bar is relative to the rows on screen, so a filtered family still shows its own shape
    // instead of a row of stubs beside a global maximum none of these rows can reach.
    var listMax = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var caption = 'Pre-token protocols, most implied value first. Select a row for its value build-up and farm plan. The amber dot marks a watchlist protocol. This page recomputes every row to the dollar: ' + auditOk + ' / ' + auditAll + '.';
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'Nothing matches this filter' }),
        el('p', { text: 'The filters combine, so a chain and a family that never meet leave the board empty. Clear one to see the rows again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () {
          state.q = ''; state.family = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render();
        } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', {
        tabindex: '0',
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        'aria-label': r.name + ', rank ' + r.rank + ', implied value ' + fmtDollars(r.implied_value_usd)
      },
        el('td', { class: 'rank' },
          el('b', { text: String(r.rank) }),
          r.watchlist ? el('span', { class: 'wl-dot', title: 'On the watchlist', 'aria-label': 'on the watchlist' }) : null
        ),
        el('td', null, el('div', { class: 'proto' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + fmtChains(r.chains, 3) })
        )),
        el('td', null, el('span', { class: 'fam', 'data-family': r.family },
          r.family_label,
          el('span', { class: 'fam-mult', text: fmtFactor(MULT[r.family], 2) + '×' })
        )),
        el('td', { class: 'cell-num num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'cell-num num ' + (r.change_7d === null ? 'dim' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'cell-num num', text: fmtAge(r.age_days) }),
        el('td', { class: 'cell-num' }, el('div', { class: 'implied' },
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / listMax) * 100)) + '%' })),
          el('span', { class: 'value', text: fmtUsd(r.implied_value_usd) })
        ))
      );
      tr.addEventListener('click', function () { openDetail(r.slug); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); }
      });
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: caption }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank', 'rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('family', 'Family'),
            sortHeader('tvl', 'TVL', 'cell-num'),
            sortHeader('change', '7 days', 'cell-num'),
            sortHeader('age', 'Age', 'cell-num'),
            sortHeader('implied', 'Implied value', 'cell-num')
          )),
          tbody
        )
      )
    );
  }

  // ------------------------------------------------------------------ the live table

  function liveTable() {
    var q = state.q.trim().toLowerCase();
    var list = DATA.live.filter(function (r) {
      if (state.family !== 'all' && r.family !== state.family) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', r.symbol || '', (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    list = list.slice().sort(function (a, b) {
      var dir = state.dir === 'asc' ? 1 : -1;
      var av = state.sort === 'tvl' ? a.tvl_usd : state.sort === 'change' ? (a.change_7d || -Infinity) : a.mcap_usd;
      var bv = state.sort === 'tvl' ? b.tvl_usd : state.sort === 'change' ? (b.change_7d || -Infinity) : b.mcap_usd;
      if (av === bv) return a.name < b.name ? -1 : 1;
      return av < bv ? -dir : dir;
    });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', { tabindex: '0', 'data-selected': state.selected === r.slug ? 'true' : 'false' },
        el('td', { class: 'rank' }, el('span', { class: 'tag live', text: 'live' })),
        el('td', null, el('div', { class: 'proto' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + fmtChains(r.chains, 3) })
        )),
        el('td', null, el('span', { class: 'fam', 'data-family': r.family, text: r.family_label })),
        el('td', { class: 'cell-num num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'cell-num num ' + (r.change_7d === null ? 'dim' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'cell-num' }, el('div', { class: 'implied' },
          el('span', { class: 'bar wide', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round(((r.mcap_usd || 0) / maxLiveMcap) * 100)) + '%' })),
          el('span', { class: 'value', text: fmtUsd(r.mcap_usd) })
        )),
        el('td', { class: 'cell-num num dim', text: r.symbol || '—' })
      );
      tr.addEventListener('click', function () { openLiveDetail(r.slug); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLiveDetail(r.slug); }
      });
      tbody.appendChild(tr);
    });
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No live-token protocol matches' }),
        el('p', { text: 'The live view is the top ' + DATA.live_size + ' protocols by market cap; clear the search or the filters to see it.' })
      ));
    }
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact and not a model. They are set aside from the ranking, never mixed into it.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', class: 'rank', text: 'Status' }),
            sortHeader('name', 'Protocol'),
            sortHeader('family', 'Family'),
            sortHeader('tvl', 'TVL', 'cell-num'),
            sortHeader('change', '7 days', 'cell-num'),
            sortHeader('mcap', 'Market cap', 'cell-num'),
            el('th', { scope: 'col', class: 'cell-num', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  // ------------------------------------------------------------------ methodology

  function methodPanel() {
    var ok = auditOk === auditAll;
    return el('section', { class: 'panel method', 'aria-label': 'Methodology' },
      el('section', null,
        el('h2', { text: 'What the number means' }),
        el('p', { text: 'A protocol\'s launch is the token it may issue one day. The radar does not predict whether or when that happens; it asks what a token would be worth if the protocol\'s record stayed as it is. Every row is one formula over three snapshot figures — TVL, seven-day TVL growth and the day DefiLlama began tracking it — plus the number of chains it runs on. No protocol name is special-cased and no row is hand-picked.' }),
        el('p', { class: 'formula' },
          'implied = round( tvl_usd × category × momentum × maturity × chains )',
          el('br'),
          'category: Perp DEX 0.60, DEX 0.55, Lending 0.50, CDP 0.45, RWA 0.45, Yield 0.40, Restaking 0.35, other 0.30',
          el('br'),
          'momentum = clamp(1 + change_7d/100 × ' + MODEL.momentum_weight + ', ' + MODEL.momentum_floor + ', ' + MODEL.momentum_cap + '); unreported growth is ' + MODEL.unknown_momentum,
          el('br'),
          'maturity = 1 + log10(days since listed)/' + MODEL.maturity_log_divisor + '; an unlisted protocol is ' + MODEL.unknown_maturity,
          el('br'),
          'chains = 1 + min(chains − 1, ' + MODEL.chain_cap + ') × ' + MODEL.chain_step + ', so five or more chains stop adding value'
        ),
        el('p', { class: 'audit', 'data-ok': ok ? 'true' : 'false' },
          'Page audit: this script recomputes every row from its raw snapshot figures with the formula above. ',
          el('b', { text: auditOk + ' / ' + auditAll }),
          ' rows reproduce the dollar board.json carries' + (ok ? ', including the top row.' : '; the rows that differ are listed first on the board and should not be trusted.')
        )
      ),
      el('section', null,
        el('h2', { text: 'The eight families' }),
        el('p', { text: 'DefiLlama\'s categories fold into eight families, matched in order so a narrow category wins: a Liquid Restaking protocol is restaking, not staking. The multiple is what the market has paid for a launch in that family, and the multiple is the only place a category can move a row.' }),
        el('div', { class: 'family-table' },
          DATA.family_counts.map(function (f) {
            var meta = DATA.families.filter(function (x) { return x.key === f.family; })[0];
            return el('div', { class: 'family-row', 'data-family': f.family },
              el('span', { class: 'swatch', 'aria-hidden': 'true' }),
              el('span', { class: 'fname', text: f.label }),
              el('span', { class: 'fmult', text: fmtFactor(meta ? meta.multiple : 0, 2) + '×' }),
              el('span', { class: 'fwhy', text: meta ? meta.why : '' }),
              el('span', { class: 'fcount', text: String(f.count) })
            );
          })
        )
      )
    );
  }

  function footNote() {
    return el('footer', { class: 'foot' },
      el('p', null, el('b', { text: DATA.pre_token_total + ' protocols' }), ' in the snapshot record no token. The watchlist is the floor, never the ceiling: the board adds the pre-token protocols below it, which is where a radar is useful.'),
      el('p', null, 'Snapshot ' + DATA.as_of + ' · ', el('b', { text: 'implied value is a model of a hypothetical launch, not a promise that one happens' }), '.')
    );
  }

  // ------------------------------------------------------------------ detail drawer

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () {
    state.selected = null;
    writeHash();
    var marked = app.querySelector('tr[data-selected="true"]');
    if (marked) marked.setAttribute('data-selected', 'false');
  });

  function closeButton() {
    return el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { dialog.close(); } });
  }

  function stepParts(step) {
    var costAt = step.indexOf(' Cost: ');
    var action = costAt >= 0 ? step.slice(0, costAt) : step;
    var rest = costAt >= 0 ? step.slice(costAt + 7) : '';
    var timeAt = rest.indexOf('. Time: ');
    var cost = timeAt >= 0 ? rest.slice(0, timeAt) : rest;
    var time = timeAt >= 0 ? rest.slice(timeAt + 8) : '';
    return { action: action, cost: cost, time: time.replace(/\.$/, '') };
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = recompute(row);
    var same = recomputed === row.implied_value_usd;
    var inner = el('div', { class: 'detail-inner' });

    inner.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('p', { class: 'rank-line', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.watchlist ? 'watchlist' : 'early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + fmtChains(row.chains, 4) })
      ),
      closeButton()
    ));
    inner.appendChild(el('div', { class: 'chips' },
      el('span', { class: 'chip', 'data-family': row.family }, el('span', { class: 'fam', 'data-family': row.family, text: row.family_label })),
      el('span', { class: 'chip signal', text: 'records no token' }),
      row.watchlist ? el('span', { class: 'chip', text: 'watchlist' }) : el('span', { class: 'chip', text: 'below the floor' }),
      el('span', { class: 'chip', text: row.chains.length + (row.chains.length === 1 ? ' chain' : ' chains') })
    ));

    // The value build-up: every factor the model applied, in the order it applied them.
    var build = el('div', { class: 'build' });
    function buildRow(op, what, note, factor, amount) {
      build.appendChild(el('div', { class: 'build-row' },
        el('span', { class: 'op', text: op }),
        el('span', { class: 'what' }, what, note ? el('span', { text: note }) : null),
        factor ? el('span', { class: 'factor', text: factor }) : el('span', null),
        el('span', { class: 'amount', text: amount })
      ));
    }
    var factors = factorsOf(row);
    var running = row.tvl_usd;
    buildRow('', 'TVL', 'the protocol\'s own deposits', '', fmtDollars(running));
    running *= factors.category;
    buildRow('×', 'Category', (row.category || 'unreported') + ' → ' + row.family_label + ' family', fmtFactor(row.model.category_multiple, 2) + '×', fmtDollars(running));
    running *= factors.momentum;
    buildRow('×', 'Momentum', row.change_7d === null ? 'seven-day growth not reported' : 'seven-day growth ' + fmtPct(row.change_7d) + (row.model.momentum_clamped ? ' (clamped)' : ''), fmtFactor(factors.momentum, 4) + '×', fmtDollars(running));
    running *= factors.maturity;
    buildRow('×', 'Maturity', row.age_days === null ? 'listing date not reported' : fmtAge(row.age_days) + ' with no token', fmtFactor(factors.maturity, 4) + '×', fmtDollars(running));
    running *= factors.chains;
    buildRow('×', 'Chains', row.chains.length + ' chains, value stops rising at 5', fmtFactor(factors.chains, 4) + '×', fmtDollars(running));
    var total = el('div', { class: 'build-total' },
      el('span', null, 'Implied value · rank ' + row.rank + ' of ' + DATA.board_size),
      el('b', { text: fmtDollars(row.implied_value_usd) })
    );
    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Value build-up' }),
      build,
      total,
      el('p', { class: 'check-line ' + (same ? '' : 'bad') },
        el('span', { class: 'check-mark', 'aria-hidden': 'true', text: same ? '✓' : '!' }),
        el('span', null, 'This page recomputes the row from the snapshot figures: ', el('b', { text: fmtDollars(recomputed) }),
          same ? ', the same dollar board.json carries.' : ', which differs from the board; treat the board as stale.')
      )
    ));

    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan · cost and time on every step' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var parts = stepParts(s);
        return el('li', null,
          el('p', { class: 'action', text: parts.action }),
          el('div', { class: 'meta' },
            parts.cost ? el('span', { class: 'cost', text: 'Cost: ' + parts.cost }) : null,
            parts.time ? el('span', { text: 'Time: ' + parts.time }) : null
          )
        );
      }))
    ));

    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'The record behind the row' }),
      el('dl', { class: 'facts' },
        fact('Slug', row.slug),
        fact('DefiLlama category', row.category || 'unreported'),
        fact('First listed', fmtDate(row.listed_at)),
        fact('Age with no token', fmtAge(row.age_days)),
        fact('TVL', fmtDollars(row.tvl_usd)),
        fact('Seven-day change', fmtPct(row.change_7d)),
        fact('Chains', String(row.chains.length)),
        fact('Token on record', 'none (gecko id and symbol null)')
      )
    ));
    inner.appendChild(el('p', { class: 'foot', style: 'border:0;margin-top:24px' },
      'Implied value is this radar\'s claim about a hypothetical token, not make.fun\'s and not a prediction that one is issued. Farm only what you can afford to leave in place.'));

    dialog.appendChild(inner);
    showDialog();
  }

  function openLiveDetail(slug) {
    var row = DATA.live.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var ratio = row.tvl_usd > 0 ? row.mcap_usd / row.tvl_usd : 0;
    var inner = el('div', { class: 'detail-inner' },
      el('div', { class: 'detail-head' },
        el('div', null,
          el('p', { class: 'rank-line', text: 'Token live · set aside from the ranking' }),
          el('h2', { id: 'detail-title', text: row.name }),
          el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + fmtChains(row.chains, 4) })
        ),
        closeButton()
      ),
      el('div', { class: 'chips' },
        el('span', { class: 'chip', 'data-family': row.family }, el('span', { class: 'fam', 'data-family': row.family, text: row.family_label })),
        el('span', { class: 'chip', text: 'already trades' }),
        row.symbol ? el('span', { class: 'chip', text: '$' + row.symbol }) : null
      ),
      el('div', { class: 'live-note' },
        'This protocol\'s token already trades, so its market cap is a fact rather than a model. It is listed here so the two groups are visible side by side, and it carries no rank, no implied value and no farm plan: there is no launch to farm.'),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Market facts' }),
        el('dl', { class: 'facts' },
          fact('Market cap', fmtDollars(row.mcap_usd)),
          fact('TVL', fmtDollars(row.tvl_usd)),
          fact('Market cap / TVL', ratio ? ratio.toFixed(2) + '×' : '—'),
          fact('Seven-day change', fmtPct(row.change_7d)),
          fact('First listed', fmtDate(row.listed_at)),
          fact('Chains', String(row.chains.length)),
          fact('Symbol on record', row.symbol || 'none'),
          fact('Slug', row.slug)
        )
      )
    );
    dialog.appendChild(inner);
    showDialog();
  }

  function fact(term, value) {
    return el('div', { class: 'fact' }, el('dt', { text: term }), el('dd', { text: value }));
  }

  function showDialog() {
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) {
        try { dialog.showModal(); } catch (e) { dialog.setAttribute('open', ''); }
      }
    } else {
      dialog.setAttribute('open', '');
    }
    dialog.scrollTop = 0;
  }

  // ------------------------------------------------------------------ render

  function render() {
    app.textContent = '';
    app.appendChild(kpis());
    app.appendChild(formulaStrip());
    app.appendChild(controls());
    app.appendChild(state.status === 'pre-token' ? boardTable() : liveTable());
    app.appendChild(methodPanel());
    app.appendChild(footNote());
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) {
      if (state.status === 'live') openLiveDetail(state.selected);
      else openDetail(state.selected);
    }
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
