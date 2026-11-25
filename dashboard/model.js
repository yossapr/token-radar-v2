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
    if (p.tvl_usd >= ctx.floor) return ['aside', 'above the floor and passes the name rules, yet the house rule left it out: DefiLlama names a parent'];
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
        ageUsed: age === null ? medAge : age, watch: watch.has(p.slug), status, reason, lt: Math.log10(p.tvl_usd), lg: growthTerm(p.change_7d) };
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
  const rms = (es) => Math.sqrt(es.reduce((s, e) => s + e * e, 0) / es.length);
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
  const TERMS = { growth: '7-day growth', age: 'years listed', kind: 'category' };
  const MODELS = [[], ['growth'], ['age'], ['kind'], ['growth', 'age'], ['growth', 'age', 'kind']];
  const columns = (terms) => ['intercept', 'logTVL'].concat(...terms.map((t) => (t === 'kind' ? KINDS.map((k) => 'k_' + k) : [t])));
  const feature = (r, c) => (c === 'intercept' ? 1 : c === 'logTVL' ? r.lt : c === 'growth' ? r.lg : c === 'age' ? r.ageUsed : r.kind === c.slice(2) ? 1 : 0);
  const penalty = (c) => (c === 'intercept' || c === 'logTVL' ? 0 : c.startsWith('k_') ? 2 : 0.05);

  function fitValueModel(rows) {
    const peers = rows.filter((r) => r.status === 'comp'), y = peers.map((r) => Math.log10(r.mcap));
    const order = byListing(peers), start = Math.floor(order.length * 0.6);
    // Forward test: each of the newest 40% is priced by a fit on the peers listed before it.
    const forward = (fit, predict) => order.slice(start).map(([d, i], k) => {
      const train = order.slice(0, start + k).filter(([dj]) => dj < d).map(([, j]) => j);
      return [i, predict(fit(train), i)];
    });
    const fits = MODELS.map((terms) => {
      const cols = columns(terms), pen = cols.map(penalty), X = peers.map((r) => cols.map((c) => feature(r, c)));
      const fitOn = (idx) => fitRidge(idx.map((j) => X[j]), idx.map((j) => y[j]), pen);
      const loo = y.map((_, i) => dot(fitOn(y.map((_, k) => k).filter((k) => k !== i)), X[i]));
      const wf = forward(fitOn, (b, i) => dot(b, X[i]));
      const le = loo.map((v, i) => y[i] - v), we = wf.map(([i, v]) => y[i] - v);
      // Held-out log score of a normal error at each test's own spread, both tests averaged: the model's evidence.
      const score = (es) => -0.5 * Math.log(2 * Math.PI * rms(es) ** 2) - 0.5;
      return { terms, id: ['log TVL'].concat(terms.map((t) => TERMS[t])).join(' + '), cols, pen, X, coef: fitOn(y.map((_, k) => k)), loo, wf,
        missLoo: miss(le), missWf: miss(we), rmsLoo: rms(le), rmsWf: rms(we), evidence: y.length * (score(le) + score(we)) / 2 };
    });
    // Pseudo-Bayesian model averaging: weight = exp(held-out log score), normalised. No weight is set by hand.
    const top = Math.max(...fits.map((f) => f.evidence)), raw = fits.map((f) => Math.exp(f.evidence - top)), tot = raw.reduce((a, b) => a + b, 0);
    fits.forEach((f, m) => { f.weight = raw[m] / tot; });
    const blendCoef = (coefs) => {
      const c = {};
      columns(['growth', 'age', 'kind']).forEach((col) => { c[col] = fits.reduce((s, f, m) => s + f.weight * (f.cols.includes(col) ? coefs[m][f.cols.indexOf(col)] : 0), 0); });
      return c;
    };
    const coef = blendCoef(fits.map((f) => f.coef));
    const le = y.map((v, i) => v - fits.reduce((s, f) => s + f.weight * f.loo[i], 0));
    const wfAt = new Map();
    fits.forEach((f) => f.wf.forEach(([i, v]) => wfAt.set(i, (wfAt.get(i) || 0) + f.weight * v)));
    const we = [...wfAt].map(([i, v]) => y[i] - v);
    // Conformal band: the blend's own leave-one-out misses set P10..P90 around every launch value.
    const s = sortNum(le), band = { p10: quantile(s, 0.1), p25: quantile(s, 0.25), p75: quantile(s, 0.75), p90: quantile(s, 0.9) };
    // Baseline: one flat mcap/TVL multiple (the peers' median), tested the same two ways.
    const ratio = y.map((v, i) => v - peers[i].lt), med = (idx) => quantile(sortNum(idx.map((j) => ratio[j])), 0.5);
    const flatLoo = ratio.map((r, i) => r - med(ratio.map((_, k) => k).filter((k) => k !== i)));
    const flatWf = forward(med, (m, i) => ratio[i] - m).map(([, e]) => e);
    const honesty = (es) => ({ x3: share(es, (e) => Math.abs(e) <= Math.log10(3)), p50: share(es, (e) => e >= band.p25 && e <= band.p75), p80: share(es, (e) => e >= band.p10 && e <= band.p90) });
    const weightOf = (t) => fits.filter((f) => f.terms.includes(t)).reduce((a, f) => a + f.weight, 0);
    return { peers, y, fits, coef, band, blendCoef, wfCount: we.length, flatRatio: med(ratio.map((_, i) => i)),
      missLoo: miss(le), missWf: miss(we), rmsLoo: rms(le), rmsWf: rms(we), flatLoo: miss(flatLoo), flatWf: miss(flatWf), flatRms: rms(flatLoo),
      honestLoo: honesty(le), honestWf: honesty(we), termWeight: { growth: weightOf('growth'), age: weightOf('age'), kind: weightOf('kind') },
      residual: new Map(peers.map((r, i) => [r.slug, le[i]])) };
  }
  const valueParts = (r, c) => ({ base: c.intercept + c.logTVL * r.lt, growth: c.growth * r.lg, age: c.age * r.ageUsed, kind: c['k_' + r.kind] || 0 });
  const logValue = (r, c) => { const p = valueParts(r, c); return p.base + p.growth + p.age + p.kind; };

  // ---------- 4. Token odds: the share of protocols like it that already record a token ----------
  const oddsX = (r) => [1, r.lt, Math.min(r.ageUsed, 6), r.age === null ? 1 : 0, r.lg].concat(KINDS.map((k) => (r.kind === k ? 1 : 0)));
  const ODDS_TERMS = ['size, log TVL', 'years listed', 'listing date missing', '7-day growth'];
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
      if (Math.max(...step.map(Math.abs)) < 1e-9) break;
    }
    return b;
  }
  function auc(sc, lab) {
    let win = 0, np = 0, nn = 0;
    sc.forEach((a, i) => { if (!lab[i]) return; np++; sc.forEach((b, j) => { if (lab[j]) return; win += a > b ? 1 : a === b ? 0.5 : 0; }); });
    nn = lab.length - np;
    return win / (np * nn);
  }
  /** Sample: every stand-alone protocol, token or not. Tested in 10 folds and forward in listing order. */
  function fitOddsModel(rows) {
    const S = rows.filter((r) => r.status === 'comp' || r.status === 'pre' || (r.status === 'token' && !SET_ASIDE.includes(r.category)));
    const X = S.map(oddsX), y = S.map((r) => (r.status === 'pre' ? 0 : 1)), n = S.length;
    const brier = (ps, idx) => idx.reduce((s, i, k) => s + (ps[k] - y[i]) ** 2, 0) / idx.length;
    const held = [], base = [];
    for (let f = 0; f < 10; f++) {
      const tr = S.map((_, i) => i).filter((i) => i % 10 !== f), rate = tr.reduce((s, i) => s + y[i], 0) / tr.length;
      const b = fitLogistic(tr.map((i) => X[i]), tr.map((i) => y[i]));
      S.forEach((_, i) => { if (i % 10 === f) { held[i] = sigmoid(dot(b, X[i])); base[i] = rate; } });
    }
    const all = S.map((_, i) => i), order = byListing(S), cut = Math.floor(order.length * 0.6);
    const tr = order.slice(0, cut).map(([, i]) => i), te = order.slice(cut).map(([, i]) => i);
    const bw = fitLogistic(tr.map((i) => X[i]), tr.map((i) => y[i])), rateW = tr.reduce((s, i) => s + y[i], 0) / tr.length;
    const coef = fitLogistic(X, y);
    return { coef, n, tokens: y.reduce((a, b) => a + b, 0), auc: auc(held, y),
      brier: brier(held, all), brierBase: brier(base, all), brierWf: brier(te.map((i) => sigmoid(dot(bw, X[i]))), te), brierWfBase: brier(te.map(() => rateW), te), wfCount: te.length,
      of: (r) => sigmoid(dot(coef, oddsX(r))) };
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
    vault: (C) => [['Deposit', 'Day 0', `deposit ${usd(C)} USDC into its largest USDC vault (approve + deposit)`, 2, 10]],
    lend: (C) => [['Supply', 'Day 0', `supply ${usd(C)} USDC (approve + supply)`, 2, 10], ['Borrow', 'Day 0', `borrow ${usd(C * 0.3)} of a second asset and resupply it once, health factor above 2, so both sides earn points`, 2, 15]],
    dex: (C) => [['Provide', 'Day 0', `add ${usd(C)} as liquidity in its deepest stable or major pair (two approvals + add)`, 3, 15], ['Trade', 'Weekly', `route about ${usd(C * 0.1)} of swaps through it each week`, 0, 0]],
    perp: (C) => [['Margin', 'Day 0', `deposit ${usd(C)} as margin (approve + deposit)`, 2, 10], ['Trade', 'Weekly', `trade about ${usd(C * 8)} of volume over the season on majors at 2x or less; fees near 0.05%`, 6, 60]],
    yield: (C) => [['Mint', 'Day 0', `mint or deposit ${usd(C)} into its yield token or vault (approve + mint); do not loop it`, 2, 10]],
    rwa: (C) => [['Onboard', 'Day 0', 'pass its KYC or whitelist: 30 minutes of forms, then 1 to 3 days of waiting', 0, 30], ['Subscribe', 'Day 3', `subscribe ${usd(C)} once whitelisted (approve + subscribe)`, 2, 10]],
    stake: (C) => [['Stake', 'Day 0', `stake or restake ${usd(C)} of the asset it accepts (approve + stake); mind the unbonding delay`, 2, 15]],
    infra: (C) => [['Use', 'Monthly', `use the product with ${usd(C)}: four round trips over the season (bridge, pay or mint and back)`, 8, 40]],
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
  const pct = (x) => (x == null ? 'unreported' : (x > 0 ? '+' : '') + x.toFixed(1) + '%');

  // ---------- 7. The radar ----------
  /** implied value = launch value (what the token would be worth) x token odds (share of peers like it with a token). */
  function rankAll(pre, coef, band) {
    for (const r of pre) {
      const lv = logValue(r, coef);
      r.value = { log: lv, mid: 10 ** lv, p10: 10 ** (lv + band.p10), p25: 10 ** (lv + band.p25), p75: 10 ** (lv + band.p75), p90: 10 ** (lv + band.p90) };
      r.score = r.value.mid * r.odds;
    }
    return pre.slice().sort((a, b) => b.score - a.score || (a.slug < b.slug ? -1 : 1));
  }
  /** Bootstrap: refit every model on 200 resamples of the peers (weights held) and record each row's rank range. */
  function bootstrap(model, pre, n) {
    const rand = rng(20261114), P = model.peers.length, ranks = new Map(pre.map((r) => [r.slug, []])), slopes = [];
    for (let b = 0; b < n; b++) {
      const idx = Array.from({ length: P }, () => Math.floor(rand() * P));
      const coef = model.blendCoef(model.fits.map((f) => fitRidge(idx.map((j) => f.X[j]), idx.map((j) => model.y[j]), f.pen)));
      slopes.push(coef.logTVL);
      pre.map((r) => [r, 10 ** logValue(r, coef) * r.odds]).sort((a, c) => c[1] - a[1]).forEach(([r], k) => ranks.get(r.slug).push(k + 1));
    }
    pre.forEach((r) => { const s = sortNum(ranks.get(r.slug)); r.range = [quantile(s, 0.05), quantile(s, 0.95)].map(Math.round); });
    const s = sortNum(slopes);
    return { n, slopeLo: quantile(s, 0.05), slopeHi: quantile(s, 0.95) };
  }

  function buildRadar(snap, opts) {
    const sh = (opts && opts.airdropShare) || ASSUME.airdropShare;
    const rows = prepare(snap), model = fitValueModel(rows), odds = fitOddsModel(rows);
    const pre = rows.filter((r) => r.status === 'pre');
    pre.forEach((r) => { r.odds = odds.of(r); });
    for (const r of rows) if (r.status !== 'pre') { const lv = logValue(r, model.coef); r.value = { log: lv, mid: 10 ** lv }; }
    model.peers.forEach((r) => { r.residual = model.residual.get(r.slug); });
    const ranked = rankAll(pre, model.coef, model.band);
    let prev = Infinity;
    ranked.forEach((r, i) => {
      r.rank = i + 1;
      r.implied = Math.max(1, Math.min(prev, Math.round(r.score)));
      prev = r.implied;
      r.farm = sizePlan(r, sh);
      r.plan = farmPlan(r, r.farm, snap.as_of);
    });
    const boot = bootstrap(model, pre, 200);
    // The page's model sandbox: the same odds on the single best-tested curve, and on one flat multiple.
    const [a, b] = model.fits[0].coef;
    pre.forEach((r) => { r.alt = { tvl: 10 ** (a + b * r.lt) * r.odds, flat: 10 ** (r.lt + model.flatRatio) * r.odds }; });
    const count = (s) => rows.filter((r) => r.status === s).length;
    return { asOf: snap.as_of, source: snap.source, floor: snap.floor_usd, rows, ranked, model, odds, boot, share: sh, checksum: checksum(ranked),
      total: ranked.reduce((s, r) => s + r.implied, 0),
      counts: { all: rows.length, comp: count('comp'), token: count('token'), aside: count('aside'), pre: ranked.length, watch: snap.watchlist.length, watchRanked: ranked.filter((r) => r.watch).length } };
  }

  /** board.json rows: the gate's five fields plus the figures behind them. */
  const boardRows = (R) => R.ranked.map((r) => ({
    rank: r.rank, slug: r.slug, name: r.name, implied_value_usd: r.implied, launch_value_usd: Math.round(r.value.mid), token_odds: Number(r.odds.toFixed(4)),
    launch_p25_usd: Math.round(r.value.p25), launch_p75_usd: Math.round(r.value.p75), rank_range_p5_p95: r.range,
    tvl_usd: r.tvl, change_7d: r.change7d, years_listed: r.age === null ? null : Number(r.age.toFixed(2)), category: r.category, kind: r.kind, watchlist: r.watch,
    farm_verdict: r.farm.verdict, farm_capital_usd: r.farm.capital, farm_net_usd: Math.round(r.farm.net), farm_hours: Number(r.farm.hours.toFixed(2)),
    farm_steps: r.plan.map((s) => s.text) }));

  const api = { buildRadar, boardRows, checksum, farmEconomics, farmPlan, sizePlan, valueParts, quantile, usd, pct, ASSUME, KINDS, KIND_LABEL, ODDS_TERMS, TERMS };
  root.RadarModel = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
