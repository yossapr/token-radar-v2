/* Pre-token radar: the whole model in one plain script.
 * main.ts runs this file in Node to write board.json; the page runs the same file in the browser and
 * rebuilds the board from the raw snapshot, then checks it against board.json row by row.
 * Nothing here names a protocol: every number comes from the snapshot's figures or a stated assumption. */
(function (root) {
  'use strict';

  // ---------- 1. What the snapshot says about each protocol ----------
  const SET_ASIDE_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
  const VERSION_MARK = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  const DERIVATIVE_WORD = /\b(wrapped|staked|staking)\b/i;

  /** DefiLlama category -> the farming kind that decides the playbook and the category term. */
  const KIND_OF = {
    'Risk Curators': 'vault', 'Onchain Capital Allocator': 'vault', 'Liquidity Manager': 'vault', 'Yield Aggregator': 'vault',
    'Indexes': 'vault', 'Leveraged Farming': 'vault', 'Farm': 'vault',
    'Lending': 'lend', 'CDP': 'lend', 'CDP Manager': 'lend', 'Uncollateralized Lending': 'lend', 'Collateral Management': 'lend',
    'Dexs': 'dex', 'Derivatives': 'perp', 'Options': 'perp', 'Synthetics': 'perp', 'Prediction Market': 'perp',
    'Yield': 'yield', 'Basis Trading': 'yield', 'Dual-Token Stablecoin': 'yield', 'Algo-Stables': 'yield', 'Stablecoin Wrapper': 'yield',
    'Anchor BTC': 'yield', 'CeDeFi': 'yield', 'RWA': 'rwa',
    'Restaking': 'stake', 'Staking Pool': 'stake', 'Collateral Markets': 'stake', 'Decentralized BTC': 'stake', 'Governance Incentives': 'stake',
    'Liquid Staking': 'stake', 'Liquid Restaking': 'stake', 'Restaked BTC': 'stake',
  };
  const KINDS = ['vault', 'lend', 'dex', 'perp', 'yield', 'rwa', 'stake', 'infra'];
  const KIND_LABEL = { vault: 'Vault / curator', lend: 'Lending', dex: 'DEX', perp: 'Perps & markets', yield: 'Yield & stables', rwa: 'RWA', stake: 'Staking', infra: 'Infra & chain' };
  const kindOf = (category) => KIND_OF[category] || 'infra';

  const DAY = 86400000;
  const yearsBetween = (from, to) => (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY / 365.25;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  /** A 7-day change in per cent, clipped to +-40% so one spike cannot run the fit, as a log growth factor. */
  const growthTerm = (change7d) => Math.log10(1 + clamp(change7d == null ? 0 : change7d, -40, 40) / 100);

  /** Why a protocol is or is not a pre-token subject. Returns { status, reason }. */
  function classify(p, ctx) {
    const hasToken = p.gecko_id !== null || p.symbol !== null;
    if (hasToken) {
      return p.mcap_usd > 0
        ? { status: 'comp', reason: `token ${p.symbol || p.gecko_id} trades at a recorded market cap: a priced peer for the fit` }
        : { status: 'token', reason: `records token ${p.symbol || p.gecko_id} with no market cap: a token exists, so not pre-token` };
    }
    if (ctx.watch.has(p.slug)) return { status: 'pre', reason: 'on the house watchlist: no token recorded, no parent' };
    if (SET_ASIDE_CATEGORIES.includes(p.category)) return { status: 'aside', reason: `category ${p.category}: a wrapped, staked or bridged product, not a launch` };
    if (VERSION_MARK.test(p.name)) return { status: 'aside', reason: 'name ends in a version marker: a later version of a protocol already counted' };
    if (DERIVATIVE_WORD.test(p.name)) return { status: 'aside', reason: 'name says wrapped, staked or staking: a derivative of another asset' };
    if (EXCHANGES.some((x) => p.name.startsWith(x))) return { status: 'aside', reason: 'name begins with an exchange: an exchange product, not a launch' };
    if (p.tvl_usd >= ctx.floor) return { status: 'aside', reason: 'above the floor and passes the name rules, yet the house rule left it out: DefiLlama names a parent' };
    const head = p.name.split(' ')[0].toLowerCase();
    if (head.length >= 3 && ctx.tokenHeads.has(head)) return { status: 'aside', reason: `shares its first word with a protocol whose token trades (${ctx.tokenHeads.get(head)}): a family product` };
    return { status: 'pre', reason: 'below the floor, no token recorded, passes every derivative rule' };
  }

  /** One row per protocol with the derived figures every later step reads. */
  function prepare(snapshot) {
    const watch = new Set(snapshot.watchlist);
    const tokenHeads = new Map();
    for (const p of snapshot.protocols) if (p.gecko_id !== null || p.symbol !== null) {
      const head = p.name.split(' ')[0].toLowerCase();
      if (!tokenHeads.has(head)) tokenHeads.set(head, p.name);
    }
    const ctx = { watch, tokenHeads, floor: snapshot.floor_usd };
    const known = snapshot.protocols.filter((p) => p.listed_at).map((p) => yearsBetween(p.listed_at, snapshot.as_of)).sort((a, b) => a - b);
    const medianAge = quantile(known, 0.5);
    return snapshot.protocols.map((p) => {
      const c = classify(p, ctx);
      const age = p.listed_at ? yearsBetween(p.listed_at, snapshot.as_of) : null;
      return {
        slug: p.slug, name: p.name, category: p.category || 'Uncategorised', kind: kindOf(p.category), chains: p.chains,
        tvl: p.tvl_usd, change7d: p.change_7d, mcap: p.mcap_usd, symbol: p.symbol, listed: p.listed_at,
        age, ageUsed: age === null ? medianAge : age, watch: watch.has(p.slug), status: c.status, reason: c.reason,
        lt: Math.log10(p.tvl_usd), lg: growthTerm(p.change_7d),
      };
    });
  }

  // ---------- 2. Small numerics: ridge least squares, quantiles, ranks ----------
  /** Solve A x = b by Gaussian elimination with partial pivoting (A is small and symmetric positive). */
  function solve(A, b) {
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    return x;
  }
  /** Ridge fit: minimise |y - Xb|^2 + sum(pen_j b_j^2). The intercept and log TVL carry no penalty. */
  function fitRidge(X, y, pen) {
    const p = pen.length, A = [], b = new Array(p).fill(0);
    for (let i = 0; i < p; i++) A.push(new Array(p).fill(0));
    X.forEach((x, n) => { for (let i = 0; i < p; i++) { b[i] += x[i] * y[n]; for (let j = 0; j < p; j++) A[i][j] += x[i] * x[j]; } });
    for (let i = 0; i < p; i++) A[i][i] += pen[i];
    return solve(A, b);
  }
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const at = (sorted.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
  }
  const sortNum = (xs) => xs.slice().sort((a, b) => a - b);
  const medianAbs = (es) => quantile(sortNum(es.map(Math.abs)), 0.5);
  const rms = (es) => Math.sqrt(es.reduce((s, e) => s + e * e, 0) / es.length);
  function ranks(xs) {
    const order = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]), r = new Array(xs.length);
    order.forEach(([, i], k) => { r[i] = k; });
    return r;
  }
  function spearman(a, b) {
    const ra = ranks(a), rb = ranks(b), n = a.length, ma = (n - 1) / 2;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { sab += (ra[i] - ma) * (rb[i] - ma); saa += (ra[i] - ma) ** 2; sbb += (rb[i] - ma) ** 2; }
    return sab / Math.sqrt(saa * sbb);
  }

  // ---------- 3. The value model: priced peers, candidate terms, two blind tests, evidence weights ----------
  /** Candidate value terms. Each model is log TVL plus a subset; every one is tested on held-out peers. */
  const TERMS = {
    growth: { label: '7-day TVL growth', short: 'growth', cols: () => ['growth'] },
    age: { label: 'Years on record', short: 'years', cols: () => ['age'] },
    kind: { label: 'Category multiple', short: 'category', cols: () => KINDS.map((k) => 'k_' + k) },
  };
  const MODELS = [[], ['growth'], ['age'], ['kind'], ['growth', 'age'], ['growth', 'age', 'kind']];
  const modelId = (terms) => ['log TVL'].concat(terms.map((t) => TERMS[t].short)).join(' + ');

  function columns(terms) {
    const cols = ['intercept', 'logTVL'];
    terms.forEach((t) => cols.push(...TERMS[t].cols()));
    return cols;
  }
  function featureOf(row, col) {
    if (col === 'intercept') return 1;
    if (col === 'logTVL') return row.lt;
    if (col === 'growth') return row.lg;
    if (col === 'age') return row.ageUsed;
    return row.kind === col.slice(2) ? 1 : 0;
  }
  const penaltyOf = (col) => (col === 'intercept' || col === 'logTVL' ? 0 : col.startsWith('k_') ? 2 : 0.05);

  /** Leave-one-out: refit without each peer and record how far the fit misses it, in log10 units. */
  function looPredictions(X, y, pen) {
    return y.map((_, i) => {
      const Xi = X.filter((_, k) => k !== i), yi = y.filter((_, k) => k !== i);
      return dot(fitRidge(Xi, yi, pen), X[i]);
    });
  }
  /** Walk-forward: peers in listing order; each of the last 40% is priced by a fit on peers listed before it. */
  function walkForwardPredictions(X, y, pen, listed) {
    const dated = listed.map((d, i) => [d, i]).filter(([d]) => d).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    const start = Math.floor(dated.length * 0.6), out = [];
    for (let k = start; k < dated.length; k++) {
      const i = dated[k][1], train = dated.slice(0, k).map(([, j]) => j).filter((j) => listed[j] < listed[i]);
      const b = fitRidge(train.map((j) => X[j]), train.map((j) => y[j]), pen);
      out.push([i, dot(b, X[i])]);
    }
    return out;
  }

  function fitValueModel(rows) {
    const peers = rows.filter((r) => r.status === 'comp');
    const y = peers.map((r) => Math.log10(r.mcap)), listed = peers.map((r) => r.listed);
    const fits = MODELS.map((terms) => {
      const cols = columns(terms), pen = cols.map(penaltyOf);
      const X = peers.map((r) => cols.map((c) => featureOf(r, c)));
      const coef = fitRidge(X, y, pen), loo = looPredictions(X, y, pen), wf = walkForwardPredictions(X, y, pen, listed);
      const looErr = loo.map((v, i) => y[i] - v), wfErr = wf.map(([i, v]) => y[i] - v);
      // Held-out log score of a normal error at the test's own spread, per peer, averaged over both tests and
      // scaled back to the peer count: a model must predict well left-one-out AND forward in time to earn weight.
      const score = (es) => {
        const s2 = es.reduce((s, e) => s + e * e, 0) / es.length;
        return -0.5 * Math.log(2 * Math.PI * s2) - 0.5;
      };
      const elpd = y.length * (score(looErr) + score(wfErr)) / 2;
      return { terms, id: modelId(terms), cols, coef, loo, wf, rmsLoo: rms(looErr), rmsWf: rms(wfErr), elpd };
    });
    // Pseudo-Bayesian model averaging: weight = exp(held-out log score), normalised. No weight is set by hand.
    const best = Math.max(...fits.map((f) => f.elpd));
    const raw = fits.map((f) => Math.exp(f.elpd - best)), total = raw.reduce((a, b) => a + b, 0);
    fits.forEach((f, m) => { f.weight = raw[m] / total; });
    // The blend is one linear equation: each column's coefficient is the weighted sum over the models carrying it.
    const allCols = columns(['growth', 'age', 'kind']), coef = {};
    allCols.forEach((c) => { coef[c] = fits.reduce((s, f) => s + f.weight * (f.cols.includes(c) ? f.coef[f.cols.indexOf(c)] : 0), 0); });
    const blendLoo = y.map((_, i) => fits.reduce((s, f) => s + f.weight * f.loo[i], 0));
    const looErr = blendLoo.map((v, i) => y[i] - v);
    const wfMap = new Map();
    fits.forEach((f) => f.wf.forEach(([i, v]) => wfMap.set(i, (wfMap.get(i) || 0) + f.weight * v)));
    const wfErr = [...wfMap.entries()].map(([i, v]) => y[i] - v);
    // Conformal band: the blend's own held-out misses set the P10..P90 range around every implied value.
    const sorted = sortNum(looErr);
    const band = { p10: quantile(sorted, 0.1), p25: quantile(sorted, 0.25), p75: quantile(sorted, 0.75), p90: quantile(sorted, 0.9) };
    const inside = (es, lo, hi) => es.filter((e) => e >= lo && e <= hi).length / es.length;
    // Baseline a reader would try first: one flat mcap/TVL multiple, also left out one peer at a time.
    const ratios = y.map((v, i) => v - peers[i].lt);
    const flatErr = ratios.map((r, i) => r - quantile(sortNum(ratios.filter((_, k) => k !== i)), 0.5));
    const termEffect = {};
    Object.keys(TERMS).forEach((t) => {
      const w = fits.filter((f) => f.terms.includes(t)).reduce((s, f) => s + f.weight, 0);
      termEffect[t] = { label: TERMS[t].label, weight: w };
    });
    return {
      peers: peers.length, fits, coef, band, termEffect,
      rmsLoo: rms(looErr), rmsWf: rms(wfErr), rmsFlat: rms(flatErr), wfCount: wfErr.length,
      looMiss: 10 ** medianAbs(looErr), wfMiss: 10 ** medianAbs(wfErr), flatMiss: 10 ** medianAbs(flatErr),
      spearman: spearman(blendLoo, y), coverage50: inside(wfErr, band.p25, band.p75), coverage80: inside(wfErr, band.p10, band.p90),
      looCoverage50: inside(looErr, band.p25, band.p75),
      residual: new Map(peers.map((r, i) => [r.slug, looErr[i]])),
    };
  }

  /** A protocol's implied value as the sum of its terms (log10 dollars), so the page can print the equation. */
  function valueParts(row, model) {
    const c = model.coef;
    return {
      base: c.intercept + c.logTVL * row.lt,
      growth: c.growth * row.lg,
      age: c.age * row.ageUsed,
      kind: c['k_' + row.kind] || 0,
    };
  }

  // ---------- 4. Token odds: how often protocols with this profile already record a token ----------
  function oddsFeatures(r) {
    return [1, r.lt, Math.min(r.ageUsed, 6), r.age === null ? 1 : 0, r.lg].concat(KINDS.map((k) => (r.kind === k ? 1 : 0)));
  }
  function fitLogistic(X, y, lambda) {
    const p = X[0].length; let b = new Array(p).fill(0);
    for (let it = 0; it < 30; it++) {
      const A = [], g = new Array(p).fill(0);
      for (let i = 0; i < p; i++) A.push(new Array(p).fill(0));
      X.forEach((x, n) => {
        const mu = 1 / (1 + Math.exp(-dot(b, x))), w = Math.max(mu * (1 - mu), 1e-6);
        for (let i = 0; i < p; i++) { g[i] += x[i] * (y[n] - mu); for (let j = 0; j < p; j++) A[i][j] += w * x[i] * x[j]; }
      });
      for (let i = 1; i < p; i++) { A[i][i] += lambda; g[i] -= lambda * b[i]; }
      const step = solve(A, g);
      b = b.map((v, i) => v + step[i]);
      if (Math.max(...step.map(Math.abs)) < 1e-9) break;
    }
    return b;
  }
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  function auc(scores, labels) {
    const pos = [], neg = [];
    scores.forEach((s, i) => (labels[i] ? pos : neg).push(s));
    let win = 0;
    for (const a of pos) for (const b of neg) win += a > b ? 1 : a === b ? 0.5 : 0;
    return win / (pos.length * neg.length);
  }
  /** Sample: every protocol the derivative rules keep, token or not. Tested with 10 folds by slug order. */
  function fitOddsModel(rows) {
    const sample = rows.filter((r) => r.status === 'comp' || r.status === 'pre' || (r.status === 'token' && !SET_ASIDE_CATEGORIES.includes(r.category)));
    const X = sample.map(oddsFeatures), y = sample.map((r) => (r.status === 'pre' ? 0 : 1));
    const coef = fitLogistic(X, y, 1);
    const held = new Array(sample.length);
    for (let f = 0; f < 10; f++) {
      const tr = sample.map((_, i) => i).filter((i) => i % 10 !== f);
      const b = fitLogistic(tr.map((i) => X[i]), tr.map((i) => y[i]), 1);
      sample.forEach((_, i) => { if (i % 10 === f) held[i] = sigmoid(dot(b, X[i])); });
    }
    const rate = y.reduce((a, b) => a + b, 0) / y.length;
    return { coef, n: sample.length, tokenRate: rate, auc: auc(held, y), of: (r) => sigmoid(dot(coef, oddsFeatures(r))) };
  }

  // ---------- 5. The farm plan: costed steps, capital sized to the edge, a verdict in dollars per hour ----------
  /** Stated assumptions, not fitted: what a transaction costs, what share of supply a drop gives farmers, and risk. */
  const ASSUME = {
    airdropShare: 0.08, // share of the token's value paid to farmers, pro rata to deposits
    hourTarget: 40, // dollars per hour of your time a plan must clear to be called FARM
    gas: { Ethereum: 2.5, Bitcoin: 3, Tron: 1, Binance: 0.1, Solana: 0.01, Sui: 0.02, Aptos: 0.02, Algorand: 0.01, Stellar: 0.01, Ripple: 0.01 },
    gasL2: 0.05, // Base, Arbitrum, Optimism, Monad and other rollups or fast chains
    gasOther: 0.3,
    cheapChains: ['Base', 'Arbitrum', 'Optimism', 'Monad', 'Ink', 'Unichain', 'Plasma', 'Linea', 'Scroll', 'Polygon', 'Avalanche', 'Sonic', 'Berachain', 'Hyperliquid L1', 'Mantle', 'Flare', 'Plume Mainnet', 'Katana', 'Arc'],
    riskApr: { vault: 0.02, lend: 0.025, dex: 0.045, perp: 0.01, yield: 0.03, rwa: 0.012, stake: 0.03, infra: 0.025 },
    youngExtra: 0.015, // extra risk a year for a protocol on record under six months
    tiers: [500, 1000, 2500, 5000, 10000, 25000, 50000],
  };
  const gasOn = (chain) => (chain in ASSUME.gas ? ASSUME.gas[chain] : ASSUME.cheapChains.includes(chain) ? ASSUME.gasL2 : ASSUME.gasOther);
  const entryFee = (chain) => (chain === 'Ethereum' || chain === 'Bitcoin' ? 4 : 1);

  /** What a reader does, by kind: [title, what to do, transactions, minutes]. `C` is the plan's capital. */
  const PLAYBOOK = {
    vault: (C) => [['Deposit', `deposit ${usd(C)} USDC into its largest USDC vault (approve + deposit)`, 2, 10]],
    lend: (C) => [['Supply', `supply ${usd(C)} USDC (approve + supply)`, 2, 10], ['Borrow', `borrow ${usd(C * 0.3)} of a second asset and resupply it once, keeping the health factor above 2, so both sides earn points`, 2, 15]],
    dex: (C) => [['Provide', `add ${usd(C)} as liquidity in its deepest stable or major pair (two approvals + add)`, 3, 15], ['Trade', `route about ${usd(C * 0.1)} of swaps through it each week; budget one swap a week`, 0, 0]],
    perp: (C) => [['Margin', `deposit ${usd(C)} as margin (approve + deposit)`, 2, 10], ['Trade', `trade about ${usd(C * 8)} of volume over the season on majors at 2x or less; fees near 0.05% cost ${usd(C * 8 * 0.0005)}`, 6, 60]],
    yield: (C) => [['Mint', `mint or deposit ${usd(C)} into its yield token or vault (approve + mint); do not loop it`, 2, 10]],
    rwa: (C) => [['Onboard', 'pass its KYC or whitelist (30 minutes of forms, often 1 to 3 days of waiting)', 0, 30], ['Subscribe', `subscribe ${usd(C)} once whitelisted (approve + subscribe)`, 2, 10]],
    stake: (C) => [['Stake', `stake or restake ${usd(C)} of the asset it accepts (approve + stake); note the unbonding delay before you count on exit`, 2, 15]],
    infra: (C) => [['Use', `use the product with ${usd(C)}: four round trips over the season (bridge, pay or mint and back)`, 8, 40]],
  };

  /** Days to hold: a protocol long on record has fewer seasons left before a snapshot, so the plan is shorter. */
  const holdDays = (row) => (row.age === null ? 120 : row.age < 1 ? 180 : row.age < 2 ? 120 : 90);

  function farmEconomics(row, value, odds, C, share) {
    const chain = row.chains.slice().sort((a, b) => gasOn(a) - gasOn(b) || row.chains.indexOf(a) - row.chains.indexOf(b))[0];
    const gas = gasOn(chain), hold = holdDays(row), weeks = Math.round(hold / 7);
    const actions = PLAYBOOK[row.kind](C);
    const weeklyTx = row.kind === 'dex' ? weeks : 0;
    const tx = actions.reduce((s, a) => s + a[2], 0) + weeklyTx + 2; // + exit and claim
    const fixed = entryFee(chain) + gas * tx;
    const minutes = 15 + 15 + actions.reduce((s, a) => s + a[3], 0) + (row.kind === 'dex' ? weeks * 2 : 0) + weeks * 5 + 10 + 15;
    const hazard = -Math.log(1 - odds) / Math.max(row.ageUsed, 0.5);
    const launch = 1 - Math.exp(-hazard * (hold / 365 + 0.25));
    // Growth dilutes: a month of this week's inflow joins the pool you share; a shrinking pool counts as it is.
    const pool = row.tvl * clamp(1 + 4 * clamp(row.change7d || 0, -40, 40) / 100, 0.6, 3);
    const risk = (ASSUME.riskApr[row.kind] + (row.age !== null && row.age < 0.5 ? ASSUME.youngExtra : 0)) * hold / 365;
    const perpFees = row.kind === 'perp' ? 8 * 0.0005 : 0;
    const dropPerDollar = (v) => (share * v * launch) / pool;
    const net = (v) => C * (dropPerDollar(v) - risk - perpFees) - fixed;
    return {
      chain, gas, hold, weeks, tx, fixed, minutes, hours: minutes / 60, launch, pool, risk, perpFees, actions,
      expected: C * dropPerDollar(value.mid), expectedLo: C * dropPerDollar(value.p25), expectedHi: C * dropPerDollar(value.p75),
      carry: C * (risk + perpFees), net: net(value.mid), netLo: net(value.p25), netHi: net(value.p75),
      edge: dropPerDollar(value.mid) - risk - perpFees,
    };
  }

  /** The plan at one capital, with its verdict: FARM clears the hourly target even at the P25 value. */
  function planAt(row, C, share) {
    const e = farmEconomics(row, row.value, row.odds, C, share);
    e.capital = C;
    e.hourly = e.net / e.hours;
    e.verdict = e.hourly >= ASSUME.hourTarget && e.netLo > 0 ? 'FARM' : e.net > 0 ? 'MARGINAL' : 'SKIP';
    e.minViable = e.edge > 0 ? Math.ceil(e.fixed / e.edge) : null;
    return e;
  }

  /** Capital: the smallest tier that clears the hourly target, never above 1% of the pool. */
  function sizePlan(row, share) {
    const cap = Math.max(ASSUME.tiers[0], row.tvl * 0.01);
    const tiers = ASSUME.tiers.filter((c) => c <= cap);
    for (const C of tiers) {
      const e = planAt(row, C, share);
      if (e.verdict === 'FARM') return e;
    }
    // No tier clears the target: a positive edge grows with size, a negative one shrinks, so take the end that loses least.
    return planAt(row, planAt(row, tiers[0], share).edge > 0 ? tiers[tiers.length - 1] : tiers[0], share);
  }

  /** The farm plan, step by step: { step, text, cost (dollars), minutes }. board.json carries the text, which
   * states the same cost and time, so the table on the page and the board never disagree. */
  function farmPlan(row, e, asOf, share) {
    const C = e.capital, g = e.gas, steps = [];
    const cost = (x) => (x < 0.995 ? `$${x.toFixed(2)}` : usd(x));
    const add = (step, text, dollars, minutes) => steps.push({ step, text: `${step}: ${text}`, cost: dollars, minutes });
    add('Check', `DefiLlama records no token for ${row.name} on ${asOf}; read its docs, X and CoinGecko for a live token or a points page before funding. Cost $0, about 15 min.`, 0, 15);
    const fee = entryFee(e.chain);
    add('Fund', `withdraw ${usd(C)} USDC from an exchange straight to ${e.chain}${row.chains.length > 1 ? `, the cheapest of its ${row.chains.length} chains` : ', its only chain'}, and keep gas for ${e.tx} transactions at about ${cost(g)} each. Cost ${cost(fee)} withdrawal fee, about 15 min.`, fee, 15);
    e.actions.forEach(([title, what, tx, min]) => {
      if (title === 'Trade' && row.kind === 'dex') {
        add(title, `${what}. Cost ${cost(e.weeks * g)} gas over ${e.weeks} weeks, about 2 min a week.`, e.weeks * g, e.weeks * 2);
        return;
      }
      const fees = title === 'Trade' ? C * e.perpFees : 0;
      add(title, `${what}. Cost ${cost(tx * g + fees)}${fees ? ' in fees and gas' : ' gas'}, about ${min} min.`, tx * g + fees, min);
    });
    add('Hold', `keep it in for ${e.hold} days; check points and the TVL trend weekly (${e.weeks} checks x 5 min). Carry: ${(e.risk * 365 / e.hold * 100).toFixed(1)}% a year of contract and depeg risk on ${usd(C)} = ${usd(C * e.risk)}.`, C * e.risk, e.weeks * 5);
    add('Exit rules', `withdraw early if TVL falls 25% in a week (this week ${pct(row.change7d)}), the points terms change, or a token is announced with its snapshot already past. Cost ${cost(g)} for the exit, about 10 min.`, g, 10);
    add('Claim', `if a token lists, claim and sell or hedge half on day one. At ${(share * 100).toFixed(0)}% of supply to farmers and ${(e.launch * 100).toFixed(0)}% launch odds in the window, ${usd(C)} earns about ${usd(e.expected)} (P25 ${usd(e.expectedLo)}, P75 ${usd(e.expectedHi)}). Cost ${cost(g)}, about 15 min.`, g, 15);
    const mv = e.minViable === null ? 'none: the risk carry beats the expected drop at any size' : usd(e.minViable);
    steps.push({ step: 'Verdict', text: `Verdict ${e.verdict}: net about ${usd(e.net)} (P25 ${usd(e.netLo)}) for ${e.hours.toFixed(1)} h of your time = ${usd(e.hourly)} an hour against a ${usd(ASSUME.hourTarget)} target. Break-even capital: ${mv}.`, cost: null, minutes: null });
    return steps;
  }

  // ---------- 6. Formatting shared by the board and the page ----------
  function usd(x) {
    const a = Math.abs(x), s = x <= -0.5 ? '-$' : '$';
    if (a >= 1e9) return s + (a / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e4) return s + Math.round(a / 1e3) + 'K';
    return s + Math.round(a).toLocaleString('en-US');
  }
  const pct = (x) => (x == null ? 'unreported' : (x > 0 ? '+' : '') + x.toFixed(1) + '%');

  // ---------- 7. The radar: every protocol accounted for, the pre-token ones ranked ----------
  function buildRadar(snapshot, opts) {
    const share = (opts && opts.airdropShare) || ASSUME.airdropShare;
    const rows = prepare(snapshot);
    const model = fitValueModel(rows);
    const odds = fitOddsModel(rows);
    const b = model.band;
    for (const r of rows) {
      r.parts = valueParts(r, model);
      const lv = r.parts.base + r.parts.growth + r.parts.age + r.parts.kind;
      r.value = { log: lv, mid: 10 ** lv, p10: 10 ** (lv + b.p10), p25: 10 ** (lv + b.p25), p75: 10 ** (lv + b.p75), p90: 10 ** (lv + b.p90) };
      r.odds = r.status === 'pre' ? odds.of(r) : null;
      if (r.status === 'comp') r.residual = model.residual.get(r.slug);
    }
    const ranked = rows.filter((r) => r.status === 'pre').sort((x, y) => y.value.mid - x.value.mid || (x.slug < y.slug ? -1 : 1));
    let prev = Infinity;
    ranked.forEach((r, i) => {
      r.rank = i + 1;
      r.implied = Math.max(1, Math.min(prev, Math.round(r.value.mid)));
      prev = r.implied;
      r.farm = sizePlan(r, share);
      r.plan = farmPlan(r, r.farm, snapshot.as_of, share);
    });
    const count = (s) => rows.filter((r) => r.status === s).length;
    return {
      asOf: snapshot.as_of, source: snapshot.source, floor: snapshot.floor_usd, rows, ranked, model, odds, share,
      counts: { all: rows.length, comp: count('comp'), token: count('token'), aside: count('aside'), pre: ranked.length,
        watch: snapshot.watchlist.length, watchRanked: ranked.filter((r) => r.watch).length },
    };
  }

  /** board.json rows: the gate's five fields plus the figures behind them. */
  function boardRows(radar) {
    return radar.ranked.map((r) => ({
      rank: r.rank, slug: r.slug, name: r.name, implied_value_usd: r.implied,
      implied_p25_usd: Math.round(r.value.p25), implied_p75_usd: Math.round(r.value.p75),
      tvl_usd: r.tvl, change_7d: r.change7d, years_on_record: r.age === null ? null : Number(r.age.toFixed(2)),
      category: r.category, kind: r.kind, watchlist: r.watch, token_odds: Number(r.odds.toFixed(4)),
      farm_verdict: r.farm.verdict, farm_capital_usd: r.farm.capital, farm_net_usd: Math.round(r.farm.net),
      farm_hours: Number(r.farm.hours.toFixed(2)), farm_steps: r.plan.map((s) => s.text),
    }));
  }

  const api = { buildRadar, boardRows, classify, fitRidge, quantile, usd, pct, ASSUME, KINDS, KIND_LABEL, sizePlan, planAt, farmPlan, holdDays, valueParts };
  root.RadarModel = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
