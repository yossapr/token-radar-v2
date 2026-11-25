/* The page: rebuilds the radar from the raw snapshot with model.js, checks it against what main.ts wrote, and
 * draws the evidence, the board, the tokens that trade, the set-asides and a detail for every protocol. State
 * lives in the address hash, so every view is a link. No framework, no network. */
(function () {
  'use strict';
  const M = window.RadarModel, input = window.RADAR_INPUT, $ = (id) => document.getElementById(id);
  if (!M || !input) { $('main').textContent = 'model.js or data.js is missing: run main.ts first.'; return; }
  const { usd, pct, KIND_LABEL } = M;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const x2 = (v) => '×' + v.toFixed(2), p0 = (v) => (v * 100).toFixed(0) + '%';
  const R = M.buildRadar(input.snapshot), bySlug = new Map(R.rows.map((r) => [r.slug, r])), m = R.model, o = R.odds;

  // ---- The board checks: what this page rebuilt against what main.ts wrote ----
  const same = input.board.filter(([slug, rank, value, verdict]) => { const r = bySlug.get(slug); return r && r.rank === rank && r.implied === value && r.farm.verdict === verdict; }).length;
  const ordered = R.ranked.every((r, i, a) => r.rank === i + 1 && (i === 0 || a[i - 1].implied >= r.implied));
  const totalIn = input.board.reduce((s, b) => s + b[2], 0), c = R.counts;
  const CHECKS = [
    [same === input.board.length && same === c.pre, `this table = board.json: ${same} of ${input.board.length} rows recomputed here`],
    [ordered, `ranks 1–${c.pre} in order, values never rise`],
    [totalIn === R.total, `totals equal: ${usd(R.total)}`],
    [input.checksum === R.checksum, `checksum ${R.checksum} = main.ts`],
    [c.watchRanked === c.watch, `watchlist ${c.watchRanked} of ${c.watch} ranked`],
    [c.comp + c.token + c.aside + c.pre === c.all, `ledger ${c.comp + c.token + c.aside + c.pre} of ${c.all} protocols`],
  ];

  const DEF = { tab: 'board', q: '', v: '', tier: '', kind: '', chain: '', sort: 'rank', dir: '1', open: '', dep: '', share: '', fold: '', cmp: '', mdl: '' };
  let S = { ...DEF };
  const readHash = () => { S = { ...DEF }; new URLSearchParams(location.hash.slice(1)).forEach((v, k) => { if (k in S) S[k] = v; }); };
  function set(patch) {
    S = { ...S, ...patch };
    const p = new URLSearchParams();
    Object.keys(S).forEach((k) => { if (S[k] !== DEF[k]) p.set(k, S[k]); });
    history.replaceState(null, '', '#' + p);
    draw();
  }
  // ---- The scenario: deposit and drop share re-run every plan with model.js ----
  const shareNow = () => (S.share ? Number(S.share) / 100 : R.share);
  const cache = new Map();
  function farm(r) {
    if (!S.dep && !S.share) return r.farm;
    const k = `${r.slug}|${S.dep}|${S.share}`;
    if (!cache.has(k)) cache.set(k, S.dep ? M.farmEconomics(r, Number(S.dep), shareNow()) : M.sizePlan(r, shareNow()));
    return cache.get(k);
  }

  const chip = (v) => `<span class="v v-${v}">${v}</span>`;
  const delta = (x) => (x == null ? '<span class="dim">n/a</span>' : `<span class="${x >= 0 ? 'up' : 'dn'}">${pct(x)}</span>`);
  const delta0 = (x) => `<span class="${x >= 0 ? 'up' : 'dn'}">${usd(x)}</span>`;
  const age = (r) => (r.age === null ? '<span class="dim">n/a</span>' : r.age < 1 ? Math.round(r.age * 365) + ' d' : r.age.toFixed(1) + ' yr');
  const lo = Math.log10(Math.min(...R.ranked.map((r) => r.value.p10 * r.odds))), hi = Math.log10(Math.max(...R.ranked.map((r) => r.value.p90 * r.odds)));
  const at = (v) => ((Math.log10(v) - lo) / (hi - lo) * 100).toFixed(1);
  const band = (r) => { const v = r.value, k = r.odds; return `<span class="band"><i class="w" style="left:${at(v.p10 * k)}%;right:${100 - at(v.p90 * k)}%"></i><i class="i" style="left:${at(v.p25 * k)}%;right:${100 - at(v.p75 * k)}%"></i><b style="left:${at(r.implied)}%"></b></span>`; };
  const kv = (cls, items) => `<dl class="kv ${cls}">${items.map(([t, v]) => `<div><dt>${t}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  const bar = (p) => `<span class="ob"><i style="width:${p0(p)}"></i></span>`;

  function drawTop() {
    const farmN = R.ranked.filter((r) => farm(r).verdict === 'FARM').length;
    const tiles = [
      ['Out-of-sample miss, walk-forward', x2(m.missWf), `vs ${x2(m.flatWf)} flat`, `${m.wfCount} newest peers priced by older ones; left out ${x2(m.missLoo)} vs ${x2(m.flatLoo)}`],
      ['Is the printed range honest?', `${p0(m.honestWf.p50)} · ${p0(m.honestWf.p80)}`, 'vs 50 · 80', `newer caps inside P25–P75, P10–P90; left out ${p0(m.honestLoo.p50)} · ${p0(m.honestLoo.p80)}`],
      ['Token odds vs base rate, Brier', o.brierWf.toFixed(3), `vs ${o.brierWfBase.toFixed(3)}`, `forward on ${o.wfCount} newer protocols; 10-fold ${o.brier.toFixed(3)} vs ${o.brierBase.toFixed(3)}, AUC ${o.auc.toFixed(2)}`],
      ['Weight beyond log TVL', p0(1 - m.fits[0].weight), 'held-out', `won on both blind tests: growth ${p0(m.termWeight.growth)}, years ${p0(m.termWeight.age)}, category ${p0(m.termWeight.kind)}`],
      ['Worth farming, this scenario', `${farmN} of ${c.pre}`, `${p0(shareNow())} share`, `net beats $${M.ASSUME.hourTarget}/h after gas, fees and risk carry`],
      ['Watchlist ranked', `${c.watchRanked} / ${c.watch}`, 'all of it', `plus ${c.pre - c.watchRanked} pre-token protocols below the $50M floor`],
    ];
    $('tiles').innerHTML = tiles.map(([t, big, vs, note]) => `<div class="tile"><p class="tt">${t}</p><p class="big">${big} <small>${vs}</small></p><p class="tn">${note}</p></div>`).join('');
    const seg = [['comp', c.comp, 'Token trades · stand-alone priced peer'], ['token', c.token, 'Token recorded · no cap or not stand-alone'], ['aside', c.aside, 'Set aside · wrapped, staked, versioned, family'], ['pre', c.pre, `Ranked pre-token · ${c.watchRanked} watchlist + ${c.pre - c.watchRanked} early`]];
    $('ledger').innerHTML = `<div class="lh"><h2>Protocol accounting</h2><span>all ${c.all} snapshot protocols in exactly one group</span></div>
      <div class="bar">${seg.map(([k, n]) => `<span class="s-${k}" style="flex:${n}"></span>`).join('')}</div>
      <ul class="keys">${seg.map(([k, n, t]) => `<li><i class="s-${k}"></i>${t} <b>${n}</b></li>`).join('')}</ul>
      <ul class="checks">${CHECKS.map(([ok, t]) => `<li class="${ok ? 'ok' : 'bad'}">${t}</li>`).join('')}</ul>`;
  }

  function drawEvidence() {
    const best = Math.min(...m.fits.map((f) => f.missWf));
    const rows = m.fits.map((f) => `<tr><td>${f.id}</td><td class="n">${x2(f.missLoo)}</td><td class="n${f.missWf === best ? ' good' : ''}">${x2(f.missWf)}</td><td class="nw"><span class="wb"><i style="width:${p0(f.weight)}"></i></span>${p0(f.weight)}</td></tr>`).join('');
    const oc = o.coef;
    const H = (a) => `<td class="n">${p0(a.x3)}</td><td class="n">${p0(a.p50)}</td><td class="n">${p0(a.p80)}</td>`;
    $('evidence').innerHTML = `<div class="lh"><h2>Out-of-sample evidence</h2><span>each candidate refitted leaving each peer out, and run forward in listing order</span></div>
      <div class="ev3"><div><h3>Launch value: typical miss on ${m.peers.length} priced peers</h3>
      <table class="mini"><thead><tr><th>Model</th><th>Left out</th><th>Forward</th><th>Weight</th></tr></thead><tbody>
      <tr class="base"><td>flat median mcap/TVL</td><td class="n">${x2(m.flatLoo)}</td><td class="n">${x2(m.flatWf)}</td><td class="dim">baseline</td></tr>${rows}
      <tr class="tot"><td>blend, used</td><td class="n good">${x2(m.missLoo)}</td><td class="n good">${x2(m.missWf)}</td><td>100%</td></tr></tbody></table></div>
      <div><h3>Token odds: Brier score, ${o.n} stand-alone protocols</h3>
      <table class="mini"><thead><tr><th>Test</th><th>Model</th><th>Base rate</th></tr></thead><tbody>
      <tr><td>10-fold</td><td class="n good">${o.brier.toFixed(3)}</td><td class="n">${o.brierBase.toFixed(3)}</td></tr>
      <tr><td>forward, ${o.wfCount} newest</td><td class="n good">${o.brierWf.toFixed(3)}</td><td class="n">${o.brierWfBase.toFixed(3)}</td></tr></tbody></table>
      <p class="sm">Logit slopes: ${M.ODDS_TERMS.map((t, i) => `${t} ${oc[i + 1] >= 0 ? '+' : ''}${oc[i + 1].toFixed(2)}`).join(' · ')}; plus a category effect. ${o.tokens} of ${o.n} record a token. AUC ${o.auc.toFixed(2)}.</p></div>
      <div><h3>Is the printed range honest?</h3>
      <table class="mini"><thead><tr><th>Share of real caps</th><th>Within ×3</th><th>P25–P75</th><th>P10–P90</th></tr></thead><tbody>
      <tr><td>left out</td>${H(m.honestLoo)}</tr><tr><td>forward</td>${H(m.honestWf)}</tr><tr class="dim"><td>stated</td><td></td><td class="n">50%</td><td class="n">80%</td></tr></tbody></table>
      <p class="sm">Bootstrap (${R.boot.n} refits): size slope ${m.coef.logTVL.toFixed(2)}, 90% ${R.boot.slopeLo.toFixed(2)}–${R.boot.slopeHi.toFixed(2)}; each row's rank range is printed on the board.</p></div></div>
      <p class="formula"><b>Implied value</b> = launch value (the blend above, fitted on stand-alone protocols whose token trades) × token odds (the share of protocols like it that record a token).</p>`;
  }

  function drawTabs() {
    $('tabs').innerHTML = [['board', `Board <b>${c.pre}</b>`], ['tokens', `Token trades <b>${c.comp + c.token}</b>`], ['aside', `Set aside <b>${c.aside}</b>`]]
      .map(([k, l]) => `<button class="tab${S.tab === k ? ' on' : ''}" data-set="tab" data-val="${k}">${l}</button>`).join('') +
      `<button class="tab fold" data-set="fold" data-val="1">${S.fold ? 'Show the evidence ▾' : 'Fold the evidence ▴'}</button>`;
    document.body.classList.toggle('folded', !!S.fold);
  }

  const chains = [...R.ranked.reduce((mp, r) => { r.chains.forEach((x) => mp.set(x, (mp.get(x) || 0) + 1)); return mp; }, new Map())].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 30).map(([x]) => x);
  function inView(r) {
    const q = S.q.trim().toLowerCase();
    return (!S.tier || (S.tier === 'watch' ? r.watch : !r.watch)) && (!S.kind || r.kind === S.kind) && (!S.chain || r.chains.includes(S.chain)) &&
      (!q || (r.name + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase().includes(q));
  }
  function drawTools() {
    if (S.tab !== 'board') { $('tools').innerHTML = ''; return; }
    const base = R.ranked.filter(inView), n = (v) => base.filter((r) => farm(r).verdict === v).length;
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${S[key] === v ? 'on' : ''}" data-set="${key}" data-val="${v}">${l}</button>`).join('')}</div>`;
    const sel = (id, label, opts) => `<select id="${id}" aria-label="${label}">${opts.map(([v, l]) => `<option value="${v}"${S[id] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    $('tools').innerHTML = `<div class="row">${seg('v', [['', `All ${base.length}`], ['FARM', `Farm ${n('FARM')}`], ['MARGINAL', `Marginal ${n('MARGINAL')}`], ['SKIP', `Skip ${n('SKIP')}`]])}
      ${seg('tier', [['', 'All tiers'], ['watch', 'Watchlist'], ['early', 'Early, < $50M']])}
      <label>Deposit ${sel('dep', 'Deposit', [['', 'plan size']].concat(M.ASSUME.tiers.map((t) => [String(t), usd(t)])))}</label>
      <label>Drop share <input id="share" type="range" min="2" max="20" value="${Math.round(shareNow() * 100)}"> <b>${p0(shareNow())}</b></label>
      <label>Model sandbox ${sel('mdl', 'Value model', [['', 'blend, used'], ['tvl', 'log TVL curve only'], ['flat', 'flat multiple']])}</label></div>
      <div class="row"><input id="q" value="${esc(S.q)}" placeholder="Search name, chain, category">
      ${sel('kind', 'Kind', [['', 'All kinds']].concat(M.KINDS.map((k) => [k, KIND_LABEL[k]])))}${sel('chain', 'Chain', [['', 'All chains']].concat(chains.map((x) => [x, x])))}
      <button class="btn" data-reset>Reset</button><button class="btn" data-export="csv">CSV</button><button class="btn" data-export="json">JSON</button>
      <span class="hint">Tick rows to compare · / search · Esc close</span><span class="count" id="count"></span></div>`;
  }

  const VO = { FARM: 0, MARGINAL: 1, SKIP: 2 };
  const COLS = [['rank', '# · range', (r) => r.rank], ['name', 'Protocol', (r) => r.name.toLowerCase()], ['tvl', 'TVL', (r) => -r.tvl], ['g', '7d', (r) => -(r.change7d || 0)],
    ['age', 'No-token age', (r) => -r.ageUsed], ['odds', 'Token odds', (r) => -r.odds], ['launch', 'If it launches', (r) => -r.value.mid], ['implied', 'Implied value · P25–P75', (r) => -r.implied],
    ['verdict', 'Verdict · net of fees', (r) => VO[farm(r).verdict] * 1e9 - farm(r).hourly], ['hourly', 'Net / hour', (r) => -farm(r).hourly]];
  const shown = () => {
    const col = COLS.find((k) => k[0] === S.sort) || COLS[0], d = Number(S.dir) || 1;
    const key = S.mdl && col[0] === 'rank' ? (r) => -r.alt[S.mdl] : col[2];
    return R.ranked.filter((r) => inView(r) && (!S.v || farm(r).verdict === S.v)).sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * d; });
  };
  function drawBoard() {
    const rows = shown(), d = Number(S.dir) || 1, up = (k) => (['rank', 'name'].includes(k) ? d > 0 : d < 0);
    const ar = S.mdl ? new Map(R.ranked.slice().sort((a, b) => b.alt[S.mdl] - a.alt[S.mdl]).map((r, i) => [r.slug, i + 1])) : null, picked = S.cmp ? S.cmp.split(',') : [];
    const head = '<th class="ck"></th>' + COLS.map(([k, l]) => `<th data-sort="${k}" aria-sort="${S.sort === k ? (up(k) ? 'ascending' : 'descending') : 'none'}">${l}${S.sort === k ? (up(k) ? ' ↑' : ' ↓') : ''}</th>`).join('');
    const body = rows.map((r) => { const f = farm(r); return `<tr data-open="${r.slug}"${S.open === r.slug ? ' class="sel"' : ''}>
      <td class="ck"><input type="checkbox" data-cmp="${r.slug}"${picked.includes(r.slug) ? ' checked' : ''} aria-label="Compare ${esc(r.name)}"></td>
      <td class="rk"><b>${r.rank}</b><small>${ar ? `${S.mdl === 'tvl' ? 'curve' : 'flat'} #${ar.get(r.slug)}` : `${r.range[0]}–${r.range[1]}`}</small></td>
      <td class="pn"><b>${esc(r.name)}</b>${r.watch ? '<em class="wl">Watchlist</em>' : '<em class="ea">Early</em>'}<small>${esc(r.category)} · ${esc(r.chains[0])}${r.chains.length > 1 ? ` +${r.chains.length - 1}` : ''}</small></td>
      <td class="n">${usd(r.tvl)}</td><td class="n">${delta(r.change7d)}</td><td class="n">${age(r)}</td><td class="n">${p0(r.odds)}${bar(r.odds)}</td><td class="n">${usd(r.value.mid)}</td>
      <td class="iv"><b class="n">${usd(r.implied)}</b><small>${usd(r.value.p25 * r.odds)}–${usd(r.value.p75 * r.odds)}</small>${band(r)}</td>
      <td>${chip(f.verdict)} <b class="n ${f.net >= 0 ? 'up' : 'dn'}">${usd(f.net)}</b><small>${usd(f.expected)} drop − ${usd(f.fixed + f.carry)} costs · ${usd(f.capital)}</small></td>
      <td class="n ${f.hourly >= 0 ? '' : 'dn'}">${usd(f.hourly)}</td></tr>`; }).join('');
    const sandbox = ar ? `<p class="formula">Sandbox: rows re-ranked by ${S.mdl === 'tvl' ? 'the log TVL curve alone' : 'one flat mcap/TVL multiple'} (same token odds). ${R.ranked.filter((r) => Math.abs(ar.get(r.slug) - r.rank) > 10).length} of ${c.pre} rows move more than 10 places; the blend is used because it won both blind tests.</p>` : '';
    $('main').innerHTML = compare(picked) + sandbox + `<div class="tw"><table class="board"><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="11" class="empty">No protocol matches these filters.</td></tr>'}</tbody></table></div>`;
    const cnt = $('count');
    if (cnt) cnt.textContent = `${rows.length} of ${c.pre} rows · ${usd(rows.reduce((s, r) => s + r.tvl, 0))} TVL · ${usd(rows.reduce((s, r) => s + r.implied, 0))} implied`;
  }
  /** Side by side: the figures and plan of every ticked row. */
  function compare(slugs) {
    const rs = slugs.map((s) => bySlug.get(s)).filter((r) => r && r.rank);
    if (!rs.length) return '';
    const line = (label, fn) => `<tr><th>${label}</th>${rs.map((r) => `<td class="n">${fn(r, farm(r))}</td>`).join('')}</tr>`;
    return `<section class="cmp"><div class="lh"><h2>Compare ${rs.length}</h2><span>ticked rows, side by side</span><button class="btn" data-set="cmp" data-val="${S.cmp}">Clear</button></div><table class="mini"><thead><tr><th></th>${rs.map((r) => `<th><a data-open="${r.slug}">${esc(r.name)}</a></th>`).join('')}</tr></thead><tbody>
      ${line('Rank · bootstrap range', (r) => `${r.rank} · ${r.range[0]}–${r.range[1]}`)}${line('TVL · 7d', (r) => `${usd(r.tvl)} · ${pct(r.change7d)}`)}${line('Token odds', (r) => p0(r.odds))}
      ${line('If it launches', (r) => usd(r.value.mid))}${line('Implied value', (r) => usd(r.implied))}${line('Verdict', (r, f) => chip(f.verdict))}
      ${line('Plan', (r, f) => `${usd(f.capital)} on ${esc(f.chain)}, ${f.hold} d`)}${line('Drop − costs', (r, f) => `${usd(f.expected)} − ${usd(f.fixed + f.carry)}`)}${line('Net · per hour', (r, f) => `${usd(f.net)} · ${usd(f.hourly)}`)}</tbody></table></section>`;
  }
  function drawList(kind) {
    const rows = R.rows.filter((r) => (kind === 'aside' ? r.status === 'aside' : r.status === 'comp' || r.status === 'token')).sort((a, b) => (b.mcap || 0) - (a.mcap || 0) || b.tvl - a.tvl);
    const head = kind === 'aside' ? '<th>Protocol</th><th>TVL</th><th>Why it is set aside</th>' : '<th>Protocol</th><th>Token</th><th>TVL</th><th>Market cap</th><th>Cap / TVL</th><th>Cap ÷ held-out model</th>';
    $('main').innerHTML = `<div class="tw"><table class="board"><thead><tr>${head}</tr></thead><tbody>${rows.map((r) => `<tr data-open="${r.slug}"><td class="pn"><b>${esc(r.name)}</b><small>${esc(r.category)}</small></td>${kind === 'aside'
      ? `<td class="n">${usd(r.tvl)}</td><td class="why">${esc(r.reason)}</td>`
      : `<td>${esc(r.symbol || '')}</td><td class="n">${usd(r.tvl)}</td><td class="n">${r.mcap ? usd(r.mcap) : '<span class="dim">none</span>'}</td><td class="n">${r.mcap ? x2(r.mcap / r.tvl) : ''}</td><td class="n">${r.residual === undefined ? '<span class="dim">not a peer</span>' : x2(10 ** r.residual)}</td>`}</tr>`).join('')}</tbody></table></div>`;
  }

  function peersOf(r) {
    const same = m.peers.filter((p) => p.kind === r.kind);
    return (same.length >= 4 ? same : m.peers).slice().sort((a, b) => Math.abs(a.lt - r.lt) - Math.abs(b.lt - r.lt)).slice(0, 6);
  }
  function detail(r) {
    const head = `<button class="x" data-close aria-label="Close">×</button><p class="crumb">${r.rank ? `#${r.rank} of ${c.pre} by implied value · rank ${r.range[0]}–${r.range[1]} across ${R.boot.n} bootstrap refits` : r.status === 'aside' ? 'Set aside' : 'Token recorded'}</p>
      <h2>${esc(r.name)}</h2><p class="tags">${r.watch ? '<em class="wl">Watchlist</em>' : ''}<span>${esc(r.category)}</span><span>${KIND_LABEL[r.kind]}</span>${r.chains.slice(0, 4).map((x) => `<span>${esc(x)}</span>`).join('')}</p>
      ${kv('', [['TVL', usd(r.tvl)], ['7-day', delta(r.change7d)], ['Listed since', r.listed || 'n/a'], [r.mcap ? 'Market cap' : 'Implied value', usd(r.mcap || r.implied || r.value.mid)]])}`;
    if (r.status !== 'pre') return `<section class="card">${head}<p class="why">${esc(r.reason)}</p>${r.residual !== undefined ? `<p class="sm">The blend prices it at ${usd(r.value.mid)}; left out of the fit, its real cap is ${x2(10 ** r.residual)} the model.</p>` : ''}</section>`;
    const p = M.valueParts(r, m.coef), k = m.coef, f = farm(r), plan = f === r.farm ? r.plan : M.farmPlan(r, f, R.asOf);
    const step = (t, how, v) => `<tr><td><b>${t}</b><small>${how}</small></td><td class="n">${v}</td></tr>`;
    const deps = [...new Set([1000, 5000, 25000, f.capital])].sort((a, b) => a - b);
    const grid = [0.04, 0.08, 0.16].map((sh) => `<tr><td class="n">${p0(sh)}</td>${deps.map((C) => { const e = M.farmEconomics(r, C, sh); return `<td class="n ${e.net >= 0 ? 'up' : 'dn'}${C === f.capital && Math.abs(sh - f.share) < 1e-9 ? ' pick' : ''}">${usd(e.net)}</td>`; }).join('')}</tr>`).join('');
    return `<section class="card">${head}<div class="dg"><div>
      <h3>How the figure is made</h3><table class="mini chain"><tbody>
      ${step('Size curve', `${k.intercept.toFixed(2)} + ${k.logTVL.toFixed(3)} × log10 TVL ${r.lt.toFixed(2)}, fitted on ${m.peers.length} priced peers`, usd(10 ** p.base))}
      ${step('7-day growth', `${k.growth.toFixed(2)} × ${r.lg.toFixed(4)}; weight won held-out ${p0(m.termWeight.growth)}`, x2(10 ** p.growth))}
      ${step('Years listed', `${k.age.toFixed(3)} × ${r.ageUsed.toFixed(2)}${r.age === null ? ' (median: none reported)' : ''}; weight ${p0(m.termWeight.age)}`, x2(10 ** p.age))}
      ${step('Category · ' + KIND_LABEL[r.kind], `shrunk multiple; weight ${p0(m.termWeight.kind)}`, x2(10 ** p.kind))}
      <tr class="sub"><td><b>= Value if a token launches</b><small>P25–P75 ${usd(r.value.p25)}–${usd(r.value.p75)} · P10–P90 ${usd(r.value.p10)}–${usd(r.value.p90)}</small></td><td class="n">${usd(r.value.mid)}</td></tr>
      ${step('Token odds', `share of protocols like it (size, years, growth, kind) that record a token; forward Brier ${o.brierWf.toFixed(3)} vs ${o.brierWfBase.toFixed(3)}`, x2(r.odds))}
      <tr class="tot"><td><b>= Implied value</b><small>rank ${r.range[0]}–${r.range[1]} across ${R.boot.n} bootstrap refits</small></td><td class="n">${usd(r.implied)}</td></tr></tbody></table>
      <h3>Nearest priced peers · their tokens trade</h3><table class="mini"><thead><tr><th>Token</th><th>TVL</th><th>Market cap</th><th>Cap/TVL</th><th>Cap ÷ model</th></tr></thead><tbody>
      ${peersOf(r).map((q) => `<tr><td>${esc(q.name)} <span class="dim">${esc(q.symbol || '')}</span></td><td class="n">${usd(q.tvl)}</td><td class="n">${usd(q.mcap)}</td><td class="n">${x2(q.mcap / q.tvl)}</td><td class="n">${x2(10 ** q.residual)}</td></tr>`).join('')}</tbody></table>
      </div><div><h3>Farm verdict ${chip(f.verdict)}</h3>
      <p class="say">${f.verdict}: ${usd(f.capital)} on ${esc(f.chain)} for ${f.hold} days buys a modelled drop of ${usd(f.expected)} against ${usd(f.fixed + f.carry)} of fees and risk carry.</p>
      ${kv('k6', [['At risk', usd(f.capital)], ['Fees + carry', usd(f.fixed + f.carry)], ['Drop', usd(f.expected)], ['Net', delta0(f.net)], ['Hands-on', f.hours.toFixed(1) + ' h'], ['Net / hour', usd(f.hourly)]])}
      <p class="sm">Benchmarks: a 4% T-bill earns ${usd(f.tbill)} over ${f.hold} days · launch odds in the window ${p0(f.launch)} · break-even capital ${f.minViable === null ? 'none' : usd(f.minViable)} · exit if TVL prints below ${usd(r.tvl * 0.75)}.</p>
      <h3>Farm plan · ${plan.length - 1} steps</h3><table class="mini steps"><thead><tr><th>When</th><th>Step</th><th>Cost</th><th>Time</th></tr></thead><tbody>
      ${plan.map((s) => (s.cost === null ? '' : `<tr><td class="when">${s.when}</td><td><b>${s.step}</b> ${esc(s.text.slice(s.text.indexOf(': ') + 2).replace(/ Cost [^,]*, about [^.]*\.$/, ''))}</td><td class="n">${s.cost > 0 && s.cost < 1 ? '$' + s.cost.toFixed(2) : usd(s.cost)}</td><td class="n">${s.minutes}m</td></tr>`)).join('')}
      <tr class="tot"><td></td><td>All in: net ${usd(f.net)} (P25 ${usd(f.netLo)}, P75 ${usd(f.netHi)})</td><td class="n">${usd(f.fixed + f.carry)}</td><td class="n">${f.hours.toFixed(1)}h</td></tr></tbody></table>
      <h3>Drop share × deposit: net of fees</h3><table class="mini grid"><thead><tr><th>Share</th>${deps.map((C) => `<th>${C === f.capital ? 'plan ' : ''}${usd(C)}</th>`).join('')}</tr></thead><tbody>${grid}</tbody></table></div></div></section>`;
  }

  function exportView(kind) {
    const rows = shown().map((r) => { const f = farm(r); return { rank: r.rank, slug: r.slug, name: r.name, tvl_usd: r.tvl, change_7d: r.change7d, token_odds: +r.odds.toFixed(4), launch_value_usd: Math.round(r.value.mid), implied_value_usd: r.implied, verdict: f.verdict, capital_usd: f.capital, net_usd: Math.round(f.net), hours: +f.hours.toFixed(2) }; });
    const text = kind === 'json' ? JSON.stringify(rows, null, 1) : [Object.keys(rows[0] || {}).join(',')].concat(rows.map((r) => Object.values(r).map((v) => (typeof v === 'string' && /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(','))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: kind === 'json' ? 'application/json' : 'text/csv' }));
    a.download = `pre-token-radar.${kind}`;
    a.click();
  }

  function draw() {
    $('src').innerHTML = `DefiLlama snapshot <b>${R.asOf}</b> · ${c.all} protocols · refitted in this browser, no network`;
    drawTop(); drawEvidence(); drawTabs(); drawTools();
    if (S.tab === 'board') drawBoard(); else drawList(S.tab);
    const r = S.open && bySlug.get(S.open);
    $('detail').innerHTML = r ? detail(r) : '';
    document.body.classList.toggle('open', !!r);
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-cmp],[data-set],[data-sort],[data-open],[data-close],[data-reset],[data-export]');
    if (!t) return;
    const d = t.dataset;
    if (d.cmp) { const l = S.cmp ? S.cmp.split(',') : [], i = l.indexOf(d.cmp); if (i >= 0) l.splice(i, 1); else l.push(d.cmp); set({ cmp: l.slice(-4).join(',') }); }
    else if (d.set) set({ [d.set]: S[d.set] === d.val && d.set !== 'tab' ? '' : d.val, open: d.set === 'tab' ? '' : S.open });
    else if (d.sort) set({ sort: d.sort, dir: S.sort === d.sort ? String(-Number(S.dir)) : '1' });
    else if (d.open) set({ open: d.open });
    else if (d.close !== undefined) set({ open: '' });
    else if (d.reset !== undefined) set({ ...DEF });
    else exportView(d.export);
  });
  document.addEventListener('input', (ev) => { if (ev.target.id === 'q') { S.q = ev.target.value; drawBoard(); } if (ev.target.id === 'share') set({ share: ev.target.value }); });
  document.addEventListener('change', (ev) => { if (['dep', 'kind', 'chain', 'q', 'mdl'].includes(ev.target.id)) set({ [ev.target.id]: ev.target.value }); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && S.open) set({ open: '' });
    if (ev.key === '/' && ev.target.tagName !== 'INPUT' && $('q')) { ev.preventDefault(); $('q').focus(); }
  });
  window.addEventListener('hashchange', () => { readHash(); draw(); });
  readHash();
  draw();
})();
