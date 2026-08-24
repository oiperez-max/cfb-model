"""Shared helpers: HTTP, team-name resolution, and the opponent-adjustment solver."""
import json, os, re, time, urllib.request, urllib.error, statistics as st
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

UA = "Mozilla/5.0 (compatible; cfb-model/1.0)"


def get_json(url, headers=None, tries=4, pause=2.0):
    """GET with retries. Raises on final failure."""
    hdr = {"User-Agent": UA, "Accept": "application/json"}
    if headers:
        hdr.update(headers)
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=hdr)
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:                      # noqa: BLE001
            last = e
            time.sleep(pause * (i + 1))
    raise RuntimeError(f"GET failed after {tries} tries: {url}\n{last}")


# ---------------------------------------------------------------- team names
def _key(x):
    x = str(x).lower()
    x = re.sub(r"\b(university|univ|the)\b", "", x)
    return re.sub(r"[^a-z0-9]+", " ", x).strip()


_EXPAND = {"st": "state", "n": "northern", "s": "southern", "e": "eastern",
           "w": "western", "c": "central", "fla": "florida", "tx": "texas",
           "va": "virginia", "ga": "georgia", "la": "louisiana", "miss": "mississippi"}


def _expand(x):
    return " ".join(_EXPAND.get(w, w) for w in _key(x).split())


# Hand-checked. Anything not resolvable here is treated as FCS / unrated,
# which is the safe failure mode. Never fuzzy-match: that is how eight FCS
# schools got mapped onto FBS teams in an earlier build.
ALIAS = {
    "ole miss": "Ole Miss", "miami": "Miami", "miami oh": "Miami (OH)",
    "pitt": "Pittsburgh", "uconn": "UConn", "umass": "Massachusetts",
    "ucf": "UCF", "usc": "USC", "ucla": "UCLA", "unlv": "UNLV", "utsa": "UTSA",
    "utep": "UTEP", "uab": "UAB", "byu": "BYU", "tcu": "TCU", "lsu": "LSU",
    "smu": "SMU", "fau": "Florida Atlantic", "fiu": "Florida International",
    "mtsu": "Middle Tennessee", "coastal": "Coastal Carolina",
    "ga southern": "Georgia Southern", "georgia southern": "Georgia Southern",
    "jax state": "Jacksonville State", "western ky": "Western Kentucky",
    "san jose state": "San José State", "san jose st": "San José State",
    "hawai i": "Hawai'i", "hawaii": "Hawai'i", "app state": "App State",
    "appalachian state": "App State", "nc state": "NC State",
    "north carolina state": "NC State", "southern miss": "Southern Miss",
    "ul monroe": "UL Monroe", "louisiana monroe": "UL Monroe",
    "louisiana": "Louisiana", "louisiana lafayette": "Louisiana",
    "texas a m": "Texas A&M", "sam houston": "Sam Houston",
    "massachusetts": "Massachusetts", "connecticut": "UConn",
}


class Resolver:
    """Maps an external team label onto one of the model's canonical names."""

    def __init__(self, canonical):
        self.canon = set(canonical)
        self.by_expanded = {}
        for c in canonical:
            self.by_expanded.setdefault(_expand(c), c)
            self.by_expanded.setdefault(_key(c), c)
        self.misses = {}

    def __call__(self, label):
        if label in self.canon:
            return label
        k, e = _key(label), _expand(label)
        hit = ALIAS.get(k) or ALIAS.get(e) or self.by_expanded.get(e) or self.by_expanded.get(k)
        if hit in self.canon:
            return hit
        self.misses[label] = self.misses.get(label, 0) + 1
        return None

    def report(self):
        if self.misses:
            top = sorted(self.misses.items(), key=lambda kv: -kv[1])[:15]
            print(f"  unresolved labels ({len(self.misses)}): " +
                  ", ".join(f"{k}x{v}" for k, v in top))


# ------------------------------------------------------- opponent adjustment
def solve_srs(off_raw, def_raw, opponents, iters=500, tol=1e-10):
    """Simple ratings system.

    off_raw[t] / def_raw[t] are per-play rates expressed as deviations from the
    league mean (positive def_raw = worse defence). opponents[t] is the list of
    teams t actually played. Returns opponent-adjusted (off, def) dicts,
    each re-centred on zero.
    """
    teams = list(off_raw)
    O, D = dict(off_raw), dict(def_raw)
    for i in range(iters):
        nO, nD = {}, {}
        for t in teams:
            opp = opponents.get(t) or []
            nO[t] = off_raw[t] - (st.mean([D[j] for j in opp]) if opp else 0.0)
            nD[t] = def_raw[t] - (st.mean([O[j] for j in opp]) if opp else 0.0)
        mo, md = st.mean(nO.values()), st.mean(nD.values())
        nO = {k: v - mo for k, v in nO.items()}
        nD = {k: v - md for k, v in nD.items()}
        delta = max(max(abs(nO[k] - O[k]) for k in teams),
                    max(abs(nD[k] - D[k]) for k in teams))
        O, D = nO, nD
        if delta < tol:
            break
    return O, D, i


def corr(a, b):
    if len(a) < 3:
        return 0.0
    ma, mb = st.mean(a), st.mean(b)
    den = (sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b)) ** 0.5
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / den if den else 0.0


def save(name, obj):
    p = DATA / name
    p.write_text(json.dumps(obj, separators=(",", ":")))
    print(f"  wrote {p.relative_to(ROOT)}  ({p.stat().st_size:,} bytes)")
    return p


def load(name, default=None):
    p = DATA / name
    if not p.exists():
        return default
    return json.loads(p.read_text())
