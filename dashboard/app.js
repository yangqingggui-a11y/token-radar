// Token Radar's page. It reads window.RADAR, the dataset main.ts writes beside the page, and renders
// the ranked board, a filterable table, a per-protocol detail drawer and the fitted model's evidence.
// No network: every byte it shows comes from data.js.
//
// The one function that matters is recompute(): the page re-runs lib/model.ts's fitted equation on
// each row's raw snapshot figures and prints whether the result is the dollar board.json carries. The
// board is not a table someone typed: it is this arithmetic, checked on every row at load.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA) {
    app.textContent = 'The page could not find its dataset (data.js). It is written beside the dashboard by main.ts.';
    return;
  }

  var FIT = DATA.fit;
  var MODEL = DATA.model;
  var FAMILY_COEF = {};
  var FAMILY_MULT = {};
  var FAMILY_LABEL = {};
  DATA.families.forEach(function (f) {
    FAMILY_COEF[f.key] = f.coef;
    FAMILY_MULT[f.key] = f.multiplier;
    FAMILY_LABEL[f.key] = f.label;
  });

  // ------------------------------------------------------------------ formatting

  var NF = new Intl.NumberFormat('en-US');
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + NF.format(Math.round(n));
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
  function fmtNum(n, places) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return n.toFixed(places === undefined ? 3 : places);
  }
  function factorText(x) {
    if (!isFinite(x) || x <= 0) return '—';
    if (x >= 1e5 || x < 1e-3) return '×' + x.toExponential(2).replace('e+', 'e');
    if (x >= 100) return '×' + NF.format(Math.round(x));
    if (x >= 10) return '×' + x.toFixed(1);
    return '×' + x.toFixed(4);
  }
  function fmtDate(iso) {
    return iso || '—';
  }
  function fmtChains(chains, limit) {
    if (!chains || chains.length === 0) return 'an unnamed chain';
    var head = chains.slice(0, limit || 2).join(', ');
    return chains.length > (limit || 2) ? head + ' +' + (chains.length - (limit || 2)) : head;
  }

  // ------------------------------------------------------------------ the fitted equation, mirrored

  var MEDIAN_AGE = FIT.median_age;
  var SCALE = FIT.change_scale;

  // Exactly lib/model.ts's terms, in the same order, so the floating-point sum and the page's check
  // are the same arithmetic. The coefficients are the fit's own, not copies of a rounded display.
  function termsOf(row) {
    var lnTvl = Math.log(row.tvl_usd);
    var lnAge = row.age_days === null || row.age_days === undefined || row.age_days < 1 ? Math.log(MEDIAN_AGE) : Math.log(row.age_days);
    var change = row.change_7d === null || row.change_7d === undefined ? 0 : SCALE * Math.tanh(row.change_7d / SCALE);
    var chains = row.chain_count === undefined ? (row.chains ? row.chains.length : 0) : row.chain_count;
    var missing = row.age_days === null || row.age_days === undefined ? 1 : 0;
    var fam = FAMILY_COEF[row.family] === undefined ? 0 : FAMILY_COEF[row.family];
    var tvlTerm = FIT.ln_tvl * lnTvl;
    var ageTerm = FIT.ln_age * lnAge;
    var changeTerm = FIT.change * change;
    var chainTerm = FIT.chains * chains;
    var missingTerm = FIT.age_missing * missing;
    return {
      lnTvl: lnTvl, lnAge: lnAge, change: change, chains: chains, missing: missing, family: fam,
      tvlTerm: tvlTerm, ageTerm: ageTerm, changeTerm: changeTerm, chainTerm: chainTerm, missingTerm: missingTerm,
      z: FIT.intercept + tvlTerm + ageTerm + changeTerm + chainTerm + missingTerm + fam
    };
  }

  function recompute(row) {
    var t = termsOf(row);
    return Math.max(1, Math.round(Math.exp(t.z) * FIT.shrink));
  }

  var auditOk = 0;
  DATA.rows.forEach(function (r) { if (recompute(r) === r.implied_value_usd) auditOk += 1; });
  var auditAll = DATA.rows.length;
  var maxLiveMcap = DATA.live.reduce(function (m, r) { return Math.max(m, r.mcap_usd || 0); }, 1);

  // ------------------------------------------------------------------ state

  var state = { q: '', family: 'all', chain: 'all', status: 'pre-token', watch: false, sort: 'implied', dir: 'desc', selected: null };

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var p = new URLSearchParams(raw);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('family') && FAMILY_COEF[p.get('family')] !== undefined) state.family = p.get('family');
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
    mcap: function (r) { return r.mcap_usd || 0; },
    cost: function (r) { return r.farm ? r.farm.cost_per_million_implied_usd : 0; }
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
    return el('section', { class: 'kpis', 'aria-label': 'Snapshot facts' },
      kpi('Watchlist covered', DATA.watchlist_covered + ' / ' + DATA.watchlist_size, 'every slug in the sealed list', 'signal', true),
      kpi('Pre-token rows', String(DATA.board_size), 'each one scored by the fitted equation', 'signal', false),
      kpi('Early rows', String(DATA.early_size), 'below the ' + fmtUsd(DATA.floor_usd) + ' floor', 'amber', false),
      kpi('Live tokens set aside', String(DATA.live_size), 'their market cap is a fact', 'plain', false),
      kpi('Fit R²', FIT.r2.toFixed(3), FIT.n + ' tokenized protocols, ' + FIT.features + ' terms', 'signal', false)
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
    return el('section', { class: 'formula-strip', 'aria-label': 'The fitted value model' },
      el('div', null,
        el('p', { class: 'formula-label', text: 'The fitted model · ' + DATA.model_version }),
        el('p', { class: 'formula' },
          'ln(mcap) = ' + fmtNum(FIT.intercept, 3) + (FIT.ln_tvl >= 0 ? ' + ' : ' − ') + fmtNum(Math.abs(FIT.ln_tvl), 3) + '·ln TVL'
            + (FIT.ln_age >= 0 ? ' + ' : ' − ') + fmtNum(Math.abs(FIT.ln_age), 3) + '·ln age'
            + (FIT.change >= 0 ? ' + ' : ' − ') + fmtNum(Math.abs(FIT.change), 3) + '·' + SCALE + '·tanh(7d/' + SCALE + ')'
            + (FIT.chains >= 0 ? ' + ' : ' − ') + fmtNum(Math.abs(FIT.chains), 3) + '·chains + family',
          el('br'),
          'implied = exp(ln mcap) × ' + FIT.shrink + ' launch prior · least squares on ' + FIT.n + ' tokens · holdout RMSE ' + fmtNum(FIT.holdout.rmse_log, 2) + ' log points on ' + FIT.holdout.n
        )
      ),
      el('div', { class: 'factors' },
        el('span', { class: 'factor' }, 'n ', el('b', { text: String(FIT.n) })),
        el('span', { class: 'factor' }, 'R² ', el('b', { text: fmtNum(FIT.r2, 3) })),
        el('span', { class: 'factor' }, 'adj R² ', el('b', { text: fmtNum(FIT.adj_r2, 3) })),
        el('span', { class: 'factor' }, 'RMSE ', el('b', { text: fmtNum(FIT.rmse_log, 2) + ' ln' }))
      )
    );
  }

  // ------------------------------------------------------------------ controls

  function chainOptions() {
    return DATA.chain_counts.slice(0, 24).map(function (c) {
      return el('option', { value: c.chain, text: c.chain + ' (' + c.count + ')', selected: state.chain === c.chain ? 'selected' : null });
    });
  }

  function controls() {
    var search = el('input', { type: 'search', id: 'q', value: state.q, placeholder: 'Search a protocol, category or chain', 'aria-label': 'Search the board', autocomplete: 'off' });
    search.addEventListener('input', function () {
      state.q = search.value;
      writeHash();
      render();
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
    var listMax = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var caption = 'Pre-token protocols, most implied value first. Select a row for its fitted build-up and farm plan. The amber dot marks a watchlist protocol; Farm $/M is the plan\'s own total cost per $1M of implied value. This page re-runs the fit on every row: ' + auditOk + ' / ' + auditAll + ' match the board to the dollar.';
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
          el('span', { class: 'fam-mult', text: factorText(FAMILY_MULT[r.family] === undefined ? 1 : FAMILY_MULT[r.family]) })
        )),
        el('td', { class: 'cell-num num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'cell-num num ' + (r.change_7d === null ? 'dim' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'cell-num num', text: fmtAge(r.age_days) }),
        el('td', { class: 'cell-num' }, el('div', { class: 'implied' },
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / listMax) * 100)) + '%' })),
          el('span', { class: 'value', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'cell-num num dim', text: '$' + r.farm.cost_per_million_implied_usd.toFixed(1), title: 'Total farm cost per $1M of implied value: ' + fmtDollars(r.farm.total_usd) + ' over ' + r.farm.hold_days + ' days' })
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
            sortHeader('implied', 'Implied value', 'cell-num'),
            sortHeader('cost', 'Farm $/M', 'cell-num')
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
    return el('section', { class: 'panel method', 'aria-label': 'Methodology and the fit' },
      el('section', null,
        el('h2', { text: 'A model fitted to the snapshot\'s own tokens' }),
        el('p', { text: FIT.n + ' protocols record both a TVL and a market cap. That labelled set lets the radar estimate its equation by least squares instead of asserting multipliers: one log-linear equation, ' + FIT.features + ' terms, closed form, standard library only. The target is the market cap a token would claim from the protocol\'s record — TVL, growth, listed days, chains and family.' }),
        el('p', { class: 'formula' },
          'ln(mcap) = ' + fmtNum(FIT.intercept, 4) + (FIT.ln_tvl >= 0 ? ' + ' : ' − ') + fmtNum(Math.abs(FIT.ln_tvl), 4) + '·ln(tvl)'
            + (FIT.ln_age >= 0 ? ' + ' : ' − ') + fmtNum(Math.abs(FIT.ln_age), 4) + '·ln(age days)'
            + (FIT.change >= 0 ? ' + ' : ' − ') + fmtNum(Math.abs(FIT.change), 4) + '·' + SCALE + '·tanh(7d/' + SCALE + ')'
            + (FIT.chains >= 0 ? ' + ' : ' − ') + fmtNum(Math.abs(FIT.chains), 4) + '·chains'
            + (FIT.age_missing >= 0 ? ' + ' : ' − ') + fmtNum(Math.abs(FIT.age_missing), 4) + '·(no listing date) + family'
        ),
        el('p', { text: 'Seven-day change is bounded by 30·tanh(change/30), so one protocol\'s +4,448% week cannot set the coefficient. Its +' + fmtNum(FIT.change, 3) + ' coefficient is a stated prior: the unconstrained fit gave ' + fmtNum(FIT.change_fitted, 3) + ' ± ' + fmtNum(FIT.change_se, 3) + ' (t ' + fmtNum(FIT.change_t, 1) + '), and that sign would let a seven-day crash lift a row. A missing listing date enters at the median age (' + NF.format(Math.round(MEDIAN_AGE)) + ' days); market caps of zero or below (' + FIT.excluded_nonpositive + ') are not fitted.' }),
        el('div', { class: 'stats' },
          stat('N', NF.format(FIT.n) + ' tokens'),
          stat('R²', fmtNum(FIT.r2, 3)),
          stat('Adjusted R²', fmtNum(FIT.adj_r2, 3)),
          stat('Residual RMSE', fmtNum(FIT.rmse_log, 2) + ' ln'),
          stat('Holdout', fmtNum(FIT.holdout.rmse_log, 2) + ' ln on ' + FIT.holdout.n)
        ),
        el('p', { class: 'audit', 'data-ok': ok ? 'true' : 'false' },
          'Page audit: this script re-runs the fitted equation on every row from its raw snapshot figures. ',
          el('b', { text: auditOk + ' / ' + auditAll }),
          ' rows reproduce the dollar board.json carries' + (ok ? ', including the top row.' : '; the rows that differ should not be trusted.')
        ),
        el('p', { text: 'Launch prior: every training row is a token that trades; a pre-token protocol\'s token does not exist yet. The fitted value is multiplied by ' + FIT.shrink + ', a stated 35% launch-risk discount. It multiplies every row alike, so it moves no rank; growth\'s prior changes value, not the evidence.' }),
        el('p', { text: 'What the fit found, and did not: ln(TVL) is the one strong term (t ' + fmtNum(FIT.ln_tvl / FIT.ln_tvl_se, 1) + '), and its exponent is below 1, so a protocol with more TVL is worth more at a falling multiple of it. Family effects rest on 2 to ' + Math.max.apply(null, FIT.families.map(function (f) { return f.n; })) + ' protocols each, so each prints its sample size and t rather than posing as settled. Age and chains keep the signs the data gave; age\'s is negative and its t is ' + fmtNum(FIT.ln_age / FIT.ln_age_se, 1) + ', a weak effect stated as one.' })
      ),
      el('section', null,
        el('h2', { text: 'Families: fitted effect and observed market' }),
        el('p', { text: 'The fitted multiplier is exp(coefficient) against the Other base, after controlling for TVL, age, growth and chains. The observed column is the raw median market cap / TVL among that family\'s tokenized protocols — the market\'s own number, with no model in it. They disagree, and both are shown, because a category effect in a regression is not the same thing as a category\'s median ratio.' }),
        el('div', { class: 'family-table' },
          el('div', { class: 'family-row head' },
            el('span', { class: 'swatch', 'aria-hidden': 'true' }),
            el('span', { class: 'fname', text: 'Family' }),
            el('span', { class: 'fcount', text: 'n' }),
            el('span', { class: 'fmult', text: 'fitted' }),
            el('span', { class: 'fwhy', text: 'observed mcap/TVL' }),
            el('span', { class: 'fcount', text: 't' })
          ),
          DATA.families.map(function (f) {
            return el('div', { class: 'family-row', 'data-family': f.key, title: f.why },
              el('span', { class: 'swatch', 'aria-hidden': 'true' }),
              el('span', { class: 'fname', text: f.label }),
              el('span', { class: 'fcount', text: String(f.n) }),
              el('span', { class: 'fmult', text: factorText(f.multiplier) }),
              el('span', { class: 'fwhy', text: f.observed_median_ratio === null ? '—' : f.observed_median_ratio.toFixed(2) }),
              el('span', { class: 'fcount', text: fmtNum(f.t, 1) })
            );
          })
        )
      )
    );
  }

  function stat(label, value) {
    return el('div', { class: 'stat' }, el('span', { text: label }), el('b', { text: value }));
  }

  function footNote() {
    return el('footer', { class: 'foot' },
      el('p', null, el('b', { text: DATA.pre_token_total + ' protocols' }), ' in the snapshot record no token. The watchlist is the floor, never the ceiling: the board adds the pre-token protocols below it, which is where a radar is useful.'),
      el('p', null, 'Snapshot ' + DATA.as_of + ' · ', el('b', { text: 'implied value is the fitted model\'s claim about a hypothetical launch, not a promise that one happens' }), '.')
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
    var timeAt = step.lastIndexOf('Time: ');
    var costAt = step.lastIndexOf('Cost: ', timeAt);
    var preAt = step.lastIndexOf('Prerequisite: ', costAt);
    var action = preAt >= 0 ? step.slice(0, preAt) : costAt >= 0 ? step.slice(0, costAt) : step;
    var pre = preAt >= 0 && costAt > preAt ? step.slice(preAt + 14, costAt) : '';
    var cost = costAt >= 0 && timeAt > costAt ? step.slice(costAt + 6, timeAt) : '';
    var time = timeAt >= 0 ? step.slice(timeAt + 6) : '';
    function clean(s) { return s.trim().replace(/\.$/, ''); }
    return { action: clean(action), pre: clean(pre), cost: clean(cost), time: clean(time) };
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = recompute(row);
    var same = recomputed === row.implied_value_usd;
    var t = termsOf(row);
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

    // The waterfall: the fitted equation is additive in log space, so each term is one bar and the
    // bars add to ln(implied before rounding). It shows which term moved the row, and by how much.
    var build = el('div', { class: 'wf' });
    var terms = [
      { label: 'Intercept', delta: FIT.intercept, note: 'TVL $1 · age 1' },
      { label: 'TVL', delta: t.tvlTerm, note: fmtUsd(row.tvl_usd) },
      { label: 'Age', delta: t.ageTerm, note: fmtAge(row.age_days) },
      { label: 'Growth', delta: t.changeTerm, note: fmtPct(row.change_7d) },
      { label: 'Chains', delta: t.chainTerm, note: t.chains + (t.chains === 1 ? ' chain' : ' chains') },
      { label: 'Family', delta: t.family, note: row.family_label },
      { label: 'Launch prior', delta: Math.log(FIT.shrink), note: 'stated' }
    ];
    if (t.missing !== 0) terms.push({ label: 'No listing date', delta: t.missingTerm, note: 'indicator' });
    var scale = 0;
    var cum = 0;
    terms.forEach(function (term) {
      cum += term.delta;
      scale = Math.max(scale, Math.abs(cum), Math.abs(cum - term.delta));
    });
    cum = 0;
    terms.forEach(function (term) {
      var start = cum;
      var end = cum + term.delta;
      cum = end;
      var left = Math.max(0, (Math.min(start, end) / scale) * 100);
      var width = (Math.abs(term.delta) / scale) * 100;
      build.appendChild(el('div', { class: 'wf-row' },
        el('span', { class: 'wf-label', text: term.label }),
        el('span', { class: 'wf-track' }, el('i', { class: term.delta >= 0 ? 'pos' : 'neg', style: 'left:' + left.toFixed(2) + '%;width:' + Math.max(0.5, width).toFixed(2) + '%' })),
        el('span', { class: 'wf-val ' + (term.delta >= 0 ? 'pos' : 'neg'), text: (term.delta >= 0 ? '+' : '−') + Math.abs(term.delta).toFixed(2) }),
        el('span', { class: 'wf-note', text: term.note })
      ));
    });
    build.appendChild(el('div', { class: 'wf-row sum' },
      el('span', { class: 'wf-label', text: 'Implied' }),
      el('span', { class: 'wf-track' }, el('i', { class: 'sum', style: 'left:0;width:100%' })),
      el('span', { class: 'wf-val', text: fmtNum(t.z + Math.log(FIT.shrink), 2) }),
      el('span', { class: 'wf-note', text: fmtUsd(row.implied_value_usd) })
    ));

    var total = el('div', { class: 'build-total' },
      el('span', null, 'Implied value · rank ' + row.rank + ' of ' + DATA.board_size),
      el('b', { text: fmtDollars(row.implied_value_usd) })
    );
    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Fitted build-up · log-point waterfall' }),
      el('p', { class: 'wf-cap', text: 'Each bar is one term of ln(mcap); the bars add to ' + fmtNum(t.z + Math.log(FIT.shrink), 2) + ', and exp of that is the implied value before rounding.' }),
      build,
      total,
      el('p', { class: 'check-line ' + (same ? '' : 'bad') },
        el('span', { class: 'check-mark', 'aria-hidden': 'true', text: same ? '✓' : '!' }),
        el('span', null, 'This page re-runs the fit on the row: ', el('b', { text: fmtDollars(recomputed) }),
          same ? ', the same dollar board.json carries.' : ', which differs from the board; treat the board as stale.')
      )
    ));

    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan · prerequisite, cost and time on every step' }),
      el('p', { class: 'farm-cost' },
        'Total ', el('b', { text: fmtDollars(row.farm.total_usd) }),
        ' (' + fmtDollars(row.farm.capital_usd) + ' capital + ' + fmtDollars(row.farm.gas_usd) + ' gas over ' + row.farm.hold_days + ' days) · ',
        el('b', { text: '$' + row.farm.cost_per_million_implied_usd.toFixed(2) }), ' per $1M of implied value · ',
        el('b', { text: row.farm.cost_bp_of_implied.toFixed(2) }), ' bp'
      ),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var parts = stepParts(s);
        return el('li', null,
          el('p', { class: 'action', text: parts.action }),
          el('div', { class: 'meta' },
            parts.pre ? el('span', { class: 'pre', text: 'Needs: ' + parts.pre }) : null,
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
        fact('Implied / TVL', (row.implied_value_usd / row.tvl_usd * 100).toFixed(2) + '%'),
        fact('Seven-day change', fmtPct(row.change_7d)),
        fact('Chains', String(row.chains.length)),
        fact('Token on record', 'none (gecko id and symbol null)')
      )
    ));
    inner.appendChild(el('p', { class: 'foot', style: 'border:0;margin-top:24px' },
      'Implied value is the fitted model\'s claim about a hypothetical token, not make.fun\'s and not a prediction that one is issued. Farm only what you can afford to leave in place.'));

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
        'This protocol\'s token already trades, so its market cap is a fact rather than a model. It is listed here so the two groups are visible side by side; it carries no rank, no implied value and no farm plan, and it is one of the ' + FIT.n + ' protocols the fit learned from.'),
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
