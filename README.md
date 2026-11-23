# Windrad-Atlas – Vestas-Onshore-Anlagen in Deutschland

Moderne Web-App mit allen **Vestas-Windenergieanlagen an Land in Deutschland**
(6.357 Anlagen in Betrieb, davon 6.286 mit Windpark-Namen). Läuft ohne Konto und ohne API-Schlüssel.

## Funktionen
- Karte mit **Satellitenbildern**, OpenStreetMap oder dunkler Ansicht (Umschalter oben rechts), Cluster für tausende Anlagen
- Filter nach **Bundesland** und **Modellreihe** (V90, V112, V150, V162 …)
- Statistik: Anlagen im Ausschnitt, installierte Leistung in MW
- Infofenster je Anlage: **Windpark**, **Anlagen-Nr.** (z. B. WEA 3), Modell, Leistung, Nabenhöhe,
  Rotor, Gesamthöhe, Betreiber, Gemeinde, Bundesland, Inbetriebnahme
- **„Route in Google Maps starten“**: öffnet auf dem Handy direkt die Google-Maps-App mit den
  Koordinaten der Anlage und startet die Navigation
- Außerdem: In Google Maps öffnen, Koordinaten kopieren, Street View, Google Earth, Register-Eintrag
- Suche nach **Windpark-Namen** (z. B. „Roter Berg“) oder nach Orten
- Export als **KML** (Import in Google My Maps / Google Earth) und GeoJSON
- Am Handy als Bottom-Sheet bedienbar

## Als App aufs Handy
Online unter **https://semkoq.github.io/windrad-atlas/** – die Seite ist eine installierbare App (PWA):
- **Android (Chrome):** Button „Installieren“ in der App, oder ⋮-Menü → „App installieren“
- **iPhone (Safari):** Teilen → „Zum Home-Bildschirm“

Danach startet sie mit eigenem Symbol im Vollbild; App und Anlagendaten funktionieren auch offline
(Kartenbilder nur für bereits angesehene Gebiete).

## Starten (lokal)
```powershell
python -m http.server 8080
```
Dann <http://localhost:8080> öffnen.

## Daten aktualisieren
Die Anlagen liegen in `data/vestas-de.json`. Neu laden aus dem Marktstammdatenregister:
```powershell
python update_data.py
```
Berücksichtigt werden: Energieträger Wind, Hersteller „Vestas Deutschland GmbH“, Lage „Windenergie an Land“,
Status „In Betrieb“ oder „Vorübergehend stillgelegt“. Anlagen mit anonymisiertem Standort fehlen.

## Quellen
- Anlagendaten: Marktstammdatenregister der Bundesnetzagentur – Datenlizenz Deutschland Namensnennung 2.0 (dl-de/by-2-0)
- Karten: © OpenStreetMap-Mitwirkende, © CARTO; Satellitenbilder © Esri, Maxar, Earthstar Geographics
- Kartenbibliothek: Leaflet + Leaflet.markercluster
