# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yangqingggui-a11y/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yangqingggui-a11y/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar reads a sealed snapshot of 758 DeFi protocols and ranks the ones that record no
token by the value a token would claim from their own figures: TVL, seven-day TVL growth, how
long the protocol has run with no token, and how many chains it reaches. It covers all 40
watchlist protocols, adds 186 pre-token protocols below the watchlist floor, sets the 24
live-token protocols aside, and gives every ranked row a farm plan with the cost and the time
of each step.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

The program writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and
`out/dossier.json`. Open `out/dashboard/index.html` in a browser to read the board: sortable
columns, a search, a family filter, a chain filter, a watchlist switch, a detail drawer for each
protocol and a methodology panel that prints the formula and every multiplier.

---

<sub>Entered on [make.fun](https://make.fun?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
