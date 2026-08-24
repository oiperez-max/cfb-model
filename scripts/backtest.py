"""Walk-forward backtest: does the model beat the closing line?

For each season and each week W, ratings are built from games played in weeks
1..W-1 only, then used to predict week W. No lookahead. Every prediction is
compared to the market spread and to what actually happened.

    export CFBD_API_KEY=...
    python scripts/backtest.py 2015 2025

Snapshots are cached under data/cache/ so re-runs are cheap.
"""
import json, os, sys, time, statistics as st
from pathlib import Path
from common import get_json, DATA, ROOT, save, corr
from build_ratings import build

CACHE = DATA / "cache"
CACHE.mkdir(parents=True, exist_ok=True)
BASE = "https://api.collegefootballdata.com"
MIN_WEEK = 5          # need a few weeks of games before ratings mean anything
JUICE = -110


def hdr():
    k = os.environ.get("CFBD_API_KEY", "").strip()
    if not k:
        sys.exit("CFBD_API_KEY is not set.")
    return {"Authorization": f"Bearer {k}"}


def cached(name, fn):
    p = CACHE / name
    if p.exists():
        return json.loads(p.read_text())
    val = fn()
    p.write_text(json.dumps(val, separators=(",", ":")))
    time.sleep(0.4)
    return val


def stats_through(year, end_week, h):
    return cached(f"stats_{year}_w{end_week}.json",
                  lambda: get_json(f"{BASE}/stats/season/advanced?year={year}"
                                   f"&endWeek={end_week}&excludeGarbageTime=true", h))


def season_games(year, h):
    return cached(f"games_{year}.json",
                  lambda: get_json(f"{BASE}/games?year={year}&seasonType=regular&division=fbs", h))


def season_lines(year, h):
    return cached(f"lines_{year}.json",
                  lambda: get_json(f"{BASE}/lines?year={year}&seasonType=regular", h))


