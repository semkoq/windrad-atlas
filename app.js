'use strict';

/* =========================================================
   Vestas Windrad-Atlas Deutschland
   Karte: Leaflet + OpenStreetMap / Esri-Satellitenbilder (ohne API-Schlüssel)
   Daten: Marktstammdatenregister der Bundesnetzagentur
          (Windenergie an Land, Hersteller Vestas) – data/vestas-de.json
   ========================================================= */

const CONFIG = Object.assign(
  { startCenter: { lat: 51.2, lng: 10.4 }, startZoom: 6 },
  window.APP_CONFIG || {}
);

const DATA_URL = 'data/vestas-de.json';
const DE_BOUNDS = { north: 56.2, south: 46.2, west: 4.0, east: 17.2 };
const LIST_LIMIT = 150;

const ICON = '<svg viewBox="0 0 24 24"><path d="M12 11l.7 11h-1.4z"/><path d="M12 10.5C11.2 7 11.3 3.6 12 1.8c.7 1.8.8 5.2 0 8.7z"/><path d="M12 10.5C11.2 7 11.3 3.6 12 1.8c.7 1.8.8 5.2 0 8.7z" transform="rotate(120 12 10.5)"/><path d="M12 10.5C11.2 7 11.3 3.6 12 1.8c.7 1.8.8 5.2 0 8.7z" transform="rotate(240 12 10.5)"/></svg>';

const $ = (s) => document.querySelector(s);
const nf = new Intl.NumberFormat('de-DE');
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const state = {
  map: null,
  clusterer: null,
  turbines: new Map(),   // id -> turbine
  markers: new Map(),    // id -> L.Marker
  family: 'all',
  region: 'all',         // Bundesland
  selected: null,
  busy: 0,
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- UI-Helfer ---------------- */

function setStatus(text, kind = '') {
  const el = $('#status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}

function busy(delta) {
  state.busy = Math.max(0, state.busy + delta);
  $('#progress').hidden = state.busy === 0;
}

/* ---------------- Daten ---------------- */

function familyOf(model) {
  if (!model) return 'Unbekannt';
  const m = model.match(/\bV\s?-?(\d{2,3})/i);
  return m ? 'V' + m[1] : 'Sonstige';
}

const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null);

function fromRecord(r) {
  if (r.lat == null || r.lng == null) return null;
  return {
    id: r.id,          // MaStR-Nummer
    uid: r.uid,        // interne MaStR-Id (für Detail-Link)
    lat: r.lat,
    lng: r.lng,
    model: r.model || '',
    family: familyOf(r.model),
    mw: num(r.kw) ? r.kw / 1000 : null,
    hub: num(r.hub),
    rotor: num(r.rotor),
    operator: r.operator || '',
    park: r.park || '',
    name: r.name || '',
    ref: '',
    start: r.start || '',
    region: r.state || '',
    town: r.town || '',
    district: r.district || '',
    status: r.status || '',
  };
}

function ingest(records) {
  for (const r of records) {
    const t = fromRecord(r);
    if (t) state.turbines.set(t.id, t);
  }
  renderRegions();
  renderChips();
  renderMarkers();
  $('#statTotal').textContent = nf.format(state.turbines.size);
}

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString('de-DE');
};

async function loadBundle() {
  busy(+1);
  setStatus('Lade Anlagendaten …');
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const js = await res.json();
    ingest(js.turbines || []);
    setStatus(`${nf.format(state.turbines.size)} Vestas-Anlagen an Land · Datenstand ${fmtDate(js.generated)}`);
  } catch (e) {
    console.error(e);
    setStatus('Datendatei fehlt. Bitte „python update_data.py“ ausführen.', 'err');
  } finally {
    busy(-1);
    updateView();
  }
}

/* ---------------- Marker & Filter ---------------- */

const matchesFilter = (t) =>
  (state.family === 'all' || t.family === state.family) &&
  (state.region === 'all' || t.region === state.region);

function renderRegions() {
  const counts = new Map();
  for (const t of state.turbines.values()) if (t.region) counts.set(t.region, (counts.get(t.region) || 0) + 1);
  const sel = $('#regionSelect');
  sel.innerHTML = `<option value="all">Alle Bundesländer (${nf.format(state.turbines.size)})</option>` +
    [...counts].sort((a, b) => a[0].localeCompare(b[0], 'de'))
      .map(([r, n]) => `<option value="${esc(r)}"${state.region === r ? ' selected' : ''}>${esc(r)} (${nf.format(n)})</option>`).join('');
}

