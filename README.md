# token-radar-v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yossapr/token-radar-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yossapr/token-radar-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token radar: every protocol in the sealed DefiLlama snapshot is placed (priced peer, other token, set-aside derivative or pre-token), the 193 pre-token ones (40 watchlist, 20 off-list above the floor, 133 early below it) are ranked by the implied value of the token they have not issued, and each carries a farm plan whose every step states its cost and its time.

- **One model, run twice.** `dashboard/model.js` is a plain script. `main.ts` runs it in Node to write `board.json`; the page runs the same file, rebuilds the board from the raw snapshot and prints six checks: rows recomputed, order, totals, checksum, watchlist and the 758-protocol ledger.
- **Implied value = launch value x token odds.** Both models are built term by term. A candidate term is kept only if it lowers the held-out score on both tests (leave-one-out or ten-fold, and forward in listing order) and its sign holds in 90% of bootstrap refits; every tested term is shown with its scores, kept or not.
  - Launch value, `log10(mcap / TVL)` on 94 stand-alone priced peers: the size curve is kept (miss x3.65 left out, x2.02 forward, against x4.26 and x4.18 for one flat multiple); category, 7-day growth, years listed and chain count are tested and not kept.
  - Token odds, a logistic over 504 stand-alone protocols: years listed, category, size and 7-day growth are kept (forward Brier 0.232 against 0.345 for the base rate); chain count is not. The page prints the record behind the odds: the share of protocols that record a token by years listed.
- **Honest ranges.** P25-P75 and P10-P90 come from the kept model's own held-out misses; bootstrap standard errors on every kept coefficient; each row's rank range comes from 200 bootstrap refits.
- **Farm plan.** Eight to nine timed steps (wallet, verify, fund, the kind's actions, hold, exit rule with a dollar trigger, record, claim) with cost and minutes each; capital sized to the smallest tier that clears $25 an hour; a T-bill benchmark and a drop-share x deposit grid in every detail.
- **Page.** Board, tokens that trade, set-asides with reasons. Sort any column; filter by verdict, tier, kind, chain or text; tick rows to compare them; change the deposit and drop share and every plan re-runs; export the view as CSV or JSON. Every view is a link.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
sh tools/shoot.sh out shots firelight && python tools/fit_png.py shots screenshots
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
