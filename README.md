# CFB Matchup Model

A college football handicapping model that publishes itself to a web page every Tuesday.

Rebuilt from a hand-made spreadsheet. Two ratings run side by side: an opponent-adjusted
EPA model built from play-by-play, and ESPN's FPI. The page shows both against the market
line so you can see where they disagree and, more usefully, where they don't.

---

## Setup, about 10 minutes

### 1. Create the repo

Make a new GitHub repository, then push these files to `main`.

```bash
cd cfb-model
git init
git add .
git commit -m "initial"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/cfb-model.git
git push -u origin main
```

### 2. Turn on Pages

Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Your page will be at `https://YOUR-NAME.github.io/cfb-model/`. That is the link to send
your friend. It updates itself.

### 3. Add the CFBD key

Get a free one at <https://collegefootballdata.com/key>. It arrives by email.

Then **Settings → Secrets and variables → Actions → New repository secret**:

- Name: `CFBD_API_KEY`
- Value: paste the key

Add it through that page only. Never put the key in a file, a commit, or a chat message.
The workflow reads it from the secret store at run time and it stays out of the logs.

Without the key everything still works. The build falls back to the bundled 2025 snapshot
in `data/legacy_2025.json`, and the backtest is unavailable.

### 4. Run it once

**Actions → Refresh and publish → Run workflow.** Two or three minutes later the page is live.

---

## What runs when

| Workflow | Trigger | Does |
|---|---|---|
| `refresh.yml` | Tuesdays 09:00 UTC (3am Edmonton), on push, or manually | Pulls FPI, schedule, scores, and posted lines. Rebuilds ratings. Verifies. Publishes. |
| `backtest.yml` | Monthly or manually | Walk-forward test against closing lines. Writes `BACKTEST.md`. |

Tuesday is deliberate: last week's results are final and the coming week's lines are up.

---

## How the rating mix moves through the season

The page opens with a mix already chosen for you, and a slider if you disagree.

| Weeks played | FPI weight | Why |
|---|---|---|
| 0 (preseason) | 85% | The EPA model is looking at last season's teams. It cannot see the portal. |
| 4 | 57% | Real games are accumulating but the sample is thin. |
| 8 or more | 30% | The EPA model now has current-season play-by-play and earns its weight. |

`scripts/build_site.py → auto_blend()` if you want to change the curve.

Regression toward the mean is applied to the EPA rating only when it is running on a prior
season (35%). Once current-season stats are in, regression drops to zero because the data
already describes the current team.

---

## Why FPI is in here at all

Preseason FPI already contains returning production, recruiting, and transfer portal
movement. Those inputs are subjective and painful to source. The gap between a team's
final FPI last season and its opening FPI this season *is* the roster adjustment,
computed by someone else, for free.

Tested against the 116 posted 2026 lines: FPI sits within 2.35 points of the market at
r = 0.981. The EPA model on 2025 data is 6.87 off at r = 0.817, and on pick-ems under a
touchdown it correlates 0.265, which is noise.

That is not a knock on the EPA model. Run on same-season data it hit r = 0.871 against
that year's lines. The machinery is fine. Feeding it last year's inputs is the problem,
and that fixes itself once games are played.

**A warning about hunting for FPI mispricings.** FPI and the market differ by 3+ on 35 of
116 games, and in 30 of those 35 FPI is the *lower* number. That is a regressed rating
under-pricing favourites, not an edge. Betting every gap means systematically taking big
underdogs. The Reality check tab in the app has the full argument.

---

## Layout

```
scripts/
  common.py         HTTP, team-name resolution, the SRS solver
  fetch_espn.py     FPI, schedule, scores, odds. No key needed.
  fetch_cfbd.py     Advanced stats, results, lines. Needs the key.
  build_ratings.py  Stats + games -> opponent-adjusted ratings
  build_site.py     Merge everything, render site/index.html
  backtest.py       Walk-forward test against closing lines
  verify.py         Sanity checks. Fails CI rather than publishing bad numbers.
web/
  shell.html        Page shell and styles
  app.js            The whole app
data/               Committed snapshots, so a failed fetch never breaks the page
site/index.html     The published page, one self-contained file
```

## Running locally

```bash
python scripts/fetch_espn.py 2026
python scripts/build_site.py 2026
python scripts/verify.py
open site/index.html
```

No dependencies beyond the Python standard library.

---

## Team names

`common.py` resolves external team labels onto canonical names using an explicit alias
table. **It never fuzzy-matches.** An earlier version did, and quietly mapped eight FCS
schools onto FBS teams: Northern Arizona became Arizona, Eastern Washington became
Washington, and the page showed games like "Arizona @ Arizona".

An unrecognised label resolves to `None` and the team is treated as unrated, which is the
safe failure mode. `verify.py` check 3 fails the build if any game has a team playing
itself. If a real FBS team shows up unresolved in the build log, add it to `ALIAS`.

---

## Honest limits

- No injuries, weather, travel, or rest.
- The projected total is the weakest output. The margin is derived from data; the total
  leans on a fixed league scoring baseline.
- Nothing here is proven to beat a closing line. Run the backtest, then paper-track a
  season through the Tracker tab before risking money. Break-even at -110 is 52.38%.
