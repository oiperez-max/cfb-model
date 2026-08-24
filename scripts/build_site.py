"""Merge ESPN + CFBD into the bundle the page reads, then render index.html.

Runs with whatever data is present:
  * ESPN only            -> FPI ratings, schedule, posted lines
  * ESPN + current CFBD  -> full EPA model on this season's games (in-season)
  * ESPN + prior CFBD    -> EPA model on last season, regressed (preseason)
"""
import json, math, sys, datetime as dt, statistics as st
from pathlib import Path
from common import ROOT, DATA, load, save, Resolver, corr
from build_ratings import build

WEB = ROOT / "web"
OUT = ROOT / "site"
PLAYS = 61.0
LGPPG = 28.5
HFA = 2.2
MIN_GAMES_FOR_CURRENT = 4        # games per team before this season's stats are trusted


def auto_blend(weeks_played):
    """How much weight FPI gets. Heavy early, fades as real games accumulate."""
    if weeks_played <= 0:
        return 0.85
    return round(max(0.30, 0.85 - 0.07 * weeks_played), 2)


def pick_stats(season):
    cur = load(f"cfbd_{season}.json")
    if cur:
        played = {}
        for g in cur.get("games", []):
            played[g["h"]] = played.get(g["h"], 0) + 1
            played[g["a"]] = played.get(g["a"], 0) + 1
        if played and st.median(played.values()) >= MIN_GAMES_FOR_CURRENT:
            return cur, season, "current season"
    prev = load(f"cfbd_{season-1}.json")
    if prev:
        return prev, season - 1, "prior season"
    legacy = load("legacy_2025.json")
    if legacy:
        return legacy, 2025, "bundled 2025 snapshot"
    return None, None, "none"


