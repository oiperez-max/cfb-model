"""Pull ESPN FPI, the season schedule, and posted odds. No API key needed."""
import sys, datetime as dt
from common import get_json, save

FPI = ("https://site.web.api.espn.com/apis/fitt/v3/sports/football/"
       "college-football/powerindex?season={season}&limit=200")
SB = ("https://site.api.espn.com/apis/site/v2/sports/football/college-football/"
      "scoreboard?dates={season}&seasontype=2&week={week}&groups=80&limit=400")


def fetch_fpi(season):
    j = get_json(FPI.format(season=season))
    out = {}
    for t in j.get("teams", []):
        cat = next((c for c in t.get("categories", []) if c.get("name") == "fpi"), None)
        if not cat or not cat.get("values"):
            continue
        out[t["team"]["id"]] = {"n": t["team"]["shortDisplayName"],
                                "d": t["team"]["displayName"],
                                "fpi": round(float(cat["values"][0]), 3)}
    return out


def fetch_schedule(season, max_week=16):
    games, teams = [], {}
    for w in range(1, max_week + 1):
        j = get_json(SB.format(season=season, week=w))
        for e in j.get("events", []):
            comp = (e.get("competitions") or [None])[0]
            if not comp:
                continue
            cs = comp.get("competitors", [])
            h = next((c for c in cs if c.get("homeAway") == "home"), None)
            a = next((c for c in cs if c.get("homeAway") == "away"), None)
            if not h or not a:
                continue
            for c in (h, a):
                teams[c["team"]["id"]] = {"n": c["team"]["shortDisplayName"],
                                          "d": c["team"]["displayName"]}
            odds = (comp.get("odds") or [{}])[0]
            row = {"w": w, "d": e["date"], "hid": h["team"]["id"], "aid": a["team"]["id"],
                   "hn": h["team"]["shortDisplayName"], "an": a["team"]["shortDisplayName"],
                   "n": 1 if comp.get("neutralSite") else 0,
                   "sp": odds.get("spread"), "ou": odds.get("overUnder")}
            # final scores, present once a game is played
            try:
                if comp.get("status", {}).get("type", {}).get("completed"):
                    row["hs"] = int(h.get("score"))
                    row["as"] = int(a.get("score"))
            except (TypeError, ValueError):
                pass
            games.append(row)
    return games, teams


def main():
    season = int(sys.argv[1]) if len(sys.argv) > 1 else dt.date.today().year
    print(f"ESPN pull for {season}")
    fpi_cur = fetch_fpi(season)
    print(f"  FPI {season}: {len(fpi_cur)} teams")
    fpi_prev = fetch_fpi(season - 1)
    print(f"  FPI {season-1}: {len(fpi_prev)} teams")
    games, teams = fetch_schedule(season)
    played = sum(1 for g in games if "hs" in g)
    lines = sum(1 for g in games if g.get("sp") is not None)
    print(f"  schedule: {len(games)} games, {played} played, {lines} with a line, {len(teams)} teams seen")
    save(f"espn_{season}.json", {"season": season, "fpi": fpi_cur, "fpi_prev": fpi_prev,
                                 "games": games, "teams": teams,
                                 "pulled": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"})


if __name__ == "__main__":
    main()
