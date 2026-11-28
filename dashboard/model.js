/* Pre-token radar model. main.ts runs it in Node to write board.json; the page runs the same file, rebuilds the
 * board from the raw snapshot and checks it against board.json. No protocol is named: every figure comes from the
 * snapshot or a stated assumption. */
(function (root) {
  'use strict';

  // ---------- 1. Place every protocol ----------
  const SET_ASIDE = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
  const VERSION_MARK = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  const DERIVATIVE_WORD = /\b(wrapped|staked|staking)\b/i;
  /** DefiLlama category -> farming kind (the playbook and the category term). Unlisted categories are infra. */
  const KIND_OF = {};
  [['vault', 'Risk Curators|Onchain Capital Allocator|Liquidity Manager|Yield Aggregator|Indexes|Leveraged Farming|Farm'],
    ['lend', 'Lending|CDP|CDP Manager|Uncollateralized Lending|Collateral Management'], ['dex', 'Dexs'],
    ['perp', 'Derivatives|Options|Synthetics|Prediction Market'],
    ['yield', 'Yield|Basis Trading|Dual-Token Stablecoin|Algo-Stables|Stablecoin Wrapper|Anchor BTC|CeDeFi'], ['rwa', 'RWA'],
    ['stake', 'Restaking|Staking Pool|Collateral Markets|Decentralized BTC|Governance Incentives|Liquid Staking|Liquid Restaking|Restaked BTC'],
  ].forEach(([k, cats]) => cats.split('|').forEach((c) => { KIND_OF[c] = k; }));
  const KINDS = ['vault', 'lend', 'dex', 'perp', 'yield', 'rwa', 'stake', 'infra'];
  const KIND_LABEL = { vault: 'Vault / curator', lend: 'Lending', dex: 'DEX', perp: 'Perps & markets', yield: 'Yield & stables', rwa: 'RWA', stake: 'Staking', infra: 'Infra & chain' };
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const years = (from, to) => (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5 / 365.25;
  /** 7-day change in per cent, clipped to +-40% so one spike cannot run a fit, as log10 of the growth factor. */
  const growthTerm = (g) => Math.log10(1 + clamp(g == null ? 0 : g, -40, 40) / 100);

  function classify(p, ctx) {
    if (p.gecko_id !== null || p.symbol !== null) {
      const t = p.symbol || p.gecko_id;
      if (!(p.mcap_usd > 0)) return ['token', `records token ${t} with no market cap: a token exists, so not pre-token`];
      return SET_ASIDE.includes(p.category) ? ['token', `token ${t} trades, but a ${p.category} product is not a stand-alone peer`]
        : ['comp', `token ${t} trades at a recorded market cap: a stand-alone priced peer for the fit`];
    }
    if (ctx.watch.has(p.slug)) return ['pre', 'on the house watchlist: no token recorded, no parent'];
    if (SET_ASIDE.includes(p.category)) return ['aside', `category ${p.category}: a wrapped, staked or bridged product, not a launch`];
    if (VERSION_MARK.test(p.name)) return ['aside', 'name ends in a version marker: a later version of a protocol already counted'];
    if (DERIVATIVE_WORD.test(p.name)) return ['aside', 'name says wrapped, staked or staking: a derivative of another asset'];
    if (EXCHANGES.some((x) => p.name.startsWith(x))) return ['aside', 'name begins with an exchange: an exchange product'];
    if (p.tvl_usd >= ctx.floor) return ['pre', 'off-list: above the floor and passes the name rules; the house list leaves it out because DefiLlama names a parent, so it is ranked and tagged'];
    const head = p.name.split(' ')[0].toLowerCase();
    if (head.length >= 3 && ctx.heads.has(head)) return ['aside', `shares its first word with ${ctx.heads.get(head)}, whose token is recorded: a family product`];
    return ['pre', 'below the floor, no token recorded, passes every derivative rule'];
  }

  function prepare(snap) {
    const watch = new Set(snap.watchlist), heads = new Map();
    for (const p of snap.protocols) if (p.gecko_id !== null || p.symbol !== null) {
      const h = p.name.split(' ')[0].toLowerCase();
      if (!heads.has(h)) heads.set(h, p.name);
    }
    const ages = sortNum(snap.protocols.filter((p) => p.listed_at).map((p) => years(p.listed_at, snap.as_of)));
    const medAge = quantile(ages, 0.5), ctx = { watch, heads, floor: snap.floor_usd };
    return snap.protocols.map((p) => {
      const [status, reason] = classify(p, ctx), age = p.listed_at ? years(p.listed_at, snap.as_of) : null;
      return { slug: p.slug, name: p.name, category: p.category || 'Uncategorised', kind: KIND_OF[p.category] || 'infra', chains: p.chains,
        tvl: p.tvl_usd, change7d: p.change_7d, mcap: p.mcap_usd, symbol: p.symbol, listed: p.listed_at, age,
        ageUsed: age === null ? medAge : age, watch: watch.has(p.slug), tier: watch.has(p.slug) ? 'watch' : p.tvl_usd >= snap.floor_usd ? 'off' : 'early', status, reason, lt: Math.log10(p.tvl_usd), lg: growthTerm(p.change_7d) };
    });
  }

  // ---------- 2. Numerics ----------
  function solve(A, b) { // Gaussian elimination with partial pivoting
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
    return x;
  }
  /** Ridge least squares: minimise |y - Xb|^2 + sum(pen_j b_j^2). */
  function fitRidge(X, y, pen) {
    const p = pen.length, A = pen.map(() => new Array(p).fill(0)), b = new Array(p).fill(0);
    X.forEach((x, n) => { for (let i = 0; i < p; i++) { b[i] += x[i] * y[n]; for (let j = 0; j < p; j++) A[i][j] += x[i] * x[j]; } });
    pen.forEach((v, i) => { A[i][i] += v; });
    return solve(A, b);
  }
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const sortNum = (xs) => xs.slice().sort((a, b) => a - b);
  function quantile(s, q) {
    if (!s.length) return 0;
    const at = (s.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
    return s[lo] + (s[hi] - s[lo]) * (at - lo);
  }
  const miss = (es) => 10 ** quantile(sortNum(es.map(Math.abs)), 0.5); // median held-out miss as a factor
  const share = (es, f) => es.filter(f).length / es.length;
  /** Seeded generator for the bootstrap, so two runs write the same bytes. */
  function rng(seed) {
    return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  /** FNV-1a over the board's slug, rank and value: main.ts prints it, the page recomputes it. */
  function checksum(rows) {
    let h = 0x811c9dc5;
    for (const ch of rows.map((r) => `${r.slug}|${r.rank}|${r.implied}`).join('\n')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  /** Listing order for the forward tests: dated rows only, earliest first. */
  const byListing = (rows) => rows.map((r, i) => [r.listed, i]).filter(([d]) => d).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));

  // ---------- 3. Launch value: what the token would be worth, priced off stand-alone peers whose token trades ----------
  // Target log10(mcap / TVL). Baseline: one flat multiple. Terms join in a fixed order; one is kept only if it lowers
  // the median held-out miss on BOTH tests (left out, and forward) and its sign holds in 90% of 100 bootstrap refits.
  const VALUE_TERMS = [['size', 'size curve, log TVL'], ['kind', 'category effect, shrunk'], ['growth', '7-day TVL growth'], ['age', 'years listed, log'], ['chains', 'chain count, log']];
  const ODDS_TERMS = [['age', 'years listed, log'], ['kind', 'category effect, shrunk'], ['size', 'size, log TVL'], ['growth', '7-day TVL growth'], ['chains', 'chain count, log']];
  /** A term's columns for one row; sizes are centred on $100M so the base reads as "the multiple at $100M". */
  function cols(t, r) {
    if (t === 'size') return [r.lt - 8];
    if (t === 'growth') return [r.lg];
    if (t === 'age') return [Math.log10(1 + r.ageUsed), r.age === null ? 1 : 0];
    if (t === 'chains') return [Math.log10(r.chains.length)];
    return KINDS.map((k) => (r.kind === k ? 1 : 0));
  }
  const design = (terms, r) => [1].concat(...terms.map((t) => cols(t, r)));
  const pens = (terms) => [0].concat(...terms.map((t) => (t === 'kind' ? KINDS.map(() => 8) : t === 'age' ? [0.01, 0.01] : [0.01])));
  /** Where a term's first coefficient sits in the design, for the sign test. */
  const slot = (terms, t) => 1 + terms.slice(0, terms.indexOf(t)).reduce((s, u) => s + (u === 'kind' ? KINDS.length : u === 'age' ? 2 : 1), 0);
  /** Step through the candidates: test(terms) returns {loo, wf, coefOn(idx)}; lower is better on both scores. */
  function stepwise(candidates, test, nRows, n) {
    let terms = [], cur = test([]);
    const steps = [{ id: 'base', label: null, loo: cur.loo, wf: cur.wf, kept: true, holds: null }];
    const rand = rng(n * 7919);
    for (const [t, label] of candidates) {
      const next = test(terms.concat(t)), tt = terms.concat(t);
      let holds = null;
      if (t !== 'kind') { // sign of the term's coefficient across bootstrap refits
        const full = Math.sign(next.coefOn(null)[slot(tt, t)]);
        let same = 0;
        for (let b = 0; b < n; b++) { const idx = Array.from({ length: nRows }, () => Math.floor(rand() * nRows)); if (Math.sign(next.coefOn(idx)[slot(tt, t)]) === full) same++; }
        holds = same / n;
      }
      const kept = next.loo < cur.loo && next.wf < cur.wf && (holds === null || holds >= 0.9);
      steps.push({ id: t, label, loo: next.loo, wf: next.wf, holds, kept });
      if (kept) { terms = tt; cur = next; }
    }
    return { terms, steps, final: cur };
  }

  function fitValueModel(rows) {
    const peers = rows.filter((r) => r.status === 'comp'), y = peers.map((r) => Math.log10(r.mcap) - r.lt);
    const order = byListing(peers), start = Math.floor(order.length * 0.6), all = peers.map((_, i) => i);
    // Forward test: each of the newest 40% is priced by a fit on the peers listed before it.
    const forward = (fit, predict) => order.slice(start).map(([d, i], k) => [i, predict(fit(order.slice(0, start + k).filter(([dj]) => dj < d).map(([, j]) => j)), i)]);
    const test = (terms) => {
      const X = peers.map((r) => design(terms, r)), pen = pens(terms);
      const fitOn = (idx) => fitRidge((idx || all).map((j) => X[j]), (idx || all).map((j) => y[j]), pen);
      const le = y.map((v, i) => v - dot(fitOn(all.filter((k) => k !== i)), X[i]));
      const we = forward(fitOn, (b, i) => y[i] - dot(b, X[i])).map(([, e]) => e);
      return { loo: miss(le), wf: miss(we), le, we, X, pen, coefOn: fitOn };
    };
    const sw = stepwise(VALUE_TERMS, test, peers.length, 100), f = sw.final;
    const coef = f.coefOn(null), le = f.le, we = f.we;
    // Conformal band: the kept model's own leave-one-out misses set P10..P90 around every launch value.
    const s = sortNum(le), band = { p10: quantile(s, 0.1), p25: quantile(s, 0.25), p75: quantile(s, 0.75), p90: quantile(s, 0.9) };
    const honesty = (es) => ({ x3: share(es, (e) => Math.abs(e) <= Math.log10(3)), p50: share(es, (e) => e >= band.p25 && e <= band.p75), p80: share(es, (e) => e >= band.p10 && e <= band.p90) });
    // Bootstrap standard errors of the kept coefficients (200 refits).
    const rand = rng(20261114), draws = [];
    for (let b = 0; b < 200; b++) draws.push(f.coefOn(Array.from({ length: peers.length }, () => Math.floor(rand() * peers.length))));
    const se = coef.map((_, j) => { const v = draws.map((d) => d[j]), m = v.reduce((a, c) => a + c, 0) / v.length; return Math.sqrt(v.reduce((a, c) => a + (c - m) ** 2, 0) / (v.length - 1)); });
    return { peers, terms: sw.terms, steps: sw.steps, coef, se, draws, band, wfCount: we.length, missLoo: f.loo, missWf: f.wf,
      flatLoo: sw.steps[0].loo, flatWf: sw.steps[0].wf, honestLoo: honesty(le), honestWf: honesty(we), residual: new Map(peers.map((r, i) => [r.slug, le[i]])) };
  }
  /** Each kept term's contribution to log10(launch value), in design order, after the base log10(TVL) + intercept. */
  function valueParts(r, m, coef) {
    const c = coef || m.coef, x = design(m.terms, r), parts = [['base', c[0]]];
    let j = 1;
    m.terms.forEach((t) => { const w = t === 'kind' ? KINDS.length : t === 'age' ? 2 : 1; parts.push([t, x.slice(j, j + w).reduce((s, v, k) => s + v * c[j + k], 0)]); j += w; });
    return parts;
  }
  const logValue = (r, m, coef) => r.lt + valueParts(r, m, coef).reduce((s, p) => s + p[1], 0);

  // ---------- 4. Token odds: the share of protocols like it that already record a token ----------
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  function fitLogistic(X, y) { // Newton steps with a ridge of 1 on every slope
    const p = X[0].length; let b = new Array(p).fill(0);
    for (let it = 0; it < 30; it++) {
      const A = b.map(() => new Array(p).fill(0)), g = new Array(p).fill(0);
      X.forEach((x, n) => {
        const mu = sigmoid(dot(b, x)), w = Math.max(mu * (1 - mu), 1e-6);
        for (let i = 0; i < p; i++) { g[i] += x[i] * (y[n] - mu); for (let j = 0; j < p; j++) A[i][j] += w * x[i] * x[j]; }
      });
      for (let i = 1; i < p; i++) { A[i][i] += 1; g[i] -= b[i]; }
      const step = solve(A, g);
      b = b.map((v, i) => v + step[i]);
      if (Math.max(...step.map(Math.abs)) < 1e-8) break;
    }
    return b;
  }
  /** Sample: every stand-alone protocol, token or not. Scored by Brier, in 10 folds and forward in listing order. */
  function fitOddsModel(rows) {
    const S = rows.filter((r) => r.status === 'comp' || r.status === 'pre' || (r.status === 'token' && !SET_ASIDE.includes(r.category)));
    const y = S.map((r) => (r.status === 'pre' ? 0 : 1)), all = S.map((_, i) => i), order = byListing(S), cut = Math.floor(order.length * 0.6);
    const tr = order.slice(0, cut).map(([, i]) => i), te = order.slice(cut).map(([, i]) => i);
    const brier = (idx, p) => idx.reduce((s, i) => s + (p(i) - y[i]) ** 2, 0) / idx.length;
    const test = (terms) => {
      const X = S.map((r) => design(terms, r)), fitOn = (idx) => fitLogistic((idx || all).map((j) => X[j]), (idx || all).map((j) => y[j]));
      const held = [];
      for (let f = 0; f < 10; f++) { const b = fitOn(all.filter((i) => i % 10 !== f)); all.forEach((i) => { if (i % 10 === f) held[i] = sigmoid(dot(b, X[i])); }); }
      const bw = fitOn(tr);
      return { loo: brier(all, (i) => held[i]), wf: brier(te, (i) => sigmoid(dot(bw, X[i]))), X, coefOn: fitOn };
    };
    const sw = stepwise(ODDS_TERMS, test, S.length, 40), coef = sw.final.coefOn(null);
    // The record behind the odds: how often protocols of each age already record a token.
    const cohorts = [[0, 1, '0 to 1'], [1, 2, '1 to 2'], [2, 3, '2 to 3'], [3, 99, '3 or more']].map(([a, b, label]) => {
      const idx = all.filter((i) => S[i].age !== null && S[i].age >= a && S[i].age < b);
      return { label, n: idx.length, rate: idx.reduce((s, i) => s + y[i], 0) / Math.max(1, idx.length) };
    });
    return { terms: sw.terms, steps: sw.steps, coef, n: S.length, tokens: y.reduce((a, b) => a + b, 0), wfCount: te.length, cohorts,
      brier: sw.final.loo, brierWf: sw.final.wf, brierBase: sw.steps[0].loo, brierWfBase: sw.steps[0].wf,
      of: (r) => sigmoid(dot(coef, design(sw.terms, r))) };
  }

  // ---------- 5. Farm plan: costed, timed steps; capital sized to the edge; a verdict in dollars an hour ----------
  /** Stated assumptions, not fitted. */
  const ASSUME = {
    airdropShare: 0.08, hourTarget: 25, tbill: 0.04,
    gas: { Ethereum: 2.5, Bitcoin: 3, Tron: 1, Binance: 0.1, Solana: 0.01, Sui: 0.02, Aptos: 0.02, Algorand: 0.01, Stellar: 0.01, Ripple: 0.01 },
    gasL2: 0.05, gasOther: 0.3,
    cheap: 'Base|Arbitrum|Optimism|Monad|Ink|Unichain|Plasma|Linea|Scroll|Polygon|Avalanche|Sonic|Berachain|Hyperliquid L1|Mantle|Flare|Plume Mainnet|Katana|Arc'.split('|'),
    riskApr: { vault: 0.02, lend: 0.025, dex: 0.045, perp: 0.01, yield: 0.03, rwa: 0.012, stake: 0.03, infra: 0.025 },
    youngExtra: 0.015, tiers: [500, 1000, 2500, 5000, 10000, 25000, 50000],
  };
  const gasOn = (c) => (c in ASSUME.gas ? ASSUME.gas[c] : ASSUME.cheap.includes(c) ? ASSUME.gasL2 : ASSUME.gasOther);
  const entryFee = (c) => (c === 'Ethereum' || c === 'Bitcoin' ? 4 : 1);
  /** What a reader does, by kind: [step, when, what, transactions, minutes]. */
  const PLAYBOOK = {
    vault: (C) => [['Deposit', 'Day 0', `put ${usd(C)} USDC in its largest USDC vault (approve + deposit)`, 2, 10]],
    lend: (C) => [['Supply', 'Day 0', `lend ${usd(C)} USDC (approve + supply)`, 2, 10], ['Borrow', 'Day 0', `borrow ${usd(C * 0.3)} of a second asset and resupply it once, health factor above 2, so both sides earn points`, 2, 15]],
    dex: (C) => [['Provide', 'Day 0', `add ${usd(C)} as liquidity in its deepest stable or major pair (two approvals + add)`, 3, 15], ['Trade', 'Weekly', `route about ${usd(C * 0.1)} of swaps through it each week`, 0, 0]],
    perp: (C) => [['Margin', 'Day 0', `deposit ${usd(C)} as margin (approve + deposit)`, 2, 10], ['Trade', 'Weekly', `trade about ${usd(C * 8)} of volume over the season on majors at 2x or less; fees near 0.05%`, 6, 60]],
    yield: (C) => [['Mint', 'Day 0', `turn ${usd(C)} into its yield token or vault share (approve + mint); do not loop it`, 2, 10]],
    rwa: (C) => [['Onboard', 'Day 0', 'pass its KYC or whitelist: 30 minutes of forms, then 1 to 3 days of waiting', 0, 30], ['Subscribe', 'Day 3', `subscribe ${usd(C)} once whitelisted (approve + subscribe)`, 2, 10]],
    stake: (C) => [['Stake', 'Day 0', `lock ${usd(C)} of the asset it accepts (approve + stake); mind the unbonding delay`, 2, 15]],
    infra: (C) => [['Use', 'Monthly', `run ${usd(C)} through the product: four round trips over the season (bridge, pay or mint and back)`, 8, 40]],
  };
  /** Days to hold: long on record means fewer seasons left before a snapshot, so a shorter plan. */
  const holdDays = (r) => (r.age === null ? 120 : r.age < 1 ? 180 : r.age < 2 ? 120 : 90);

  function farmEconomics(r, C, sh) {
    const chain = r.chains.slice().sort((a, b) => gasOn(a) - gasOn(b) || r.chains.indexOf(a) - r.chains.indexOf(b))[0];
    const gas = gasOn(chain), hold = holdDays(r), weeks = Math.round(hold / 7), actions = PLAYBOOK[r.kind](C);
    const tx = actions.reduce((s, a) => s + a[3], 0) + (r.kind === 'dex' ? weeks : 0) + 2; // + exit and claim
    const fixed = entryFee(chain) + gas * tx;
    const minutes = 10 + 15 + 15 + actions.reduce((s, a) => s + a[4], 0) + (r.kind === 'dex' ? weeks * 2 : 0) + weeks * 5 + 10 + 15 + weeks * 2;
    const hazard = -Math.log(1 - r.odds) / Math.max(r.ageUsed, 0.5), launch = 1 - Math.exp(-hazard * (hold / 365 + 0.25));
    // Growth dilutes: a month of this week's inflow joins the pool you share; a shrinking pool counts as it is.
    const pool = r.tvl * clamp(1 + 4 * clamp(r.change7d || 0, -40, 40) / 100, 0.6, 3);
    const risk = (ASSUME.riskApr[r.kind] + (r.age !== null && r.age < 0.5 ? ASSUME.youngExtra : 0)) * hold / 365;
    const fees = r.kind === 'perp' ? 8 * 0.0005 : 0, drop = (v) => (sh * v * launch) / pool, net = (v) => C * (drop(v) - risk - fees) - fixed;
    const e = { capital: C, chain, gas, hold, weeks, tx, fixed, minutes, hours: minutes / 60, launch, pool, risk, fees, actions, share: sh,
      expected: C * drop(r.value.mid), expectedLo: C * drop(r.value.p25), expectedHi: C * drop(r.value.p75), carry: C * (risk + fees),
      net: net(r.value.mid), netLo: net(r.value.p25), netHi: net(r.value.p75), edge: drop(r.value.mid) - risk - fees, tbill: C * ASSUME.tbill * hold / 365 };
    e.hourly = e.net / e.hours;
    // FARM: the modelled net pays the hourly target; MARGINAL: it covers its costs; SKIP: fees and risk beat the drop.
    e.verdict = e.net > 0 && e.hourly >= ASSUME.hourTarget ? 'FARM' : e.net > 0 ? 'MARGINAL' : 'SKIP';
    e.minViable = e.edge > 0 ? Math.ceil(e.fixed / e.edge) : null;
    return e;
  }
  /** Capital: the smallest tier that earns FARM, never above 1% of the pool; else the end that loses least. */
  function sizePlan(r, sh) {
    const tiers = ASSUME.tiers.filter((c) => c <= Math.max(ASSUME.tiers[0], r.tvl * 0.01));
    for (const C of tiers) { const e = farmEconomics(r, C, sh); if (e.verdict === 'FARM') return e; }
    return farmEconomics(r, farmEconomics(r, tiers[0], sh).edge > 0 ? tiers[tiers.length - 1] : tiers[0], sh);
  }
  /** The plan, step by step: { step, when, text, cost, minutes }. board.json carries the text, which states the same figures. */
  function farmPlan(r, e, asOf) {
    const C = e.capital, g = e.gas, H = e.hold, out = [], cost = (x) => (x > 0 && x < 0.995 ? `$${x.toFixed(2)}` : usd(x));
    const add = (step, when, text, dollars, minutes) => out.push({ step, when, text: `${step} (${when}): ${text}`, cost: dollars, minutes });
    add('Wallet', 'Day 0', 'a fresh wallet used only for this farm, hardware-backed above a few thousand dollars. Cost $0, about 10 min.', 0, 10);
    add('Verify', 'Day 0', `DefiLlama records no token for ${r.name} on ${asOf}; check its docs, X and CoinGecko for a live token or points page, match contract addresses, never sign from a DM link. Cost $0, about 15 min.`, 0, 15);
    const fee = entryFee(e.chain);
    add('Fund', 'Day 0', `withdraw ${usd(C)} USDC from an exchange straight to ${e.chain}${r.chains.length > 1 ? `, the cheapest of its ${r.chains.length} chains` : ', its only chain'}, keeping gas for ${e.tx} transactions at about ${cost(g)}. Cost ${cost(fee)}, about 15 min.`, fee, 15);
    e.actions.forEach(([step, when, what, tx, min]) => {
      if (step === 'Trade' && r.kind === 'dex') return add(step, `Weekly x${e.weeks}`, `${what}. Cost ${cost(e.weeks * g)} gas, about 2 min a week.`, e.weeks * g, e.weeks * 2);
      const f = step === 'Trade' ? C * e.fees : 0;
      add(step, step === 'Trade' ? `Weekly x${e.weeks}` : when, `${what}. Cost ${cost(tx * g + f)}${f ? ' in fees and gas' : ' gas'}, about ${min} min.`, tx * g + f, min);
    });
    add('Hold', `Days 1-${H}`, `keep it in ${H} days and check points and TVL weekly (${e.weeks} x 5 min). Carry: ${(e.risk * 365 / H * 100).toFixed(1)}% a year of contract and depeg risk on ${usd(C)} = ${usd(C * e.risk)}.`, C * e.risk, e.weeks * 5);
    add('Exit rule', 'Any day', `withdraw if TVL prints below ${usd(r.tvl * 0.75)} (25% under today's ${usd(r.tvl)}; this week ${pct(r.change7d)}), if the points terms change, or if a token is announced with its snapshot past. Cost ${cost(g)}, about 10 min.`, g, 10);
    add('Record', `Weekly x${e.weeks}`, 'log each transaction (date, hash, asset, amount, dollar value): claims may ask for history, and drops are taxable in many places. Cost $0, about 2 min a week.', 0, e.weeks * 2);
    add('Claim', `Day ${H}+`, `if a token lists, claim and sell or hedge half on day one. At ${(e.share * 100).toFixed(0)}% of supply to farmers and ${(e.launch * 100).toFixed(0)}% launch odds in the window, ${usd(C)} earns about ${usd(e.expected)} (P25 ${usd(e.expectedLo)}, P75 ${usd(e.expectedHi)}). Cost ${cost(g)}, about 15 min.`, g, 15);
    out.push({ step: 'Verdict', when: '', text: `Verdict ${e.verdict}: net about ${usd(e.net)} (P25 ${usd(e.netLo)}) for ${e.hours.toFixed(1)} h of your time = ${usd(e.hourly)} an hour against a ${usd(ASSUME.hourTarget)} target; the same money in a 4% T-bill earns ${usd(e.tbill)}. Break-even capital: ${e.minViable === null ? 'none, the risk carry beats the drop at any size' : usd(e.minViable)}.`, cost: null, minutes: null });
    return out;
  }

  // ---------- 6. Formatting ----------
  function usd(x) {
    const a = Math.abs(x), s = x <= -0.5 ? '-$' : '$';
    if (a >= 1e9) return s + (a / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e4) return s + Math.round(a / 1e3) + 'K';
    return s + Math.round(a).toLocaleString('en-US');
  }
  const pct = (x) => (x == null ? 'unreported' : (x >= 0.05 ? '+' : '') + (Math.abs(x) < 0.05 ? 0 : x).toFixed(1) + '%');

  // ---------- 7. The radar ----------
  /** implied value = launch value (what the token would be worth) x token odds (share of peers like it with a token). */
  function rankAll(pre, m) {
    for (const r of pre) {
      const lv = logValue(r, m), b = m.band;
      r.value = { log: lv, mid: 10 ** lv, p10: 10 ** (lv + b.p10), p25: 10 ** (lv + b.p25), p75: 10 ** (lv + b.p75), p90: 10 ** (lv + b.p90) };
      r.score = r.value.mid * r.odds;
    }
    return pre.slice().sort((a, b) => b.score - a.score || (a.slug < b.slug ? -1 : 1));
  }
  /** Rank range: the board re-ranked under each of the 200 bootstrap refits of the value model (odds held). */
  function rankRanges(m, pre) {
    const ranks = new Map(pre.map((r) => [r.slug, []]));
    for (const c of m.draws) pre.map((r) => [r, 10 ** logValue(r, m, c) * r.odds]).sort((a, b) => b[1] - a[1]).forEach(([r], k) => ranks.get(r.slug).push(k + 1));
    pre.forEach((r) => { const s = sortNum(ranks.get(r.slug)); r.range = [quantile(s, 0.05), quantile(s, 0.95)].map(Math.round); });
  }

  function buildRadar(snap, opts) {
    const sh = (opts && opts.airdropShare) || ASSUME.airdropShare;
    const rows = prepare(snap), model = fitValueModel(rows), odds = fitOddsModel(rows);
    const pre = rows.filter((r) => r.status === 'pre');
    pre.forEach((r) => { r.odds = odds.of(r); });
    for (const r of rows) if (r.status !== 'pre') { const lv = logValue(r, model); r.value = { log: lv, mid: 10 ** lv }; }
    model.peers.forEach((r) => { r.residual = model.residual.get(r.slug); });
    const ranked = rankAll(pre, model);
    let prev = Infinity;
    ranked.forEach((r, i) => {
      r.rank = i + 1;
      r.implied = Math.max(1, Math.min(prev, Math.round(r.score)));
      prev = r.implied;
      r.farm = sizePlan(r, sh);
      r.plan = farmPlan(r, r.farm, snap.as_of);
    });
    rankRanges(model, pre);
    const count = (s) => rows.filter((r) => r.status === s).length, tier = (t) => ranked.filter((r) => r.tier === t).length;
    return { asOf: snap.as_of, source: snap.source, floor: snap.floor_usd, rows, ranked, model, odds, share: sh, checksum: checksum(ranked),
      total: ranked.reduce((s, r) => s + r.implied, 0),
      counts: { all: rows.length, comp: count('comp'), token: count('token'), aside: count('aside'), pre: ranked.length, watch: snap.watchlist.length, watchRanked: tier('watch'), off: tier('off'), early: tier('early') } };
  }

  /** board.json rows: the gate's five fields plus the figures behind them. */
  const boardRows = (R) => R.ranked.map((r) => ({
    rank: r.rank, slug: r.slug, name: r.name, implied_value_usd: r.implied, launch_value_usd: Math.round(r.value.mid), token_odds: Number(r.odds.toFixed(4)),
    launch_p25_usd: Math.round(r.value.p25), launch_p75_usd: Math.round(r.value.p75), rank_range_p5_p95: r.range, tier: r.tier,
    tvl_usd: r.tvl, change_7d: r.change7d, years_listed: r.age === null ? null : Number(r.age.toFixed(2)), category: r.category, kind: r.kind,
    farm_verdict: r.farm.verdict, farm_capital_usd: r.farm.capital, farm_net_usd: Math.round(r.farm.net), farm_hours: Number(r.farm.hours.toFixed(2)),
    farm_steps: r.plan.map((s) => s.text) }));

  const api = { buildRadar, boardRows, checksum, farmEconomics, farmPlan, sizePlan, valueParts, quantile, usd, pct, ASSUME, KINDS, KIND_LABEL };
  root.RadarModel = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