function setRegion(r) {
  state.region = r;
  state.map.closePopup();
  renderChips();
  renderMarkers();
  if (r !== 'all') fitSelection(); else updateView();
}

const PIN_ICON = L.divIcon({ className: 'pin-wrap', html: `<div class="pin">${ICON}</div>`, iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14] });
const PIN_ICON_SEL = L.divIcon({ className: 'pin-wrap', html: `<div class="pin sel">${ICON}</div>`, iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14] });

function getMarker(t) {
  let m = state.markers.get(t.id);
  if (m) return m;
  m = L.marker([t.lat, t.lng], { icon: PIN_ICON, title: [t.park, turbineNo(t)].filter(Boolean).join(' – ') || 'Vestas-Anlage', keyboard: true });
  m.on('click', () => openInfo(t));
  state.markers.set(t.id, m);
  return m;
}

function renderMarkers() {
  const list = [];
  for (const t of state.turbines.values()) if (matchesFilter(t)) list.push(getMarker(t));
  state.clusterer.clearLayers();
  state.clusterer.addLayers(list);
}

function renderChips() {
  const counts = new Map();
  let total = 0;
  for (const t of state.turbines.values()) {
    if (state.region !== 'all' && t.region !== state.region) continue;
    counts.set(t.family, (counts.get(t.family) || 0) + 1);
    total++;
  }
  const box = $('#chips');
  if (!counts.size) { box.innerHTML = '<span class="empty">Noch keine Daten geladen.</span>'; return; }

  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 16);
  if (state.family !== 'all' && !top.some(([f]) => f === state.family)) top.push([state.family, counts.get(state.family) || 0]);

  const chip = (f, label, n) =>
    `<button class="chip${state.family === f ? ' active' : ''}" data-f="${esc(f)}">${esc(label)}<small>${nf.format(n)}</small></button>`;
  box.innerHTML = chip('all', 'Alle', total) + top.map(([f, n]) => chip(f, f, n)).join('');
}

function setFamily(f) {
  state.family = f;
  state.map.closePopup();
  renderChips();
  renderMarkers();
  updateView();
}

/* ---------------- Ansicht, Statistik, Liste ---------------- */

function updateView() {
  if (!state.map) return;
  const b = state.map.getBounds();
  const vis = [];
  let mw = 0;
  for (const t of state.turbines.values()) {
    if (!matchesFilter(t)) continue;
    if (!b.contains([t.lat, t.lng])) continue;
    vis.push(t);
    if (t.mw) mw += t.mw;
  }
  $('#statVisible').textContent = nf.format(vis.length);
  $('#statMW').textContent = nf.format(Math.round(mw));
  $('#listCount').textContent = vis.length ? `(${nf.format(vis.length)})` : '';

  const c = state.map.getCenter();
  const d = (t) => (t.lat - c.lat) ** 2 + ((t.lng - c.lng) * Math.cos((c.lat * Math.PI) / 180)) ** 2;
  vis.sort((a, b2) => d(a) - d(b2));

  const ul = $('#list');
  if (!vis.length) {
    ul.innerHTML = '<li class="more">Keine Vestas-Anlagen in diesem Ausschnitt.</li>';
    return;
  }
  ul.innerHTML = vis.slice(0, LIST_LIMIT).map((t) => `
    <li tabindex="0" data-id="${esc(t.id)}">
      <span class="ico">${ICON}</span>
      <span class="meta">
        <span class="t">${esc(t.park || (t.model ? 'Vestas ' + t.model : 'Vestas-Anlage'))}</span>
        <span class="s">${esc([turbineNo(t), t.park ? t.model : '', t.operator].filter(Boolean).join(' · ') || t.lat.toFixed(4) + ', ' + t.lng.toFixed(4))}</span>
      </span>
      ${t.mw ? `<span class="mw">${nf1.format(t.mw)} MW</span>` : ''}
    </li>`).join('') +
    (vis.length > LIST_LIMIT ? `<li class="more">+ ${nf.format(vis.length - LIST_LIMIT)} weitere – zoome hinein</li>` : '');
}

/* ---------------- Infofenster ---------------- */

