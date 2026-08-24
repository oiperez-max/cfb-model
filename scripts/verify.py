"""Post-build sanity checks. Fails the CI run rather than publishing bad numbers.

The FCS-mapped-onto-FBS bug that shipped once is check 3. It stays here forever.
"""
import sys, json, statistics as st
from common import load, ROOT

FAIL = []
WARN = []


def check(cond, msg, hard=True):
    if cond:
        return True
    (FAIL if hard else WARN).append(msg)
    return False


def main():
    b = load("bundle.json")
    if not b:
        sys.exit("data/bundle.json is missing. Did build_site.py run?")
    teams, weeks = b["teams"], b["weeks"]

    # 1. team count in the sane FBS range
    check(120 <= len(teams) <= 145, f"team count {len(teams)} outside 120-145")

    # 2. every team has the fields the page reads
    need = ["net", "off", "def", "pam", "fpi26", "raw", "rk", "rNet", "rOff", "rDef"]
    missing = [t for t in teams if any(k not in teams[t] for k in need)]
    check(not missing, f"{len(missing)} teams missing required fields, e.g. {missing[:3]}")

    # 3. no game where a team plays itself (the FCS fuzzy-match bug)
    selfm = [f"{g['an']} @ {g['hn']} (wk {w})"
             for w, gs in weeks.items() for g in gs if g["a"] and g["a"] == g["h"]]
    check(not selfm, f"{len(selfm)} self-matched games: {selfm[:5]}")

    # 4. ratings centred near zero and on a believable scale
    net = [teams[t]["pam"] for t in teams]
    check(abs(st.mean(net)) < 1.5, f"ratings not centred: mean {st.mean(net):.2f}")
    check(6 < st.pstdev(net) < 22, f"rating spread {st.pstdev(net):.1f} outside 6-22")

    # 5. schedule looks like a real season
    tot = sum(len(v) for v in weeks.values())
    rated = sum(1 for v in weeks.values() for g in v if g["a"] and g["h"])
    check(600 <= tot <= 1100, f"{tot} scheduled games outside 600-1100")
    check(rated >= 500, f"only {rated} FBS-vs-FBS games")
    check(len(weeks) >= 10, f"only {len(weeks)} weeks")

    # 6. no team scheduled a wild number of games
    cnt = {}
    for v in weeks.values():
        for g in v:
            for s in ("a", "h"):
                if g[s]:
                    cnt[g[s]] = cnt.get(g[s], 0) + 1
    odd = {t: c for t, c in cnt.items() if c < 8 or c > 17}
    check(not odd, f"teams with an implausible game count: {list(odd.items())[:5]}", hard=False)

    # 7. FPI present and sane
    fpi = [teams[t]["fpi26"] for t in teams]
    check(sum(1 for f in fpi if f != 0) > len(teams) * 0.8, "more than 20% of teams have no FPI")
    check(max(fpi) - min(fpi) > 20, f"FPI range only {max(fpi)-min(fpi):.1f}", hard=False)

    # 8. the page actually rendered
    idx = ROOT / "site" / "index.html"
    check(idx.exists() and idx.stat().st_size > 150_000,
          f"site/index.html missing or too small ({idx.stat().st_size if idx.exists() else 0} bytes)")
    if idx.exists():
        html = idx.read_text()
        check("/*__DATA__*/" not in html and "/*__APP__*/" not in html,
              "template placeholders were not replaced")
        check("const DATA=" in html, "data block missing from the page")

    for w in WARN:
        print(f"WARN  {w}")
    for f in FAIL:
        print(f"FAIL  {f}")
    if FAIL:
        sys.exit(f"\n{len(FAIL)} check(s) failed. Not publishing.")
    print(f"All checks passed. {len(teams)} teams, {tot} games, {len(weeks)} weeks."
          + (f" {len(WARN)} warning(s)." if WARN else ""))


if __name__ == "__main__":
    main()
