"""Lädt alle Vestas-Windenergieanlagen AN LAND in Deutschland aus dem
Marktstammdatenregister (MaStR) der Bundesnetzagentur und speichert sie
kompakt in data/vestas-de.json.

Aufruf:  python update_data.py

Daten: © Bundesnetzagentur, Marktstammdatenregister – Datenlizenz Deutschland
Namensnennung 2.0 (dl-de/by-2-0)
"""
import json
import re
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

TARGET = Path(__file__).parent / "data" / "vestas-de.json"
API = "https://www.marktstammdatenregister.de/MaStR/Einheit/EinheitJson/GetErweiterteOeffentlicheEinheitStromerzeugung"
VESTAS_ID = 1660                       # „Vestas Deutschland GmbH“
FILTER = f"Energieträger~eq~'2497'~and~Hersteller der Windenergieanlage~eq~'{VESTAS_ID}'"
PAGE_SIZE = 5000
KEEP_STATUS = {"In Betrieb", "Vorübergehend stillgelegt"}


def fetch_page(page: int) -> dict:
    url = API + "?" + urllib.parse.urlencode(
        {"sort": "", "page": page, "pageSize": PAGE_SIZE, "group": "", "filter": FILTER}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 windrad-atlas/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except Exception as e:
            print(f"  Seite {page}: Fehler {e} – neuer Versuch …", flush=True)
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f"Seite {page} konnte nicht geladen werden")


def ms_date(v):
    m = re.search(r"(-?\d+)", v or "")
    if not m:
        return ""
    return datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def clean(v):
    v = (v or "").strip() if isinstance(v, str) else v
    return v or None


def main() -> None:
    rows, page = [], 1
    while True:
        d = fetch_page(page)
        data = d.get("Data") or []
        rows += data
        print(f"Seite {page}: {len(data)} Einheiten (gesamt {len(rows)} / {d.get('Total')})", flush=True)
        if not data or len(rows) >= (d.get("Total") or 0):
            break
        page += 1

    stats = Counter()
    out = []
    for x in rows:
        if x.get("WindAnLandOderSeeId") != 888:  # 888 = „Windenergie an Land“
            stats["nicht an Land"] += 1
            continue
        if x.get("BetriebsStatusName") not in KEEP_STATUS:
            stats[f"Status: {x.get('BetriebsStatusName')}"] += 1
            continue
        lat, lon = x.get("Breitengrad"), x.get("Laengengrad")
        if lat is None or lon is None:
            stats["ohne Koordinaten (anonymisiert)"] += 1
            continue
        operator = x.get("AnlagenbetreiberName") or ""
        if operator.startswith("natürliche Person"):
            operator = ""
        out.append({
            "id": x["MaStRNummer"],
            "uid": x["Id"],
            "lat": round(float(lat), 6),
            "lng": round(float(lon), 6),
            "park": clean(x.get("WindparkName")),
            "name": clean(x.get("EinheitName")),
            "model": clean(x.get("Typenbezeichnung")),
            "kw": x.get("Bruttoleistung"),
            "hub": x.get("NabenhoeheWindenergieanlage"),
            "rotor": x.get("RotordurchmesserWindenergieanlage"),
            "operator": clean(operator),
            "start": ms_date(x.get("InbetriebnahmeDatum")),
            "state": clean(x.get("Bundesland")),
            "town": clean(x.get("Gemeinde")),
            "district": clean(x.get("Landkreis")),
            "status": x.get("BetriebsStatusName"),
        })

    TARGET.parent.mkdir(exist_ok=True)
    TARGET.write_text(json.dumps({
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Marktstammdatenregister, Bundesnetzagentur (dl-de/by-2-0)",
        "region": "Deutschland, Windkraft an Land, Hersteller Vestas",
        "turbines": out,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    with_park = sum(1 for t in out if t["park"])
    print(f"\n{len(out)} Vestas-Onshore-Anlagen gespeichert ({with_park} mit Windpark-Namen) -> {TARGET}")
    for k, v in stats.most_common():
        print(f"  aussortiert – {k}: {v}")


if __name__ == "__main__":
    main()
