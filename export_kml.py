"""Erzeugt KML-Dateien aus data/vestas-de.json für Google Maps (My Maps) und Google Earth.

Google My Maps erlaubt max. 2.000 Punkte pro Ebene – daher 4 Regionsdateien
(je eine Ebene) plus eine Gesamtdatei für Google Earth.

Aufruf:  python export_kml.py   -> Dateien in downloads/
"""
import json
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).parent
OUT = ROOT / "downloads"

REGIONS = {
    "Nord": ["Schleswig-Holstein", "Mecklenburg-Vorpommern", "Hamburg", "Bremen", "Niedersachsen"],
    "Ost": ["Brandenburg", "Berlin", "Sachsen"],
    "Mitte": ["Sachsen-Anhalt", "Thüringen", "Hessen", "Nordrhein-Westfalen"],
    "Sued-West": ["Rheinland-Pfalz", "Saarland", "Bayern", "Baden-Württemberg"],
}
# KML-Farben sind aabbggrr
COLORS = {"Nord": "ffd8a038", "Ost": "ff3c8cf5", "Mitte": "ff5ac85a", "Sued-West": "ffd25ab4", "Alle": "fff8bd38"}


def fmt(v, unit, div=1):
    if not v:
        return ""
    n = v / div
    s = f"{n:.1f}".rstrip("0").rstrip(".").replace(".", ",")
    return f"{s} {unit}"


def placemark(t):
    lat, lng = t["lat"], t["lng"]
    title = " – ".join(x for x in (t.get("park"), t.get("name")) if x) or f"Vestas {t.get('model') or ''}".strip()
    lines = [
        ("Windpark", t.get("park")),
        ("Anlage", t.get("name")),
        ("Modell", f"Vestas {t['model']}" if t.get("model") else ""),
        ("Leistung", fmt(t.get("kw"), "MW", 1000)),
        ("Nabenhöhe", fmt(t.get("hub"), "m")),
        ("Rotordurchmesser", fmt(t.get("rotor"), "m")),
        ("Betreiber", t.get("operator")),
        ("Gemeinde", t.get("town")),
        ("Bundesland", t.get("state")),
        ("In Betrieb seit", ".".join(reversed(t["start"].split("-"))) if t.get("start") else ""),
    ]
    desc = "\n".join(f"{k}: {v}" for k, v in lines if v)
    desc += f"\n\nRoute: https://www.google.com/maps/dir/?api=1&destination={lat},{lng}&travelmode=driving"
    data = "".join(
        f'<Data name="{k}"><value>{escape(str(v))}</value></Data>'
        for k, v in [("Windpark", t.get("park")), ("Anlage", t.get("name")), ("Modell", t.get("model")),
                     ("Leistung_kW", t.get("kw")), ("Nabenhoehe_m", t.get("hub")), ("Rotor_m", t.get("rotor")),
                     ("Gemeinde", t.get("town")), ("Bundesland", t.get("state")), ("MaStR_Nr", t.get("id"))]
        if v not in (None, "")
    )
    return (f"<Placemark><name>{escape(title)}</name><description>{escape(desc)}</description>"
            f"<styleUrl>#wea</styleUrl><ExtendedData>{data}</ExtendedData>"
            f"<Point><coordinates>{lng},{lat},0</coordinates></Point></Placemark>")


def write_kml(path, name, turbines, color, by_state=False):
    style = (f'<Style id="wea"><IconStyle><color>{color}</color><scale>0.8</scale>'
             '<Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>')
    if by_state:
        groups = {}
        for t in turbines:
            groups.setdefault(t.get("state") or "Unbekannt", []).append(t)
        body = "".join(
            f"<Folder><name>{escape(s)} ({len(g)})</name>{''.join(placemark(t) for t in g)}</Folder>"
            for s, g in sorted(groups.items())
        )
    else:
        body = "".join(placemark(t) for t in sorted(turbines, key=lambda t: (t.get("park") or "~", t.get("name") or "")))
    path.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
        f"<name>{escape(name)}</name><description>Quelle: Marktstammdatenregister, Bundesnetzagentur (dl-de/by-2-0)</description>"
        f"{style}{body}</Document></kml>",
        encoding="utf-8",
    )
    print(f"{path.name}: {len(turbines)} Anlagen, {path.stat().st_size / 1e6:.1f} MB")


def main():
    turbines = json.loads((ROOT / "data" / "vestas-de.json").read_text(encoding="utf-8"))["turbines"]
    OUT.mkdir(exist_ok=True)
    done = 0
    for region, states in REGIONS.items():
        part = [t for t in turbines if t.get("state") in states]
        assert len(part) <= 2000, f"{region}: {len(part)} > 2000 (Grenze von Google My Maps)"
        write_kml(OUT / f"vestas-{region.lower()}.kml", f"Vestas {region} ({', '.join(states)})", part, COLORS[region])
        done += len(part)
    write_kml(OUT / "vestas-deutschland-alle.kml", "Vestas-Windenergieanlagen an Land – Deutschland", turbines, COLORS["Alle"], by_state=True)
    missing = len(turbines) - done
    print(f"Regionen gesamt: {done} von {len(turbines)}" + (f" – {missing} ohne Region!" if missing else " – vollständig"))


if __name__ == "__main__":
    main()
