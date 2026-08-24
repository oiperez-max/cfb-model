"""Turn CFBD advanced season stats + a game list into opponent-adjusted ratings."""
import statistics as st
from common import solve_srs

# Everything the app displays, as (bundle key, CFBD path, higher-is-better).
FIELDS = [
    ("offPpa",      "offense.ppa",                          1),
    ("defPpa",      "defense.ppa",                          0),
    ("offPass",     "offense.passingPlays.ppa",             1),
    ("offRush",     "offense.rushingPlays.ppa",             1),
    ("defPass",     "defense.passingPlays.ppa",             0),
    ("defRush",     "defense.rushingPlays.ppa",             0),
    ("offSucc",     "offense.successRate",                  1),
    ("defSucc",     "defense.successRate",                  0),
    ("offSuccPass", "offense.passingPlays.successRate",     1),
    ("offSuccRush", "offense.rushingPlays.successRate",     1),
    ("defSuccPass", "defense.passingPlays.successRate",     0),
    ("defSuccRush", "defense.rushingPlays.successRate",     0),
    ("offExp",      "offense.explosiveness",                1),
    ("defExp",      "defense.explosiveness",                0),
    ("offExpPass",  "offense.passingPlays.explosiveness",   1),
    ("offExpRush",  "offense.rushingPlays.explosiveness",   1),
    ("defExpPass",  "defense.passingPlays.explosiveness",   0),
    ("defExpRush",  "defense.rushingPlays.explosiveness",   0),
    ("offPPO",      "offense.pointsPerOpportunity",         1),
    ("defPPO",      "defense.pointsPerOpportunity",         0),
    ("offPower",    "offense.powerSuccess",                 1),
    ("defPower",    "defense.powerSuccess",                 0),
    ("offStuff",    "offense.stuffRate",                    0),
    ("defStuff",    "defense.stuffRate",                    1),
    ("offLY",       "offense.lineYards",                    1),
    ("defLY",       "defense.lineYards",                    0),
    ("offHav",      "offense.havoc.total",                  0),
    ("defHav",      "defense.havoc.total",                  1),
    ("offHavF7",    "offense.havoc.frontSeven",             0),
    ("offHavDB",    "offense.havoc.db",                     0),
    ("defHavF7",    "defense.havoc.frontSeven",             1),
    ("defHavDB",    "defense.havoc.db",                     1),
]


def dig(obj, path):
    cur = obj
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur if isinstance(cur, (int, float)) else None


def extract(stat_rows, games_played=None):
    """CFBD stat rows -> {team: {"raw": {...}, "conf": ...}}.

    Stat values live under "raw" because that is the shape the page reads.
    Teams missing offense.ppa or defense.ppa are dropped.
    """
    out = {}
    for row in stat_rows:
        name = row.get("team")
        if not name:
            continue
        raw = {k: dig(row, path) for k, path, _ in FIELDS}
        if raw.get("offPpa") is None or raw.get("defPpa") is None:
            continue
        gp = (games_played or {}).get(name) or 12
        plays = dig(row, "offense.plays")
        drives = dig(row, "offense.drives")
        raw["plays"] = round(plays / gp, 1) if plays else 61.0
        raw["drives"] = round(drives / gp, 1) if drives else 10.6
        out[name] = {"raw": raw, "conf": row.get("conference") or ""}
    return out


def rank_all(teams):
    """Add a national rank for every numeric field, direction-aware.

    Missing values are ranked last rather than crashing the sort.
    """
    n = len(teams)
    for key, _path, hi in FIELDS:
        for t in teams:
            teams[t].setdefault("rk", {})
        have = [t for t in teams if teams[t]["raw"].get(key) is not None]
        miss = [t for t in teams if teams[t]["raw"].get(key) is None]
        have.sort(key=lambda t: -teams[t]["raw"][key] if hi else teams[t]["raw"][key])
        for i, t in enumerate(have):
            teams[t]["rk"][key] = i + 1
        for t in miss:
            teams[t]["rk"][key] = n
            teams[t]["raw"][key] = 0.0


def build(stat_rows, games, plays_per_game=61.0):
    """games: iterable of dicts with 'h' and 'a' canonical team names.

    Returns (teams, meta). Each team gets off / def / net in points-per-play
    above average, plus pam (points per game above an average team).
    """
    gp = {}
    for g in games:
        for side in ("h", "a"):
            if g.get(side):
                gp[g[side]] = gp.get(g[side], 0) + 1
    teams = extract(stat_rows, gp)
    if not teams:
        return {}, {"error": "no usable stat rows"}

    opponents = {t: [] for t in teams}
    used = 0
    for g in games:
        h, a = g.get("h"), g.get("a")
        if h in teams and a in teams:
            opponents[h].append(a)
            opponents[a].append(h)
            used += 1

    lg_off = st.mean(teams[t]["raw"]["offPpa"] for t in teams)
    lg_def = st.mean(teams[t]["raw"]["defPpa"] for t in teams)
    off_raw = {t: teams[t]["raw"]["offPpa"] - lg_off for t in teams}
    def_raw = {t: teams[t]["raw"]["defPpa"] - lg_def for t in teams}

    O, D, iters = solve_srs(off_raw, def_raw, opponents)
    for t in teams:
        teams[t]["off"] = round(O[t], 5)
        teams[t]["def"] = round(D[t], 5)
        teams[t]["net"] = round(O[t] - D[t], 5)
        teams[t]["pam"] = round((O[t] - D[t]) * plays_per_game, 2)
        teams[t]["gp"] = len(opponents[t])

    rank_all(teams)
    order = sorted(teams, key=lambda t: -teams[t]["net"])
    for i, t in enumerate(order):
        teams[t]["rNet"] = i + 1
    for i, t in enumerate(sorted(teams, key=lambda t: -teams[t]["off"])):
        teams[t]["rOff"] = i + 1
    for i, t in enumerate(sorted(teams, key=lambda t: teams[t]["def"])):
        teams[t]["rDef"] = i + 1

    return teams, {"teams": len(teams), "games_used": used, "srs_iters": iters,
                   "lg_off": round(lg_off, 5), "lg_def": round(lg_def, 5)}