function gLinks(t) {
  const ll = `${t.lat},${t.lng}`;
  return {
    maps: `https://www.google.com/maps/search/?api=1&query=${ll}`,
    // Offizieller Google-Maps-Link: öffnet auf dem Handy direkt die Google-Maps-App
    // und startet die Navigation zu den exakten Koordinaten der Anlage
    route: `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving&dir_action=navigate`,
    street: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll}`,
    earth: `https://earth.google.com/web/@${ll},400a,1500d,35y,0h,60t,0r`,
    mastr: `https://www.marktstammdatenregister.de/MaStR/Einheit/Detail/IndexOeffentlich/${encodeURIComponent(t.uid)}`,
  };
}

// Anlagen-Nummer: bevorzugt ref, sonst ein kurzer Name wie „WEA 3“
function turbineNo(t) {
  if (t.ref) return /^\d/.test(t.ref) ? 'Nr. ' + t.ref : t.ref;
  if (t.name && t.name !== t.park && t.name.length <= 24) return t.name;
  return '';
}

function infoHtml(t) {
  const links = gLinks(t);
  const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '');
  const no = turbineNo(t);
  return `
    <div class="iw">
      <div class="kicker">Vestas${t.family !== 'Unbekannt' && t.family !== 'Sonstige' ? ' · ' + esc(t.family) : ''}${no ? ' · ' + esc(no) : ''}</div>
      <h3>${esc(t.park || t.model || 'Windenergieanlage')}</h3>
      <dl>
        ${row('Windpark', t.park || 'nicht erfasst')}
        ${row('Anlage', no)}
        ${row('Modell', t.model)}
        ${row('Leistung', t.mw ? nf1.format(t.mw) + ' MW' : '')}
        ${row('Nabenhöhe', t.hub ? nf.format(t.hub) + ' m' : '')}
        ${row('Rotor-Ø', t.rotor ? nf.format(t.rotor) + ' m' : '')}
        ${row('Gesamthöhe', t.hub && t.rotor ? nf.format(Math.round(t.hub + t.rotor / 2)) + ' m' : '')}
        ${row('Betreiber', t.operator)}
        ${row('Gemeinde', [t.town, t.district !== t.town ? t.district : ''].filter(Boolean).join(', '))}
        ${row('Bundesland', t.region)}
        ${row('Status', t.status !== 'In Betrieb' ? t.status : '')}
        ${row('In Betrieb seit', fmtDate(t.start))}
      </dl>
      <div class="links">
        <a class="main" href="${links.route}" target="_blank" rel="noopener">Route in Google Maps starten</a>
        <a href="${links.maps}" target="_blank" rel="noopener">In Google Maps</a>
        <a href="#" data-copy="${t.lat.toFixed(6)}, ${t.lng.toFixed(6)}">Koordinaten kopieren</a>
        <a href="${links.street}" target="_blank" rel="noopener">Street View</a>
        <a href="${links.earth}" target="_blank" rel="noopener">Google Earth</a>
        <a href="${links.mastr}" target="_blank" rel="noopener">Register-Eintrag</a>
      </div>
      <div class="coord">${t.lat.toFixed(6)}, ${t.lng.toFixed(6)}</div>
    </div>`;
}

function clearSelection() {
  if (state.selected) state.markers.get(state.selected)?.setIcon(PIN_ICON);
  state.selected = null;
}

function openInfo(t) {
  clearSelection();
  const m = getMarker(t);
  m.setIcon(PIN_ICON_SEL);
  state.selected = t.id;
  const narrow = window.innerWidth < 500;
  m.unbindPopup().bindPopup(infoHtml(t), {
    maxWidth: narrow ? 280 : 320, minWidth: narrow ? 260 : 310,
    className: 'dark-popup', autoPanPaddingTopLeft: [20, 20], autoPanPaddingBottomRight: [20, 20],
  }).openPopup();
  // Nach evtl. laufender Zoom-Animation sicherstellen, dass das ganze Fenster sichtbar ist
  setTimeout(() => {
    const el = m.getPopup()?.getElement();
    if (!el) return;
    const p = el.getBoundingClientRect(), c = state.map.getContainer().getBoundingClientRect();
    const dy = p.top < c.top + 16 ? p.top - c.top - 16 : 0;
    const dx = p.right > c.right - 60 ? p.right - c.right + 60 : p.left < c.left + 16 ? p.left - c.left - 16 : 0;
    if (dx || dy) state.map.panBy([dx, dy]);
  }, 350);
}