def main():
    season = int(sys.argv[1]) if len(sys.argv) > 1 else dt.date.today().year
    espn = load(f"espn_{season}.json")
    if not espn:
        sys.exit(f"data/espn_{season}.json is missing. Run scripts/fetch_espn.py first.")

    stats_blob, stats_year, stats_src = pick_stats(season)
    if not stats_blob:
        sys.exit("No CFBD stats found and no bundled fallback. Run scripts/fetch_cfbd.py.")
    print(f"stats source: {stats_src} ({stats_year})")

    teams, meta = build(stats_blob["stats"], stats_blob.get("games", []), PLAYS)
    print(f"  ratings: {meta}")
    if not teams:
        sys.exit("ratings build produced nothing")

    res = Resolver(teams.keys())

    # ---- FPI, keyed by ESPN team id ----
    id2name, fpi_cur, fpi_prev = {}, {}, {}
    for tid, rec in espn.get("fpi", {}).items():
        nm = res(rec["n"]) or res(rec["d"])
        if nm:
            id2name[tid] = nm
            fpi_cur[nm] = rec["fpi"]
    for rec in espn.get("fpi_prev", {}).values():
        nm = res(rec["n"]) or res(rec["d"])
        if nm:
            fpi_prev[nm] = rec["fpi"]
    for tid, rec in espn.get("teams", {}).items():
        if tid not in id2name:
            nm = res(rec["n"]) or res(rec["d"])
            if nm:
                id2name[tid] = nm
    res.report()
    print(f"  ESPN ids mapped: {len(id2name)}  FPI values: {len(fpi_cur)}")

    dupes = {}
    for tid, nm in id2name.items():
        dupes.setdefault(nm, []).append(tid)
    bad = {k: v for k, v in dupes.items() if len(v) > 1}
    if bad:
        print(f"  WARNING: {len(bad)} model teams claimed by more than one ESPN id: {list(bad)[:5]}")

    # teamrankings yards-per-attempt block, carried forward so the friend's
    # original YPP metric still renders. Absent teams degrade to nulls.
    trblob = load("teamrankings_2025.json", {}) or {}
    trmap, sosmap = trblob.get("tr", {}), trblob.get("sos", {})
    recmap = trblob.get("rec", {})

    for t in teams:
        teams[t]["fpi26"] = fpi_cur.get(t, 0.0)
        teams[t]["fpi25"] = fpi_prev.get(t, 0.0)
        teams[t]["s"] = t
        teams[t]["tr"] = trmap.get(t, {"rush": None, "pass": None, "defrush": None,
                                       "defpass": None, "rushV": None, "passV": None,
                                       "defrushV": None, "defpassV": None})
        teams[t]["sos"] = sosmap.get(t)
        teams[t].setdefault("w", None)
        teams[t].setdefault("l", None)
    for i, t in enumerate(sorted(teams, key=lambda x: -teams[x]["fpi26"])):
        teams[t]["rFpi"] = i + 1

    # ---- records from completed games ----
    wl = {t: [0, 0] for t in teams}
    for g in espn.get("games", []):
        if "hs" not in g:
            continue
        h, a = id2name.get(g["hid"]), id2name.get(g["aid"])
        if not h or not a:
            continue
        if g["hs"] > g["as"]:
            wl[h][0] += 1; wl[a][1] += 1
        elif g["as"] > g["hs"]:
            wl[a][0] += 1; wl[h][1] += 1
    played_any = sum(w + l for w, l in wl.values()) > 0
    for t in teams:
        if played_any:
            teams[t]["w"], teams[t]["l"] = wl[t]
            teams[t]["recYear"] = season
        else:                                   # preseason: show last year's record
            prev = recmap.get(t) or [None, None]
            teams[t]["w"], teams[t]["l"] = prev
            teams[t]["recYear"] = season - 1

    # ---- schedule ----
    weeks, played_weeks = {}, set()
    for g in espn.get("games", []):
        h, a = id2name.get(g["hid"]), id2name.get(g["aid"])
        if not h and not a:
            continue
        if "hs" in g:
            played_weeks.add(g["w"])
        weeks.setdefault(str(g["w"]), []).append({
            "a": a, "h": h, "an": a or g["an"], "hn": h or g["hn"],
            "d": g["d"][:10], "t": g["d"][11:16], "n": g["n"],
            "m": (-float(g["sp"]) if g.get("sp") is not None else None),
            "ou": g.get("ou"),
            "hs": g.get("hs"), "as": g.get("as"),
        })
    for w in weeks:
        weeks[w].sort(key=lambda x: (x["d"], x["t"]))
    weeks = {k: weeks[k] for k in sorted(weeks, key=int)}
    self_match = sum(1 for v in weeks.values() for g in v if g["a"] and g["a"] == g["h"])
    if self_match:
        print(f"  WARNING: {self_match} self-matched games. Check the name resolver.")

    tot = sum(len(v) for v in weeks.values())
    rated = sum(1 for v in weeks.values() for g in v if g["a"] and g["h"])
    lines = sum(1 for v in weeks.values() for g in v if g["m"] is not None and g["a"] and g["h"])
    print(f"  schedule: {tot} games, {rated} FBS-vs-FBS, {lines} with a line, "
          f"{len(played_weeks)} weeks played")

    blend = auto_blend(len(played_weeks))
    reg = 0.0 if stats_year == season else 0.35
    print(f"  auto blend: {int(blend*100)}% FPI   regression on EPA: {int(reg*100)}%")

    # ---- calibration against whatever lines are posted ----
    rows = []
    for v in weeks.values():
        for g in v:
            if not (g["a"] and g["h"]) or g["m"] is None:
                continue
            hf = 0 if g["n"] else HFA
            rows.append({
                "mkt": g["m"],
                "epa": (teams[g["h"]]["net"] - teams[g["a"]]["net"]) * (1 - reg) * PLAYS + hf,
                "fpi": (teams[g["h"]]["fpi26"] - teams[g["a"]]["fpi26"]) + hf})

    def blk(sub):
        if not sub:
            return None
        mk = [r["mkt"] for r in sub]
        o = {"n": len(sub)}
        for k in ("epa", "fpi"):
            P = [r[k] for r in sub]
            o[k] = {"mae": round(st.mean(abs(x - y) for x, y in zip(P, mk)), 2),
                    "bias": round(st.mean(x - y for x, y in zip(P, mk)), 2),
                    "r": round(corr(P, mk), 3)}
        return o

    calib = {"all": blk(rows),
             "pk": blk([r for r in rows if abs(r["mkt"]) < 7]),
             "mid": blk([r for r in rows if 7 <= abs(r["mkt"]) < 14]),
             "big": blk([r for r in rows if 14 <= abs(r["mkt"]) < 21]),
             "blow": blk([r for r in rows if abs(r["mkt"]) >= 21])}
    calib = {k: v for k, v in calib.items() if v}
    if "all" in calib:
        print(f"  calibration: EPA MAE {calib['all']['epa']['mae']} r {calib['all']['epa']['r']} | "
              f"FPI MAE {calib['all']['fpi']['mae']} r {calib['all']['fpi']['r']}")

    static = load("analysis.json", {}) or {}
    bundle = {
        "season": season, "prev": season - 1,
        "rec_year": (season if any((teams[t].get("recYear") == season) for t in teams) else season - 1),
        "stats_year": stats_year, "stats_src": stats_src,
        "built": dt.datetime.utcnow().isoformat(timespec="minutes") + "Z",
        "teams": teams, "weeks": weeks,
        "const": {"PLAYS": PLAYS, "LGPPG": LGPPG, "HFA": HFA, "REG": reg, "BLEND": blend},
        "evidence": static.get("evidence", {"n": 803, "corr": 0.871, "mae": 4.96,
                                            "sdModel": 12.75, "sdMarket": 13.04}),
        "calib": calib,
        "regr": static.get("regr", []),
        "fpiFit": static.get("fpiFit", {"r_fpi25": 0.962, "cvR2": 0.961,
                                        "residSd": 3.31, "nLines": len(rows)}),
        "backtest": load("backtest_summary.json"),
    }
    save("bundle.json", bundle)

    OUT.mkdir(exist_ok=True)
    shell = (WEB / "shell.html").read_text()
    app = (WEB / "app.js").read_text()
    html = shell.replace("/*__DATA__*/", "const DATA=" + json.dumps(bundle, separators=(",", ":")) + ";")
    html = html.replace("/*__APP__*/", app)
    (OUT / "index.html").write_text(html)
    (OUT / ".nojekyll").write_text("")
    print(f"  wrote site/index.html ({len(html):,} bytes)")


if __name__ == "__main__":
    main()
