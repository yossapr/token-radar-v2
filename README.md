# token-radar-v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yossapr/token-radar-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yossapr/token-radar-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token radar: every protocol in the sealed DefiLlama snapshot is placed (priced peer, other token, set-aside derivative or pre-token), the 173 pre-token ones are ranked by the implied value of the token they have not issued, and each carries a farm plan whose every step states its cost and its time.

- **One model, run twice.** `dashboard/model.js` is a plain script. `main.ts` runs it in Node to write `board.json`; the page runs the same file in the browser, rebuilds the board from the raw snapshot and checks it against `board.json` row by row (the ledger prints the match count).
- **Value model.** Six candidate models of `log10 mcap` on the 128 priced peers: log TVL alone, and with 7-day growth, years on record and a category multiple. Each is tested leaving one peer out and walking forward in listing order; each earns its weight from its held-out log score on both tests (pseudo-Bayesian model averaging). The blend beats every single model on both tests and a flat mcap/TVL multiple left one out, and its own held-out misses set the P10..P90 band.
- **Token odds.** A logistic fit over 518 protocols of how often a protocol with this TVL, age, growth and kind already records a token; 10-fold AUC 0.81.
- **Farm plan.** Capital sized to the smallest tier that clears $40 an hour, chain picked by gas, hold set by age, drop share diluted by this week's inflow, risk carried by kind; verdict FARM / MARGINAL / SKIP. Assumptions are stated on the page, and the farmer share and capital can be changed in any detail view.
- **Page.** Board, tokens that trade, set-asides with reasons, method and proof. Sort any column, filter by kind, verdict, chain, watchlist or text; every view is a link (state lives in the hash).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
sh tools/shoot.sh out shots decibel && python tools/fit_png.py shots screenshots
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