/* ---------------- Export (KML für Google My Maps / Earth) ---------------- */

function filteredTurbines() {
  return [...state.turbines.values()].filter(matchesFilter);
}

function download(name, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportKml() {
  const list = filteredTurbines();
  if (!list.length) { toast('Keine Anlagen zum Exportieren geladen.'); return; }
  const x = (s) => esc(s);
  const pm = list.map((t) => `
  <Placemark>
    <name>${x([t.park, turbineNo(t)].filter(Boolean).join(' – ') || (t.model ? 'Vestas ' + t.model : 'Vestas'))}</name>
    <styleUrl>#wt</styleUrl>
    <ExtendedData>
      <Data name="Windpark"><value>${x(t.park)}</value></Data>
      <Data name="Anlagen_Nr"><value>${x(t.ref || t.name)}</value></Data>
      <Data name="Modell"><value>${x(t.model)}</value></Data>
      <Data name="Leistung_MW"><value>${t.mw ?? ''}</value></Data>
      <Data name="Nabenhoehe_m"><value>${t.hub ?? ''}</value></Data>
      <Data name="Rotordurchmesser_m"><value>${t.rotor ?? ''}</value></Data>
      <Data name="Betreiber"><value>${x(t.operator)}</value></Data>
      <Data name="Gemeinde"><value>${x(t.town)}</value></Data>
      <Data name="Bundesland"><value>${x(t.region)}</value></Data>
      <Data name="MaStR_Nr"><value>${x(t.id)}</value></Data>
    </ExtendedData>
    <Point><coordinates>${t.lng},${t.lat},0</coordinates></Point>
  </Placemark>`).join('');
  const label = [state.region !== 'all' ? state.region : '', state.family !== 'all' ? state.family : ''].filter(Boolean).join(', ');
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Vestas-Windenergieanlagen an Land${label ? ' (' + x(label) + ')' : ''}</name>
  <description>Quelle: Marktstammdatenregister, Bundesnetzagentur (dl-de/by-2-0)</description>
  <Style id="wt"><IconStyle><color>fff8bd38</color><scale>0.9</scale><Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>${pm}
</Document>
</kml>`;
  download(`vestas-anlagen${label ? '-' + label.replace(/[^\wäöüÄÖÜß-]+/g, '-') : ''}.kml`, 'application/vnd.google-earth.kml+xml', kml);
  toast(`${nf.format(list.length)} Anlagen als KML exportiert – importierbar in Google My Maps & Google Earth.`);
}

function exportGeoJson() {
  const list = filteredTurbines();
  if (!list.length) { toast('Keine Anlagen zum Exportieren geladen.'); return; }
  const fc = {
    type: 'FeatureCollection',
    features: list.map((t) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [t.lng, t.lat] },
      properties: { id: t.id, manufacturer: 'Vestas', model: t.model, family: t.family, power_mw: t.mw, hub_height_m: t.hub, rotor_diameter_m: t.rotor, operator: t.operator, wind_farm: t.park, name: t.name, town: t.town, state: t.region, start_date: t.start },
    })),
  };
  download('vestas-anlagen.geojson', 'application/geo+json', JSON.stringify(fc));
  toast(`${nf.format(list.length)} Anlagen als GeoJSON exportiert.`);
}

/* ---------------- Suche & Standort ---------------- */

function boundsOf(list) {
  return L.latLngBounds(list.map((t) => [t.lat, t.lng]));
}

async function search(q) {
  q = q.trim();
  if (!q) return;
  // Zuerst in den Windpark-Namen suchen
  const ql = q.toLowerCase();
  const inPark = [...state.turbines.values()].filter((t) => t.park && t.park.toLowerCase().includes(ql));
  if (inPark.length) {
    state.map.fitBounds(boundsOf(inPark), { padding: [80, 80], maxZoom: 15 });
    const parks = new Set(inPark.map((t) => t.park));
    toast(parks.size === 1 ? `Windpark „${[...parks][0]}“: ${inPark.length} Vestas-Anlagen` : `${parks.size} Windparks gefunden (${inPark.length} Anlagen)`);
    return;
  }
  // Sonst Ort über OpenStreetMap (Nominatim) suchen, beschränkt auf Deutschland
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&accept-language=de&q=' + encodeURIComponent(q));
    const [hit] = await r.json();
    if (!hit) { toast('Weder Windpark noch Ort gefunden.'); return; }
    const [s, n, w, e] = hit.boundingbox.map(Number);
    state.map.fitBounds([[s, w], [n, e]], { maxZoom: 13 });
  } catch {
    toast('Suche fehlgeschlagen.');
  }
}

function locate() {
  if (!navigator.geolocation) { toast('Standort wird von diesem Browser nicht unterstützt.'); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => state.map.setView([p.coords.latitude, p.coords.longitude], 11),
    () => toast('Standort konnte nicht ermittelt werden.'),
    { enableHighAccuracy: false, timeout: 10000 }
  );
}

function fitSelection() {
  const list = filteredTurbines();
  if (!list.length) { toast('Noch keine Anlagen geladen.'); return; }
  state.map.fitBounds(boundsOf(list), { padding: [40, 40] });
}

/* ---------------- Karte (Leaflet + OpenStreetMap) ---------------- */

function initMap() {
  const map = L.map('map', {
    center: [CONFIG.startCenter.lat, CONFIG.startCenter.lng],
    zoom: CONFIG.startZoom,
    minZoom: 5,
    maxZoom: 19,
    maxBounds: [[DE_BOUNDS.south, DE_BOUNDS.west], [DE_BOUNDS.north, DE_BOUNDS.east]],
    maxBoundsViscosity: 0.6,
    zoomControl: false,
    preferCanvas: true,
  });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

  const esriAttr = 'Bilder © Esri, Maxar, Earthstar Geographics';
  const satellite = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18, attribution: esriAttr }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18 }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18, opacity: 0.7 }),
  ]);
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png', {
    maxZoom: 19, maxNativeZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende',
  });
  const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, subdomains: 'abcd', attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende © CARTO',
  });
  satellite.addTo(map);
  L.control.layers({ 'Satellit': satellite, 'Karte (OSM)': osm, 'Dunkel': dark }, null, { position: 'topright' }).addTo(map);

  state.clusterer = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 60,
    disableClusteringAtZoom: 14,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: false,
    iconCreateFunction(cluster) {
      const count = cluster.getChildCount();
      const size = count < 10 ? 32 : count < 100 ? 40 : count < 1000 ? 48 : 58;
      const label = count >= 1000 ? nf1.format(count / 1000) + 'k' : count;
      return L.divIcon({ className: 'cluster-wrap', html: `<div class="cluster" style="width:${size}px;height:${size}px">${label}</div>`, iconSize: [size, size] });
    },
  }).addTo(map);

  map.on('popupclose', clearSelection);
  let timer;
  map.on('moveend', () => { clearTimeout(timer); timer = setTimeout(updateView, 120); });
  state.map = map;
}

/* ---------------- Events & Start ---------------- */

function bindUi() {
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) setFamily(b.dataset.f);
  });
  const openFromList = (li) => {
    const t = li && state.turbines.get(li.dataset.id);
    if (!t) return;
    const m = getMarker(t);
    state.clusterer.zoomToShowLayer(m, () => {
      if (state.map.getZoom() < 15) state.map.setView([t.lat, t.lng], 15);
      openInfo(t);
    });
    if (matchMedia('(max-width: 760px)').matches) $('#panel').classList.add('collapsed');
  };
  $('#list').addEventListener('click', (e) => openFromList(e.target.closest('li[data-id]')));
  $('#list').addEventListener('keydown', (e) => { if (e.key === 'Enter') openFromList(e.target.closest('li[data-id]')); });
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); search($('#searchInput').value); $('#searchInput').blur(); });
  $('#regionSelect').addEventListener('change', (e) => setRegion(e.target.value));
  $('#btnLocate').addEventListener('click', locate);
  $('#btnFit').addEventListener('click', fitSelection);
  $('#btnKml').addEventListener('click', exportKml);
  $('#btnGeojson').addEventListener('click', exportGeoJson);
  $('#sheetToggle').addEventListener('click', () => $('#panel').classList.toggle('collapsed'));
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-copy]');
    if (!a) return;
    e.preventDefault();
    try { await navigator.clipboard.writeText(a.dataset.copy); toast('Koordinaten kopiert: ' + a.dataset.copy); }
    catch { toast(a.dataset.copy); }
  });
}

async function main() {
  bindUi();
  renderChips();
  if (!window.L || !L.markerClusterGroup) {
    setStatus('Kartenbibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen.', 'err');
    return;
  }
  initMap();
  await loadBundle();
}

main();
