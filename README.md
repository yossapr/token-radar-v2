# token-radar-v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yossapr/token-radar-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yossapr/token-radar-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token radar: every protocol in the sealed DefiLlama snapshot is placed (priced peer, other token, set-aside derivative or pre-token), the 173 pre-token ones are ranked by the implied value of the token they have not issued, and each carries a farm plan whose every step states its cost and its time.

- **One model, run twice.** `dashboard/model.js` is a plain script. `main.ts` runs it in Node to write `board.json`; the page runs the same file, rebuilds the board from the raw snapshot and prints six checks: rows recomputed, order, totals, checksum, watchlist and the 758-protocol ledger.
- **Implied value = launch value x token odds.** Launch value: six candidate models of `log10 mcap` on 94 stand-alone priced peers (log TVL alone, and with 7-day growth, years listed and a category multiple), each refitted leaving one peer out and run forward in listing order, weighted by its held-out log score on both tests. The blend misses a real cap by x3.51 left out and x2.24 forward, against x4.60 and x4.16 for a flat multiple. Token odds: a logistic fit over 484 stand-alone protocols; forward Brier 0.214 against 0.342 for the base rate.
- **Honest ranges.** The P25-P75 and P10-P90 bands come from the blend's own held-out misses (forward coverage 55% and 83%); each row's rank range comes from 200 bootstrap refits.
- **Farm plan.** Nine timed steps (wallet, verify, fund, the kind's actions, hold, exit rule with a dollar trigger, record, claim) with cost and minutes each; capital sized to the smallest tier that clears $25 an hour; a T-bill benchmark and a drop-share x deposit grid in every detail.
- **Page.** Board, tokens that trade, set-asides with reasons. Sort any column; filter by verdict, tier, kind, chain or text; change the deposit and drop share and every plan re-runs; export the view as CSV or JSON. Every view is a link.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
sh tools/shoot.sh out shots xrpl-dex && python tools/fit_png.py shots screenshots
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
