"""Pull collegefootballdata.com advanced stats, results, and betting lines.

Needs a free key. In CI it comes from the CFBD_API_KEY repository secret and is
never printed. Locally, export it in your own shell:

    export CFBD_API_KEY=...            # get one at collegefootballdata.com/key
    python scripts/fetch_cfbd.py 2014 2025
"""
import os, sys, datetime as dt
from common import get_json, save

BASE = "https://api.collegefootballdata.com"


def key():
    k = os.environ.get("CFBD_API_KEY", "").strip()
    if not k:
        sys.exit("CFBD_API_KEY is not set. See the docstring at the top of this file.")
    return {"Authorization": f"Bearer {k}"}


def season_stats(year, hdr):
    return get_json(f"{BASE}/stats/season/advanced?year={year}&excludeGarbageTime=true", hdr)


def games(year, hdr):
    return get_json(f"{BASE}/games?year={year}&seasonType=regular&division=fbs", hdr)


def lines(year, hdr):
    return get_json(f"{BASE}/lines?year={year}&seasonType=regular", hdr)


def slim_line(rec):
    """Prefer a consensus/closing number; fall back to the median of the books."""
    ls = rec.get("lines") or []
    if not ls:
        return None
    pick = next((l for l in ls if (l.get("provider") or "").lower() == "consensus"), None)
    vals = []
    for l in ls:
        v = l.get("spread")
        if v is None:
            continue
        try:
            vals.append(float(v))
        except (TypeError, ValueError):
            pass
    if not vals:
        return None
    if pick and pick.get("spread") is not None:
        sp = float(pick["spread"])
    else:
        vals.sort()
        sp = vals[len(vals) // 2]
    ou = None
    for l in ls:
        if l.get("overUnder") is not None:
            try:
                ou = float(l["overUnder"])
                break
            except (TypeError, ValueError):
                pass
    # CFBD spread is from the HOME team's side, negative when home is favoured.
    return {"sp": sp, "ou": ou, "books": len(vals)}


def main():
    a = int(sys.argv[1]) if len(sys.argv) > 1 else 2014
    b = int(sys.argv[2]) if len(sys.argv) > 2 else dt.date.today().year
    hdr = key()
    for yr in range(a, b + 1):
        print(f"CFBD {yr}")
        try:
            stats = season_stats(yr, hdr)
            gs = games(yr, hdr)
            ln = lines(yr, hdr)
        except RuntimeError as e:
            print(f"  skipped: {e}")
            continue
        lmap = {}
        for rec in ln:
            s = slim_line(rec)
            if s:
                lmap[str(rec.get("id"))] = s
        slim_games = []
        for g in gs:
            gid = str(g.get("id"))
            if g.get("homePoints") is None or g.get("awayPoints") is None:
                continue
            slim_games.append({
                "id": gid, "w": g.get("week"),
                "h": g.get("homeTeam"), "a": g.get("awayTeam"),
                "hp": g.get("homePoints"), "ap": g.get("awayPoints"),
                "n": 1 if g.get("neutralSite") else 0,
                "line": lmap.get(gid),
            })
        print(f"  {len(stats)} team stat rows, {len(slim_games)} completed games, "
              f"{sum(1 for x in slim_games if x['line'])} with a line")
        save(f"cfbd_{yr}.json", {"year": yr, "stats": stats, "games": slim_games})


if __name__ == "__main__":
    main()
