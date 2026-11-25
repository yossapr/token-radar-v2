/* The page: rebuilds the radar from the raw snapshot with model.js, checks it against board.json, and draws
 * the board, the priced peers, the set-asides and the method. State lives in the address hash, so every view
 * (a filter, a sort, an open detail) is a link. No framework, no network. */
(function () {
  'use strict';
  const M = window.RadarModel, input = window.RADAR_INPUT;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  if (!M || !input) { $('main').textContent = 'model.js or data.js is missing: run main.ts first.'; return; }
  const { usd, pct } = M;

  const R = M.buildRadar(input.snapshot);
  const bySlug = new Map(R.rows.map((r) => [r.slug, r]));
  const comps = R.rows.filter((r) => r.status === 'comp');

  // ---- Integrity: the board this page rebuilt against the board main.ts wrote ----
  const integrity = (() => {
    let same = 0;
    input.board.forEach(([slug, rank, value, verdict]) => {
      const r = bySlug.get(slug);
      if (r && r.rank === rank && Math.abs(r.implied - value) <= 1 && r.farm.verdict === verdict) same++;
    });
    return { same, total: input.board.length, ok: same === input.board.length && input.board.length === R.ranked.length };
  })();

  // ---- State in the hash ----
  const DEF = { tab: 'board', q: '', kind: '', verdict: '', chain: '', watch: '', sort: 'rank', dir: '1', detail: '', cap: '', share: '' };
  let S = { ...DEF };
  function readHash() {
    S = { ...DEF };
    new URLSearchParams(location.hash.slice(1)).forEach((v, k) => { if (k in S) S[k] = v; });
  }
  function set(patch) {
    S = { ...S, ...patch };
    const p = new URLSearchParams();
    Object.keys(S).forEach((k) => { if (S[k] !== DEF[k]) p.set(k, S[k]); });
    history.replaceState(null, '', '#' + p.toString());
    draw();
  }
  const share = () => (S.share ? Number(S.share) / 100 : R.share);

  // ---- Small pieces ----
  const chip = (v) => `<span class="v v-${v}">${v}</span>`;
  const kindLabel = (k) => M.KIND_LABEL[k];
  const years = (r) => (r.age === null ? '<span class="dim">n/a</span>' : r.age.toFixed(1) + 'y');
  const delta = (x) => (x == null ? '<span class="dim">n/a</span>' : `<span class="${x >= 0 ? 'up' : 'dn'}">${pct(x)}</span>`);
  const lo = Math.log10(Math.min(...R.ranked.map((r) => r.value.p10))), hi = Math.log10(Math.max(...R.ranked.map((r) => r.value.p90)));
  const pos = (v) => ((Math.log10(v) - lo) / (hi - lo)) * 100;
  function band(r) {
    const v = r.value;
    return `<span class="band" title="P10 ${usd(v.p10)} · P25 ${usd(v.p25)} · P75 ${usd(v.p75)} · P90 ${usd(v.p90)}">` +
      `<i class="w" style="left:${pos(v.p10)}%;width:${pos(v.p90) - pos(v.p10)}%"></i><i class="i" style="left:${pos(v.p25)}%;width:${pos(v.p75) - pos(v.p25)}%"></i><b style="left:${pos(v.mid)}%"></b></span>`;
  }

  // ---- Ledger: where all 758 went ----
  function drawLedger() {
    const c = R.counts, seg = [['comp', c.comp, 'priced peers: token trades, fit the value model'], ['token', c.token, 'token recorded, no market cap'], ['aside', c.aside, 'set aside: wrapped, staked, bridged, versions, families'], ['pre', c.pre, 'pre-token, ranked']];
    $('ledger').innerHTML = `<div class="bar">${seg.map(([k, n, t]) => `<span class="s-${k}" style="flex:${n}" title="${t}"></span>`).join('')}</div>
      <ul class="keys">${seg.map(([k, n, t]) => `<li><i class="s-${k}"></i><b>${n}</b> ${t}</li>`).join('')}<li class="tot"><b>${c.all}</b> protocols in the snapshot, every one placed</li></ul>
      <ul class="checks"><li class="ok">Watchlist ${c.watchRanked}/${c.watch} ranked</li>
      <li class="${integrity.ok ? 'ok' : 'bad'}">Rebuilt in this page: ${integrity.same}/${integrity.total} ranks, values and verdicts match board.json</li>
      <li class="ok">Value model held-out RMS ${R.model.rmsLoo.toFixed(2)} (LOO) vs ${R.model.rmsFlat.toFixed(2)} for a flat multiple</li></ul>`;
  }

  function drawTabs() {
    const t = [['board', `Board <b>${R.counts.pre}</b>`], ['tokens', `Token trades <b>${R.counts.comp + R.counts.token}</b>`], ['aside', `Set aside <b>${R.counts.aside}</b>`], ['method', 'Method & proof']];
    $('tabs').innerHTML = t.map(([k, l]) => `<button class="tab${S.tab === k ? ' on' : ''}" data-tab="${k}" aria-pressed="${S.tab === k}">${l}</button>`).join('');
  }

  // ---- Filters ----
  const chains = (() => {
    const n = new Map();
    R.ranked.forEach((r) => r.chains.forEach((c) => n.set(c, (n.get(c) || 0) + 1)));
    return [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 24).map(([c]) => c);
  })();
  function drawFilters() {
    if (S.tab !== 'board') { $('filters').innerHTML = ''; return; }
    const kinds = M.KINDS.filter((k) => R.ranked.some((r) => r.kind === k));
    const btn = (key, val, label) => `<button class="f${S[key] === val ? ' on' : ''}" data-set="${key}" data-val="${val}">${label}</button>`;
    $('filters').innerHTML = `<label class="q"><span>Search</span><input id="q" value="${esc(S.q)}" placeholder="name, category or chain"></label>
      <div class="grp"><span>Kind</span>${btn('kind', '', 'All')}${kinds.map((k) => btn('kind', k, kindLabel(k))).join('')}</div>
      <div class="grp"><span>Verdict</span>${btn('verdict', '', 'All')}${['FARM', 'MARGINAL', 'SKIP'].map((v) => btn('verdict', v, v)).join('')}</div>
      <label class="sel"><span>Chain</span><select id="chain"><option value="">All chains</option>${chains.map((c) => `<option${S.chain === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <div class="grp">${btn('watch', S.watch ? '' : '1', S.watch ? 'Watchlist only ✓' : 'Watchlist only')}</div>`;
  }
  function filtered() {
    const q = S.q.trim().toLowerCase();
    return R.ranked.filter((r) => (!S.kind || r.kind === S.kind) && (!S.verdict || r.farm.verdict === S.verdict) &&
      (!S.chain || r.chains.includes(S.chain)) && (!S.watch || r.watch) &&
      (!q || (r.name + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase().includes(q)));
  }

  // ---- Board ----
  const VORDER = { FARM: 0, MARGINAL: 1, SKIP: 2 };
  const COLS = [
    ['rank', '#', (r) => r.rank], ['name', 'Protocol', (r) => r.name.toLowerCase()], ['tvl', 'TVL', (r) => -r.tvl],
    ['g', '7d', (r) => -(r.change7d || 0)], ['age', 'On record', (r) => -(r.age === null ? -1 : r.age)],
    ['value', 'Implied value · P10–P90', (r) => -r.value.mid], ['odds', 'Odds', (r) => -r.odds],
    ['verdict', 'Farm', (r) => VORDER[r.farm.verdict] * 1e9 - r.farm.hourly], ['hourly', 'Net / hour', (r) => -r.farm.hourly], ['cap', 'Plan', (r) => r.farm.capital],
  ];
  function drawBoard() {
    const col = COLS.find((c) => c[0] === S.sort) || COLS[0], dir = Number(S.dir) || 1;
    const rows = filtered().sort((a, b) => { const x = col[2](a), y = col[2](b); return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * dir; });
    const sumV = rows.reduce((s, r) => s + r.implied, 0);
    // Rank, name and plan size read low to high; every other column puts its largest first.
    const up = (k) => (['rank', 'name', 'cap'].includes(k) ? dir > 0 : dir < 0);
    const head = COLS.map(([k, l]) => `<th data-sort="${k}" aria-sort="${S.sort === k ? (up(k) ? 'ascending' : 'descending') : 'none'}" class="c-${k}">${l}${S.sort === k ? (up(k) ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const body = rows.map((r) => `<tr data-open="${r.slug}" class="${S.detail === r.slug ? 'sel' : ''}">
      <td class="c-rank">${r.rank}</td>
      <td class="c-name"><b>${esc(r.name)}</b>${r.watch ? '<em class="wl">watchlist</em>' : ''}<small>${esc(r.category)} · ${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</small></td>
      <td class="n">${usd(r.tvl)}</td><td class="n">${delta(r.change7d)}</td><td class="n">${years(r)}</td>
      <td class="c-value"><b class="n">${usd(r.implied)}</b>${band(r)}</td>
      <td class="n">${(r.odds * 100).toFixed(0)}%</td><td>${chip(r.farm.verdict)}</td>
      <td class="n ${r.farm.hourly >= 0 ? '' : 'dn'}">${usd(r.farm.hourly)}</td><td class="n">${usd(r.farm.capital)}</td></tr>`).join('');
    const note = S.watch || S.kind || S.verdict || S.chain || S.q ? `Filtered: ${rows.length} of ${R.counts.pre}` : `All ${rows.length} pre-token protocols`;
    $('main').innerHTML = `<div class="cap"><h2>${note}</h2><p>Ranked by implied value, the token's worth if the record stayed as it is. Sum shown: ${usd(sumV)}. Click a header to sort, a row for its detail and farm plan.</p></div>
      <div class="tw"><table class="board"><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="10" class="empty">No protocol matches these filters.</td></tr>'}</tbody></table></div>`;
  }

  // ---- Token trades and set-asides ----
  function drawTokens() {
    const rows = R.rows.filter((r) => r.status === 'comp' || r.status === 'token').sort((a, b) => (b.mcap || 0) - (a.mcap || 0) || b.tvl - a.tvl);
    $('main').innerHTML = `<div class="cap"><h2>Tokens that already trade: not ranked</h2><p>${R.counts.comp} carry a market cap and price the value model; ${R.counts.token} record a token with no market cap. Held-out miss: how far the fit, refitted without this peer, lands from its real market cap.</p></div>
      <div class="tw"><table class="board"><thead><tr><th>Protocol</th><th>Token</th><th>TVL</th><th>Market cap</th><th>Mcap / TVL</th><th>Held-out miss</th></tr></thead><tbody>${rows.map((r) => `<tr data-open="${r.slug}">
      <td class="c-name"><b>${esc(r.name)}</b><small>${esc(r.category)}</small></td><td>${esc(r.symbol || '')}</td><td class="n">${usd(r.tvl)}</td>
      <td class="n">${r.mcap ? usd(r.mcap) : '<span class="dim">none recorded</span>'}</td><td class="n">${r.mcap ? (r.mcap / r.tvl).toFixed(2) + 'x' : ''}</td>
      <td class="n">${r.residual === undefined ? '' : `<span class="${r.residual >= 0 ? 'up' : 'dn'}">x${(10 ** Math.abs(r.residual)).toFixed(1)} ${r.residual >= 0 ? 'above' : 'below'}</span>`}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function drawAside() {
    const rows = R.rows.filter((r) => r.status === 'aside').sort((a, b) => b.tvl - a.tvl);
    $('main').innerHTML = `<div class="cap"><h2>Set aside: no token recorded, but not a launch of its own</h2><p>Each carries the rule that set it aside. A version, wrapper, staked or bridged product, or a family member of a token that trades, would not launch a token worth farming on its own record.</p></div>
      <div class="tw"><table class="board"><thead><tr><th>Protocol</th><th>TVL</th><th>Why it is set aside</th></tr></thead><tbody>${rows.map((r) => `<tr data-open="${r.slug}"><td class="c-name"><b>${esc(r.name)}</b><small>${esc(r.category)}</small></td><td class="n">${usd(r.tvl)}</td><td class="why">${esc(r.reason)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ---- Method & proof ----
  function proof(full) {
    const m = R.model, o = R.odds, c = m.coef;
    const fits = m.fits.slice().sort((a, b) => b.weight - a.weight);
    const best = Math.min(...m.fits.map((f) => f.rmsLoo));
    const kinds = M.KINDS.map((k) => `${kindLabel(k)} ${c['k_' + k] >= 0 ? '+' : ''}${c['k_' + k].toFixed(2)}`).join(' · ');
    const terms = Object.values(m.termEffect).map((t) => `<li><b>${t.label}</b> carries ${(t.weight * 100).toFixed(0)}% of the evidence weight</li>`).join('');
    return `<section class="card proof"><h3>Value model: fitted, then tested blind twice</h3>
      <p class="eq">log10 value = ${c.intercept.toFixed(2)} + ${c.logTVL.toFixed(3)}·log10 TVL ${c.growth >= 0 ? '+' : '−'} ${Math.abs(c.growth).toFixed(2)}·growth ${c.age >= 0 ? '+' : '−'} ${Math.abs(c.age).toFixed(3)}·years + category</p>
      <p class="sm">Fitted on ${m.peers} protocols whose token trades. Six candidate models, each refitted ${m.peers} times leaving one peer out and run forward in listing order on the ${m.wfCount} newest; each earns weight from its held-out log score on both tests. No weight is set by hand.</p>
      <table class="mini"><thead><tr><th>Model</th><th>RMS LOO</th><th>RMS fwd</th><th>Weight</th></tr></thead><tbody>${fits.map((f) => `<tr><td>${esc(f.id)}</td><td class="n${f.rmsLoo === best ? ' best' : ''}">${f.rmsLoo.toFixed(3)}</td><td class="n">${f.rmsWf.toFixed(3)}</td><td class="nw"><span class="wbar"><i style="width:${(f.weight * 100).toFixed(1)}%"></i></span>${(f.weight * 100).toFixed(0)}%</td></tr>`).join('')}
      <tr class="tot"><td>Blend (used)</td><td class="n best">${m.rmsLoo.toFixed(3)}</td><td class="n best">${m.rmsWf.toFixed(3)}</td><td>100%</td></tr>
      <tr><td>Flat mcap/TVL multiple</td><td class="n">${m.rmsFlat.toFixed(3)}</td><td></td><td></td></tr></tbody></table>
      <ul class="facts"><li>Median held-out miss x${m.looMiss.toFixed(2)} (LOO), x${m.wfMiss.toFixed(2)} (forward); rank correlation ${m.spearman.toFixed(2)}</li>
      <li>P25–P75 band covers ${(m.coverage50 * 100).toFixed(0)}% of forward peers (honest: 50%); P10–P90 covers ${(m.coverage80 * 100).toFixed(0)}% (honest: 80%)</li>
      <li>Token odds: logistic on TVL, years, growth and kind over ${o.n} protocols; 10-fold AUC ${o.auc.toFixed(2)}</li>${full ? terms : ''}</ul>
      ${full ? `<p class="sm">Category multiples (log10): ${kinds}.</p>` : ''}</section>`;
  }
  function assumptions() {
    const A = M.ASSUME;
    return `<section class="card"><h3>Stated assumptions (not fitted)</h3><ul class="facts">
      <li>Farmers share ${(A.airdropShare * 100).toFixed(0)}% of the token's value, pro rata to deposits; change it in any detail view</li>
      <li>FARM needs ${usd(A.hourTarget)}/hour of your time and a positive net even at the P25 value</li>
      <li>Gas per transaction: Ethereum $${A.gas.Ethereum}, rollups $${A.gasL2}, Solana $${A.gas.Solana}, other chains $${A.gasOther}; the plan uses the cheapest chain a protocol runs on</li>
      <li>Risk carry a year: ${Object.entries(A.riskApr).map(([k, v]) => `${kindLabel(k)} ${(v * 100).toFixed(1)}%`).join(', ')}; +${(A.youngExtra * 100).toFixed(1)}% under six months on record</li>
      <li>Hold 180 days under a year on record, 120 under two, 90 beyond; launch odds in the window from the odds model's hazard</li>
      <li>Your pool share dilutes by a month of this week's inflow (shrinking pools count as they are)</li></ul></section>`;
  }
  function drawMethod() { $('main').innerHTML = `<div class="two">${proof(true)}${assumptions()}</div>`; }

  // ---- Detail ----
  function peersOf(r) {
    const same = comps.filter((p) => p.kind === r.kind);
    return (same.length >= 3 ? same : comps).slice().sort((a, b) => Math.abs(a.lt - r.lt) - Math.abs(b.lt - r.lt)).slice(0, 4);
  }
  /** Every priced peer (log TVL against log market cap), the fitted base line, and this protocol with its band. */
  function scatter(r) {
    const W = 400, H = 190, P = 28, c = R.model.coef;
    const xs = comps.map((q) => q.lt).concat(r.lt), ys = comps.map((q) => Math.log10(q.mcap)).concat(Math.log10(r.value.p10), Math.log10(r.value.p90));
    const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs)), y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
    const X = (v) => P + ((v - x0) / (x1 - x0)) * (W - P - 6), Y = (v) => H - 18 - ((v - y0) / (y1 - y0)) * (H - 26);
    const grid = [];
    for (let v = x0; v <= x1; v++) grid.push(`<text x="${X(v)}" y="${H - 4}">${usd(10 ** v)}</text>`);
    for (let v = y0; v <= y1; v += 2) grid.push(`<line x1="${P}" x2="${W - 6}" y1="${Y(v)}" y2="${Y(v)}"/><text x="2" y="${Y(v) + 3}">${usd(10 ** v)}</text>`);
    const base = (v) => c.intercept + c.logTVL * v + c.age * r.ageUsed;
    return `<h3>Where it sits among the priced peers</h3><svg class="sc" viewBox="0 0 ${W} ${H}" role="img" aria-label="Priced peers: TVL against market cap, with this protocol's implied value">
      <g class="g">${grid.join('')}</g>${comps.map((q) => `<circle class="${q.kind === r.kind ? 'k' : ''}" cx="${X(q.lt).toFixed(1)}" cy="${Y(Math.log10(q.mcap)).toFixed(1)}" r="2.6"/>`).join('')}
      <line class="fit" x1="${X(x0)}" y1="${Y(base(x0))}" x2="${X(x1)}" y2="${Y(base(x1))}"/>
      <line class="me" x1="${X(r.lt)}" x2="${X(r.lt)}" y1="${Y(Math.log10(r.value.p10))}" y2="${Y(Math.log10(r.value.p90))}"/><circle class="me" cx="${X(r.lt)}" cy="${Y(r.value.log)}" r="5"/></svg>
      <p class="sm">Dots: ${comps.length} tokens that trade (dark: same kind). Line: the TVL base of the fit. Ring: ${esc(r.name)} at ${usd(r.value.mid)}, bar P10–P90.</p>`;
  }
  function detail(r) {
    const head = `<div class="dh"><button class="x" data-close aria-label="Close">×</button><p class="kicker">${r.rank ? `Rank ${r.rank} of ${R.counts.pre}` : r.status === 'aside' ? 'Set aside' : 'Token trades'}${r.watch ? ' · on the watchlist' : ''}</p>
      <h2>${esc(r.name)}</h2><p class="sm">${esc(r.category)} · ${esc(kindLabel(r.kind))} · ${esc(r.chains.join(', '))}</p></div>
      <dl class="kv"><div><dt>TVL</dt><dd>${usd(r.tvl)}</dd></div><div><dt>7-day</dt><dd>${delta(r.change7d)}</dd></div><div><dt>On record</dt><dd>${years(r)}</dd></div>
      <div><dt>${r.mcap ? 'Market cap' : 'Implied value'}</dt><dd>${usd(r.mcap || r.value.mid)}</dd></div></dl>`;
    if (r.status !== 'pre') return `<section class="card detail">${head}<p class="why">${esc(r.reason)}</p>${r.residual !== undefined ? `<p class="sm">The fit puts it at ${usd(r.value.mid)}; left out of the fit it misses by x${(10 ** Math.abs(r.residual)).toFixed(1)}.</p>` : ''}</section>`;
    const p = r.parts, v = r.value, c = R.model.coef;
    const term = (label, how, x, base) => `<tr><td>${label}</td><td class="sm">${how}</td><td class="n">${base ? '' : x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(3)}</td><td class="n">${base ? usd(10 ** x) : 'x' + (10 ** x).toFixed(2)}</td></tr>`;
    const capital = S.cap ? Number(S.cap) : r.farm.capital;
    const e = S.cap || S.share ? M.planAt(r, capital, share()) : r.farm;
    const plan = S.cap || S.share ? M.farmPlan(r, e, R.asOf, share()) : r.plan;
    const tiers = M.ASSUME.tiers;
    return `<section class="card detail">${head}<div class="dgrid"><div>
      <h3>Implied value, term by term</h3>
      <table class="mini eqt"><tbody>${term('Base', `${c.intercept.toFixed(2)} + ${c.logTVL.toFixed(3)} × log10 TVL ${r.lt.toFixed(2)}`, p.base, true)}${term('7-day growth', `${c.growth.toFixed(2)} × ${r.lg.toFixed(4)}`, p.growth)}
      ${term('Years on record', `${c.age.toFixed(3)} × ${r.ageUsed.toFixed(2)}${r.age === null ? ' (median: not reported)' : ''}`, p.age)}${term('Category', kindLabel(r.kind), p.kind)}
      <tr class="tot"><td>Implied value</td><td class="sm">10^${v.log.toFixed(3)}</td><td class="n" colspan="2">${usd(v.mid)}</td></tr></tbody></table>
      <p class="sm">Held-out band: P10 ${usd(v.p10)} · P25 ${usd(v.p25)} · P75 ${usd(v.p75)} · P90 ${usd(v.p90)}. Token odds ${(r.odds * 100).toFixed(0)}% (peers like it that record a token); ${(e.launch * 100).toFixed(0)}% in this plan's window.</p>
      <p class="sm">Nearest priced peers: ${peersOf(r).map((q) => `${esc(q.name)} ${usd(q.tvl)} TVL → ${usd(q.mcap)}`).join(' · ')}</p>
      ${scatter(r)}</div><div><h3>Farm plan ${chip(e.verdict)}</h3>
      <div class="ctl"><label>Capital <select id="cap">${tiers.map((t) => `<option value="${t}"${t === capital ? ' selected' : ''}>${usd(t)}</option>`).join('')}</select></label>
      <label>Farmer share <input id="share" type="range" min="2" max="20" step="1" value="${Math.round(share() * 100)}"> ${Math.round(share() * 100)}%</label></div>
      <table class="mini steps"><thead><tr><th>Step</th><th>Cost</th><th>Time</th></tr></thead><tbody>${plan.map((s, i) => `<tr><td><b>${i + 1}. ${esc(s.step)}</b> ${esc(s.text.startsWith(s.step + ': ') ? s.text.slice(s.step.length + 2) : s.text)}</td><td class="n">${s.cost === null ? '' : s.cost < 1 && s.cost > 0 ? '$' + s.cost.toFixed(2) : usd(s.cost)}</td><td class="n">${s.minutes === null ? '' : s.minutes + 'm'}</td></tr>`).join('')}
      <tr class="tot"><td>Net ${usd(e.net)} (P25 ${usd(e.netLo)}, P75 ${usd(e.netHi)}) · ${usd(e.hourly)}/hour</td><td class="n">${usd(e.fixed + e.carry)}</td><td class="n">${e.hours.toFixed(1)}h</td></tr></tbody></table></div></div></section>`;
  }

  // ---- Draw ----
  function draw() {
    $('src').textContent = `Snapshot ${R.asOf} · ${R.source} · watchlist floor ${usd(R.floor)}`;
    drawLedger(); drawTabs(); drawFilters();
    ({ board: drawBoard, tokens: drawTokens, aside: drawAside, method: drawMethod }[S.tab] || drawBoard)();
    const r = S.detail && bySlug.get(S.detail);
    const filtering = S.tab === 'board' && (S.watch || S.kind || S.verdict || S.chain || S.q);
    $('rail').innerHTML = r ? detail(r) : S.tab === 'method' ? assumptionsShort() : filtering ? thisView() + proof(false) : proof(false) + assumptionsShort();
    document.body.classList.toggle('has-detail', !!r);
  }
  /** What the current filter holds: verdicts, value, odds and its best plans. */
  function thisView() {
    const rows = filtered(), n = rows.length || 1;
    const by = (v) => rows.filter((r) => r.farm.verdict === v).length;
    const best = rows.filter((r) => r.farm.net > 0).sort((a, b) => b.farm.hourly - a.farm.hourly).slice(0, 5);
    const odds = M.quantile(rows.map((r) => r.odds).sort((a, b) => a - b), 0.5);
    return `<section class="card"><h3>This view: ${rows.length} protocols</h3>
      <dl class="kv"><div><dt>FARM</dt><dd>${by('FARM')}</dd></div><div><dt>MARGINAL</dt><dd>${by('MARGINAL')}</dd></div><div><dt>SKIP</dt><dd>${by('SKIP')}</dd></div><div><dt>Median odds</dt><dd>${(odds * 100).toFixed(0)}%</dd></div></dl>
      <p class="sm">Implied value in view ${usd(rows.reduce((s, r) => s + r.implied, 0))}; median TVL ${usd(M.quantile(rows.map((r) => r.tvl).sort((a, b) => a - b), 0.5))}. ${(by('SKIP') / n * 100).toFixed(0)}% are SKIP: in a pool this size a farmer's pro-rata share of the drop is smaller than the risk carry.</p>
      <ol class="facts">${best.map((r) => `<li><a data-open="${r.slug}">${esc(r.name)}</a>: ${usd(r.farm.capital)} on ${esc(r.farm.chain)} for ${r.farm.hold} days, net ${usd(r.farm.net)} in ${r.farm.hours.toFixed(1)} h = ${usd(r.farm.hourly)}/h</li>`).join('') || '<li>No plan in this view clears its costs.</li>'}</ol></section>`;
  }
  function assumptionsShort() {
    const top = R.ranked.filter((r) => r.farm.verdict === 'FARM').sort((a, b) => b.farm.hourly - a.farm.hourly).slice(0, 6);
    return `<section class="card"><h3>Best plans by net per hour</h3><ol class="facts">${top.map((r) => `<li><a data-open="${r.slug}">${esc(r.name)}</a>: ${usd(r.farm.capital)} for ${r.farm.hold} days, net ${usd(r.farm.net)} = ${usd(r.farm.hourly)}/h</li>`).join('')}</ol></section>`;
  }

  // ---- Events ----
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-tab],[data-set],[data-sort],[data-open],[data-close]');
    if (!t) return;
    if (t.dataset.tab) set({ tab: t.dataset.tab, detail: '' });
    else if (t.dataset.set) set({ [t.dataset.set]: t.dataset.val });
    else if (t.dataset.sort) set({ sort: t.dataset.sort, dir: S.sort === t.dataset.sort ? String(-Number(S.dir)) : '1' });
    else if (t.dataset.open) set({ detail: t.dataset.open, cap: '', share: S.share });
    else set({ detail: '', cap: '' });
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'q') { S.q = ev.target.value; drawBoard(); }
    if (ev.target.id === 'share') set({ share: ev.target.value });
  });
  document.addEventListener('change', (ev) => {
    if (ev.target.id === 'chain') set({ chain: ev.target.value });
    if (ev.target.id === 'cap') set({ cap: ev.target.value });
    if (ev.target.id === 'q') set({ q: ev.target.value });
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && S.detail) set({ detail: '', cap: '' }); });
  window.addEventListener('hashchange', () => { readHash(); draw(); });
  readHash();
  draw();
})();