def consensus(rec):
    ls = rec.get("lines") or []
    vals = []
    for l in ls:
        try:
            if l.get("spread") is not None:
                vals.append(float(l["spread"]))
        except (TypeError, ValueError):
            pass
    if not vals:
        return None
    pick = next((l for l in ls if (l.get("provider") or "").lower() == "consensus"), None)
    if pick and pick.get("spread") is not None:
        try:
            return float(pick["spread"])
        except (TypeError, ValueError):
            pass
    vals.sort()
    return vals[len(vals) // 2]


def payout(win, push):
    if push:
        return 0.0
    return 100 / abs(JUICE) if win else -1.0


def run(years):
    h = hdr()
    rows = []
    for year in years:
        gs = season_games(year, h)
        ln = {str(r.get("id")): consensus(r) for r in season_lines(year, h)}
        by_week = {}
        for g in gs:
            if g.get("homePoints") is None:
                continue
            by_week.setdefault(g.get("week"), []).append(g)
        weeks = sorted(w for w in by_week if isinstance(w, int))
        print(f"{year}: {len(gs)} games, weeks {weeks[0] if weeks else '-'}..{weeks[-1] if weeks else '-'}")
        for W in [w for w in weeks if w >= MIN_WEEK]:
            try:
                stats = stats_through(year, W - 1, h)
            except RuntimeError as e:
                print(f"  w{W}: stats failed, skipped ({e})")
                continue
            prior = [{"h": g.get("homeTeam"), "a": g.get("awayTeam")}
                     for w in weeks if w < W for g in by_week[w]]
            teams, meta = build(stats, prior)
            if len(teams) < 80:
                continue
            n = 0
            for g in by_week[W]:
                hm, aw = g.get("homeTeam"), g.get("awayTeam")
                if hm not in teams or aw not in teams:
                    continue
                sp = ln.get(str(g.get("id")))
                if sp is None:
                    continue
                hf = 0.0 if g.get("neutralSite") else 2.2
                model = (teams[hm]["net"] - teams[aw]["net"]) * 61.0 + hf
                market = -float(sp)                        # market implied home margin
                actual = g["homePoints"] - g["awayPoints"]
                rows.append({"y": year, "w": W, "h": hm, "a": aw,
                             "model": round(model, 2), "market": market, "actual": actual})
                n += 1
            print(f"  w{W}: {len(teams)} rated, {n} graded")
    return rows


def grade(rows):
    if not rows:
        print("no rows to grade")
        return {}
    model = [r["model"] for r in rows]
    market = [r["market"] for r in rows]
    actual = [r["actual"] for r in rows]
    out = {"n": len(rows),
           "mae_model_vs_actual": round(st.mean(abs(m - a) for m, a in zip(model, actual)), 3),
           "mae_market_vs_actual": round(st.mean(abs(m - a) for m, a in zip(market, actual)), 3),
           "mae_model_vs_market": round(st.mean(abs(m - k) for m, k in zip(model, market)), 3),
           "r_model_actual": round(corr(model, actual), 4),
           "r_market_actual": round(corr(market, actual), 4),
           "bias_model": round(st.mean(m - a for m, a in zip(model, actual)), 3)}

    print("\n" + "=" * 74)
    print(f"{out['n']:,} graded games")
    print(f"  model  vs actual margin : MAE {out['mae_model_vs_actual']:.2f}   r {out['r_model_actual']:.3f}")
    print(f"  MARKET vs actual margin : MAE {out['mae_market_vs_actual']:.2f}   r {out['r_market_actual']:.3f}")
    print("  If the model's MAE is not below the market's, it has no standalone edge.")
    print("=" * 74)
    print(f"\n{'edge>=':>7} {'bets':>7} {'W':>6} {'L':>6} {'P':>4} {'hit%':>7} {'units':>9} {'ROI%':>8}")
    tiers = []
    for thr in range(0, 11):
        w = l = p = 0
        units = 0.0
        for r in rows:
            edge = r["model"] - r["market"]
            if abs(edge) < thr:
                continue
            # bet the side the model prefers, graded against the market number
            cover = r["actual"] - r["market"]          # >0 means home covered
            if abs(cover) < 1e-9:
                p += 1
                continue
            win = (cover > 0) if edge > 0 else (cover < 0)
            w += win
            l += (not win)
            units += payout(win, False)
        bets = w + l
        hit = 100 * w / bets if bets else 0.0
        roi = 100 * units / bets if bets else 0.0
        tiers.append({"thr": thr, "bets": bets, "w": w, "l": l, "push": p,
                      "hit": round(hit, 2), "units": round(units, 2), "roi": round(roi, 2)})
        flag = "  <-- profitable" if roi > 0 and bets >= 100 else ""
        print(f"{thr:>7} {bets:>7} {w:>6} {l:>6} {p:>4} {hit:>6.2f}% {units:>9.2f} {roi:>7.2f}%{flag}")
    print("\nBreak-even at -110 is 52.38%. Anything under that with a large sample is a losing system.")
    out["tiers"] = tiers
    return out


def main():
    a = int(sys.argv[1]) if len(sys.argv) > 1 else 2015
    b = int(sys.argv[2]) if len(sys.argv) > 2 else 2025
    rows = run(range(a, b + 1))
    res = grade(rows)
    save("backtest_rows.json", rows)
    save("backtest_summary.json", res)
    (ROOT / "BACKTEST.md").write_text(report(res))
    print(f"\nwrote BACKTEST.md")


def report(res):
    if not res:
        return "# Backtest\n\nNo results.\n"
    L = ["# Backtest: model vs closing line", "",
         f"Walk-forward. Ratings for week W use only weeks 1..W-1. {res['n']:,} graded games.", "",
         "## Predicting the actual margin", "",
         "| | MAE | r |", "|---|---|---|",
         f"| Model | {res['mae_model_vs_actual']:.2f} | {res['r_model_actual']:.3f} |",
         f"| Market | {res['mae_market_vs_actual']:.2f} | {res['r_market_actual']:.3f} |", "",
         "If the model's MAE is not lower than the market's, it has no standalone edge.", "",
         "## Against the spread, by edge size", "",
         "| Edge >= | Bets | W | L | Push | Hit % | Units | ROI % |", "|---|---|---|---|---|---|---|---|"]
    for t in res["tiers"]:
        L.append(f"| {t['thr']} | {t['bets']} | {t['w']} | {t['l']} | {t['push']} | "
                 f"{t['hit']:.2f} | {t['units']:.2f} | {t['roi']:.2f} |")
    L += ["", "Break-even at -110 is 52.38%. Treat any tier with fewer than 100 bets as noise.", ""]
    return "\n".join(L)


if __name__ == "__main__":
    main()
