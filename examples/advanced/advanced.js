import OLMap from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import XYZ from 'ol/source/XYZ.js';
import {fromLonLat} from 'ol/proj.js';
import PrefetchManager, {PrefetchCategory} from 'openlayers-prefetching';


const REGISTER_URL =
  'https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register';

const VISUALIZATION = {
  name: 'True Color',
  urlTemplate:
    'https://planetarycomputer.microsoft.com/api/data/v1/mosaic/{searchId}/tiles/WebMercatorQuad/{z}/{x}/{y}?assets=B04&assets=B03&assets=B02&nodata=0&color_formula=Gamma+RGB+3.2+Saturation+0.8+Sigmoidal+RGB+25+0.35&collection=sentinel-2-l2a&pixel_selection=median',
};

const NEXT_NAV_ZOOM = 12;

// Campaign area bbox (lon/lat) - Europe
const CAMPAIGN_BBOX = [-25.0, 34.0, 45.0, 72.0];

const CAPITAL_TARGETS = [
  {name: 'London', lon: -0.1276, lat: 51.5072},
  {name: 'Paris', lon: 2.3522, lat: 48.8566},
  {name: 'Berlin', lon: 13.405, lat: 52.52},
  {name: 'Madrid', lon: -3.7038, lat: 40.4168},
  {name: 'Rome', lon: 12.4964, lat: 41.9028},
  {name: 'Lisbon', lon: -9.1393, lat: 38.7223},
  {name: 'Dublin', lon: -6.2603, lat: 53.3498},
  {name: 'Brussels', lon: 4.3517, lat: 50.8503},
  {name: 'Amsterdam', lon: 4.9041, lat: 52.3676},
  {name: 'Vienna', lon: 16.3738, lat: 48.2082},
  {name: 'Prague', lon: 14.4378, lat: 50.0755},
  {name: 'Warsaw', lon: 21.0122, lat: 52.2297},
  {name: 'Budapest', lon: 19.0402, lat: 47.4979},
  {name: 'Stockholm', lon: 18.0686, lat: 59.3293},
  {name: 'Oslo', lon: 10.7522, lat: 59.9139},
  {name: 'Copenhagen', lon: 12.5683, lat: 55.6761},
  {name: 'Helsinki', lon: 24.9384, lat: 60.1699},
  {name: 'Athens', lon: 23.7275, lat: 37.9838},
  {name: 'Bucharest', lon: 26.1025, lat: 44.4268},
  {name: 'Sofia', lon: 23.3219, lat: 42.6977},
  {name: 'Kyiv', lon: 30.5234, lat: 50.4501},
  {name: 'Zagreb', lon: 15.9819, lat: 45.815},
  {name: 'Belgrade', lon: 20.4489, lat: 44.7866},
  {name: 'Sarajevo', lon: 18.4131, lat: 43.8563},
  {name: 'Skopje', lon: 21.4314, lat: 41.9981},
  {name: 'Tirana', lon: 19.819, lat: 41.3275},
  {name: 'Podgorica', lon: 19.2594, lat: 42.4304},
  {name: 'Reykjavik', lon: -21.8174, lat: 64.1265},
];

// Default date ranges (monthly through the growing season)
const DEFAULT_RANGES = [
  {start: '2024-04-01', end: '2024-04-30'},
  {start: '2024-05-01', end: '2024-05-31'},
  {start: '2024-06-01', end: '2024-06-30'},
  {start: '2024-07-01', end: '2024-07-31'},
  {start: '2024-08-01', end: '2024-08-31'},
  {start: '2024-09-01', end: '2024-09-30'},
];

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

let dateRanges = DEFAULT_RANGES.map((r) => ({
  ...r,
  searchId: null,
  error: null,
}));

let activeLayerIndex = 0;
let navTargets = [];
let nextTargetIndex = 0;

let sharedSources = [];

let mainLayers = [];

let previewMaps = [];

let prefetchManager = null;

// -----------------------------------------------------------------------------
// Map (main)
// -----------------------------------------------------------------------------


const initialCenter = fromLonLat([35.05, 48.46]); // Dnipro
const mainView = new View({
  center: initialCenter,
  zoom: 11,
  maxZoom: 18,
  minZoom: 3,
});

const mainMap = new OLMap({
  target: 'main-map',
  layers: [],
  view: mainView,
});4

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function buildSearchBody(startDate, endDate) {
  return {
    bbox: CAMPAIGN_BBOX,
    filter: {
      op: 'and',
      args: [
        {
          op: 'anyinteracts',
          args: [
            {property: 'datetime'},
            {interval: [startDate, endDate]},
          ],
        },
        {op: '<=', args: [{property: 'eo:cloud_cover'}, 90]},
        {op: '=', args: [{property: 'collection'}, 'sentinel-2-l2a']},
      ],
    },
    metadata: {
      type: 'mosaic',
      maxzoom: 24,
      minzoom: 0,
      pixel_selection: 'median',
    },
    filterLang: 'cql2-json',
    collections: ['sentinel-2-l2a'],
  };
}

function tileUrl(searchId) {
  return VISUALIZATION.urlTemplate.replace('{searchId}', searchId);
}

function shuffleTargets(targets) {
  const copy = targets.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function renderNavTargets() {
  const container = document.getElementById('nav-targets');
  const nextNameEl = document.getElementById('next-capital-name');
  const nextTarget = getNextTarget();
  if (nextNameEl) {
  nextNameEl.textContent = nextTarget ? nextTarget.name : '-';
  }
  if (!container) {
    return;
  }
  container.innerHTML = '';
  navTargets.forEach((target, idx) => {
    const item = document.createElement('div');
    item.className = 'nav-item';
    item.textContent = `${idx + 1}. ${target.name}`;
    if (idx === nextTargetIndex) {
      item.classList.add('nav-next');
      item.textContent += ' (next)';
    }
    container.appendChild(item);
  });
}

function getNextTarget() {
  if (navTargets.length === 0) return null;
  return navTargets[nextTargetIndex % navTargets.length];
}

function preloadNextTarget() {
  const next = getNextTarget();
  if (!next || !prefetchManager) return;
  const center = fromLonLat([next.lon, next.lat]);
  prefetchManager.setNextTarget(center, NEXT_NAV_ZOOM);
  renderNavTargets();
}

/**
 * Custom tile load function that captures HTTP error details and stores
 * them on the tile as `tile._prefetchError` for the PrefetchManager's
 * error reporting.  Uses `tile.setState(3)` to signal ERROR.
 */
function customTileLoadFunction(imageTile, src) {
  fetch(src, {mode: 'cors', credentials: 'omit'})
    .then((response) => {
      if (!response.ok) {
        return response.text().then((body) => {
          let detail = '';
          try {
            const json = JSON.parse(body);
            detail = json.detail || json.message || json.error || '';
          } catch (_) {
            detail = body.slice(0, 120);
          }
          const reason = detail
            ? `HTTP ${response.status}: ${detail}`
            : `HTTP ${response.status} ${response.statusText}`;
          imageTile._prefetchError = reason;
          imageTile.setState(3); // TileState.ERROR
        });
      }
      return response.blob();
    })
    .then((blob) => {
      if (!blob) return;
      const objectUrl = URL.createObjectURL(blob);
      const img = /** @type {HTMLImageElement} */ (imageTile.getImage());
      img.onload = () => URL.revokeObjectURL(objectUrl);
      img.src = objectUrl;
    })
    .catch((err) => {
      imageTile._prefetchError = `Network error: ${err.message}`;
      imageTile.setState(3);
    });
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

async function registerMosaic(startDate, endDate) {
  const body = buildSearchBody(startDate, endDate);
  const resp = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  const searchId = data.searchid || data.id;
  if (!searchId) {
    throw new Error('No searchid in response');
  }
  return searchId;
}

async function registerAll() {
  const statusEl = document.getElementById('registration-status');
  const registerBtn = document.getElementById('register-btn');
  statusEl.style.display = 'block';
  statusEl.textContent = 'Registering mosaics...';
  registerBtn.disabled = true;

  // Tear down existing setup
  teardown();

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < dateRanges.length; i++) {
    const dr = dateRanges[i];
  statusEl.textContent = `Registering ${i + 1}/${dateRanges.length}: ${dr.start} to ${dr.end}...`;
    try {
      dr.searchId = await registerMosaic(dr.start, dr.end);
      dr.error = null;
      ok++;
      log(
        `#${i + 1} registered: ${dr.start} to ${dr.end} (${dr.searchId.slice(0, 10)}...)`,
        'success',
      );
    } catch (e) {
      dr.searchId = null;
      dr.error = e.message;
      fail++;
  log(`#${i + 1} failed: ${e.message}`, 'warn');
    }
    renderDateRanges();
  }

  statusEl.innerHTML = `Done: <b>${ok}</b> registered, <b>${fail}</b> failed.`;
  registerBtn.disabled = false;

  // Build everything
  buildSharedSources();
  buildMainLayers();
  buildPreviewMaps();
  renderLayerButtons();
  setupPrefetchManager();
  syncPreviewsToMain();
  preloadNextTarget();

  log(
    `${mainLayers.length} layers built, ${previewMaps.length} preview maps created`,
    'success',
  );
}

// -----------------------------------------------------------------------------
// Teardown
// -----------------------------------------------------------------------------

function teardown() {
  // Dispose prefetch manager
  if (prefetchManager) {
    prefetchManager.dispose();
    prefetchManager = null;
  }

  // Remove main map layers (keep basemap)
  mainLayers.forEach((layer) => mainMap.removeLayer(layer));
  mainLayers = [];

  // Dispose preview maps
  previewMaps.forEach(({map}) => map.dispose());
  previewMaps = [];

  // Clear preview row DOM
  document.getElementById('preview-row').innerHTML = '';

  // Reset sources
  sharedSources = [];
  activeLayerIndex = 0;
}

// -----------------------------------------------------------------------------
// Shared sources
// -----------------------------------------------------------------------------

function buildSharedSources() {
  sharedSources = [];
  const registered = dateRanges.filter((dr) => dr.searchId);

  for (const dr of registered) {
    const source = new XYZ({
      url: tileUrl(dr.searchId),
      maxZoom: 18,
      crossOrigin: 'anonymous',
      transition: 0,
      tileLoadFunction: customTileLoadFunction,
  attributions: '(c) Sentinel-2 L2A via Planetary Computer',
    });
    sharedSources.push(source);
  }
}

// -----------------------------------------------------------------------------
// Main map layers (all use shared sources, one visible at a time)
// -----------------------------------------------------------------------------

function buildMainLayers() {
  const registered = dateRanges
    .map((dr, i) => ({dr, origIndex: i}))
    .filter(({dr}) => dr.searchId);

  if (activeLayerIndex >= registered.length) {
    activeLayerIndex = 0;
  }

  mainLayers = registered.map(({dr, origIndex}, layerIdx) => {
    const layer = new TileLayer({
      source: sharedSources[layerIdx],
      visible: layerIdx === activeLayerIndex,
      preload: Infinity,
      properties: {
  name: `S2 ${dr.start} to ${dr.end}`,
  label: `${dr.start} to ${dr.end}`,
        rangeIndex: origIndex,
        prefetchPriority: layerIdx,
      },
    });
    mainMap.addLayer(layer);
    return layer;
  });

  // Update main map label
  if (mainLayers.length > 0) {
    document.getElementById('main-map-label').textContent =
  `Main - ${mainLayers[activeLayerIndex].get('name')}`;
  }
}

// -----------------------------------------------------------------------------
// Preview maps, one per registered range, dynamically created.
// Each preview uses the same shared source as the corresponding main layer.
// -----------------------------------------------------------------------------

function buildPreviewMaps() {
  const previewRow = document.getElementById('preview-row');
  previewRow.innerHTML = '';
  previewMaps = [];

  const registered = dateRanges
    .map((dr, i) => ({dr, origIndex: i}))
    .filter(({dr}) => dr.searchId);

  registered.forEach(({dr}, layerIdx) => {
    // Container
    const container = document.createElement('div');
    container.className = 'preview-container';
    if (layerIdx === activeLayerIndex) {
      container.classList.add('active-preview');
    }
    container.dataset.layerIndex = String(layerIdx);

    // Map target
    const mapDiv = document.createElement('div');
    mapDiv.className = 'preview-map';
    container.appendChild(mapDiv);

    // Label
    const label = document.createElement('div');
    label.className = 'preview-label';
  label.textContent = `${dr.start} to ${dr.end}`;
    container.appendChild(label);

    previewRow.appendChild(container);

    // Create preview map using the SAME shared source
    const previewLayer = new TileLayer({
      source: sharedSources[layerIdx],
      visible: true,
      preload: Infinity,
  properties: {name: `Preview ${dr.start} to ${dr.end}`},
    });

    const previewView = new View({
      center: mainView.getCenter(),
      zoom: mainView.getZoom(),
      maxZoom: 18,
      minZoom: 3,
    });

    const previewMap = new OLMap({
      target: mapDiv,
      layers: [previewLayer],
      view: previewView,
      controls: [],
    });

    previewMaps.push({
      map: previewMap,
      layer: previewLayer,
      view: previewView,
      container,
    });

  // Click preview to switch main layer
    container.addEventListener('click', () => switchLayer(layerIdx));
  });
}

// -----------------------------------------------------------------------------
// View syncing: main to previews
// -----------------------------------------------------------------------------

let syncing = false;

function syncPreviewsToMain() {
  if (syncing) return;
  syncing = true;
  const center = mainView.getCenter();
  const zoom = mainView.getZoom();
  const rotation = mainView.getRotation();
  for (const pv of previewMaps) {
    pv.view.setCenter(center);
    pv.view.setZoom(zoom);
    pv.view.setRotation(rotation);
  }
  syncing = false;
}

mainView.on('change:center', syncPreviewsToMain);
mainView.on('change:resolution', syncPreviewsToMain);
mainView.on('change:rotation', syncPreviewsToMain);

// -----------------------------------------------------------------------------
// Layer switching
// -----------------------------------------------------------------------------

function switchLayer(index) {
  if (index === activeLayerIndex) return;
  if (index < 0 || index >= mainLayers.length) return;

  const t0 = performance.now();
  const oldIndex = activeLayerIndex;

  // 3-step instant switch: show new, renderSync, hide old
  mainLayers[index].setVisible(true);
  mainMap.renderSync();
  mainLayers[oldIndex].setVisible(false);

  activeLayerIndex = index;

  // Update PrefetchManager
  if (prefetchManager) {
    prefetchManager.setActiveLayer(mainLayers[index]);

    // Re-register background layers
    const bgLayers = prefetchManager.getBackgroundLayers();
    bgLayers.forEach((entry) => prefetchManager.removeBackgroundLayer(entry.layer));

    let priority = 1;
    mainLayers.forEach((layer, i) => {
      if (i !== index) {
        prefetchManager.addBackgroundLayer(layer, priority++);
      }
    });
  }

  // Update main map label
  document.getElementById('main-map-label').textContent =
  `Main - ${mainLayers[index].get('name')}`;

  // Update layer buttons
  document.querySelectorAll('#layer-buttons .layer-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === index);
  });

  // Highlight active preview
  previewMaps.forEach((pv, i) => {
    pv.container.classList.toggle('active-preview', i === index);
  });

  const elapsed = (performance.now() - t0).toFixed(1);
  log(
  `Switched to "${mainLayers[index].get('label')}" (${elapsed}ms) - tiles from preview cache.`,
    'success',
  );
}

// -----------------------------------------------------------------------------
// Prefetch Manager
// -----------------------------------------------------------------------------

/** Map of UI element ids to PrefetchCategory keys. */
const CAT_PRIO_ELEMENT_MAP = {
  'prio-spatial': PrefetchCategory.SPATIAL_ACTIVE,
  'prio-bg-viewport': PrefetchCategory.BACKGROUND_LAYERS_VIEWPORT,
  'prio-nav-current': PrefetchCategory.NEXT_NAV_ACTIVE,
  'prio-nav-bg': PrefetchCategory.NEXT_NAV_BACKGROUND,
};

/** Sync category-priority number inputs from PrefetchManager state. */
function syncCategoryPriorityUI() {
  if (!prefetchManager) return;
  const priorities = prefetchManager.getCategoryPriorities();
  for (const [elId, catKey] of Object.entries(CAT_PRIO_ELEMENT_MAP)) {
    const input = /** @type {HTMLInputElement} */ (document.getElementById(elId));
    if (input && priorities[catKey] !== undefined) {
      input.value = String(priorities[catKey]);
    }
  }
}

function setupPrefetchManager() {
  if (prefetchManager) {
    prefetchManager.dispose();
  }
  if (mainLayers.length === 0) return;

  const concurrent = parseInt(
    /** @type {HTMLInputElement} */ (document.getElementById('max-concurrent'))
      .value,
    10,
  );
  const enabled = /** @type {HTMLInputElement} */ (
    document.getElementById('prefetch-toggle')
  ).checked;

  prefetchManager = new PrefetchManager({
    map: mainMap,
    maxConcurrentPrefetches: concurrent,
    spatialBufferFactor: parseFloat(
      /** @type {HTMLInputElement} */ (
        document.getElementById('buffer-factor')
      ).value,
    ),
    idleDelay: 300,
    tickInterval: 200,
    enabled,
  });

  // Active layer
  prefetchManager.setActiveLayer(mainLayers[activeLayerIndex]);

  // Background layers
  let priority = 1;
  mainLayers.forEach((layer, i) => {
    if (i !== activeLayerIndex) {
      prefetchManager.addBackgroundLayer(layer, priority++);
    }
  });

  prefetchManager.onStats(updateStatsUI);
  syncCategoryPriorityUI();

  log(
    `PrefetchManager initialized (${mainLayers.length} layers, ` +
      `${previewMaps.length} previews, max ${concurrent} concurrent)`,
    'success',
  );
}

// -----------------------------------------------------------------------------
// Stats + Error UI
// -----------------------------------------------------------------------------

let lastErrorCount = 0;

function updateStatsUI(stats) {
  // Status
  const pausedEl = document.getElementById('stat-paused');
  if (stats.paused) {
  pausedEl.textContent = 'Paused (user interacting)';
    pausedEl.className = 'stat-value status-paused';
  } else {
  pausedEl.textContent = 'Active';
    pausedEl.className = 'stat-value status-active';
  }

  // Totals
  document.getElementById('stat-totals').textContent =
  `Q:${stats.queued}  L:${stats.loading}  Loaded:${stats.loaded}  Errors:${stats.errors}`;

  // Per-category (with priority + error columns)
  const cp = stats.categoryPriorities || {};

  const sc = stats.spatialActive;
  document.getElementById('cat-spatial-p').textContent = cp.spatial || '-';
  document.getElementById('cat-spatial-q').textContent = sc.queued;
  document.getElementById('cat-spatial-l').textContent = sc.loading;
  document.getElementById('cat-spatial-d').textContent = sc.loaded;
  document.getElementById('cat-spatial-e').textContent = sc.errors;

  const bv = stats.bgViewport;
  document.getElementById('cat-bgvp-p').textContent = cp.bgViewport || '-';
  document.getElementById('cat-bgvp-q').textContent = bv.queued;
  document.getElementById('cat-bgvp-l').textContent = bv.loading;
  document.getElementById('cat-bgvp-d').textContent = bv.loaded;
  document.getElementById('cat-bgvp-e').textContent = bv.errors;

  const nc = stats.nextNavActive;
  document.getElementById('cat-navact-p').textContent = cp.nextNavActive || '-';
  document.getElementById('cat-navact-q').textContent = nc.queued;
  document.getElementById('cat-navact-l').textContent = nc.loading;
  document.getElementById('cat-navact-d').textContent = nc.loaded;
  document.getElementById('cat-navact-e').textContent = nc.errors;

  const nb = stats.nextNavBackground;
  document.getElementById('cat-navbg-p').textContent = cp.nextNavBackground || '-';
  document.getElementById('cat-navbg-q').textContent = nb.queued;
  document.getElementById('cat-navbg-l').textContent = nb.loading;
  document.getElementById('cat-navbg-d').textContent = nb.loaded;
  document.getElementById('cat-navbg-e').textContent = nb.errors;

  // Next target info
  const targetBox = document.getElementById('next-target-info');
  const targetDetail = document.getElementById('next-target-detail');
  if (targetBox && targetDetail) {
    if (stats.nextTarget) {
      targetBox.style.display = 'block';
      const c = stats.nextTarget.center;
      targetDetail.textContent = `zoom ${stats.nextTarget.zoom} @ [${c[0].toFixed(0)}, ${c[1].toFixed(0)}]`;
    } else {
      targetBox.style.display = 'none';
    }
  }

  // Error details
  if (stats.errors !== lastErrorCount) {
    lastErrorCount = stats.errors;
    renderErrors(stats.recentErrors, stats.errors);
  }
}

function renderErrors(recentErrors, totalErrors) {
  const badge = document.getElementById('error-badge');
  const list = document.getElementById('error-list');
  if (!badge || !list) {
    return;
  }

  if (totalErrors === 0) {
    badge.style.display = 'none';
    list.innerHTML = '<p class="hint">No errors yet.</p>';
    return;
  }

  badge.style.display = 'inline';
  badge.textContent = totalErrors;

  list.innerHTML = '';
  recentErrors.forEach((err) => {
    const div = document.createElement('div');
    div.className = 'error-entry';
    const time = new Date(err.timestamp).toLocaleTimeString('en-US', {
      hour12: false,
    });
    div.innerHTML = `
      <span class="err-time">${time}</span>
      <span class="err-cat">[${err.category}]</span>
  <span class="err-layer">${err.layerName}</span> -
      <span class="err-reason">${err.reason}</span>
      <br><span class="err-tile">tile [${err.tileCoord.join(', ')}]</span>
    `;
    list.appendChild(div);
  });
}

// -----------------------------------------------------------------------------
// UI: Date range management
// -----------------------------------------------------------------------------

function renderDateRanges() {
  const container = document.getElementById('date-ranges');
  container.innerHTML = '';

  dateRanges.forEach((dr, i) => {
    const row = document.createElement('div');
    row.className = 'date-range-row';
    if (dr.searchId) row.classList.add('registered');
    if (dr.error) row.classList.add('error');

    row.innerHTML = `
      <span class="range-num">${i + 1}</span>
      <input type="date" class="dr-start" value="${dr.start}">
  <span class="range-sep">to</span>
      <input type="date" class="dr-end" value="${dr.end}">
      <span class="range-status ${dr.searchId ? 'ok' : dr.error ? 'err' : ''}"
            title="${dr.searchId || dr.error || ''}">
      </span>
  <button class="remove-btn" title="Remove">x</button>
    `;

    row.querySelector('.dr-start').addEventListener('change', (e) => {
      dr.start = /** @type {HTMLInputElement} */ (e.target).value;
      dr.searchId = null;
      dr.error = null;
      renderDateRanges();
    });
    row.querySelector('.dr-end').addEventListener('change', (e) => {
      dr.end = /** @type {HTMLInputElement} */ (e.target).value;
      dr.searchId = null;
      dr.error = null;
      renderDateRanges();
    });
    row.querySelector('.remove-btn').addEventListener('click', () => {
      dateRanges.splice(i, 1);
      renderDateRanges();
    });

    container.appendChild(row);
  });
}

// -----------------------------------------------------------------------------
// UI: Layer buttons (with priority controls)
// -----------------------------------------------------------------------------

function renderLayerButtons() {
  const container = document.getElementById('layer-buttons');
  container.innerHTML = '';

  if (mainLayers.length === 0) {
    container.innerHTML =
      '<p class="hint">Register mosaics first to see layers.</p>';
    return;
  }

  mainLayers.forEach((layer, i) => {
    const btn = document.createElement('button');
    btn.className = `layer-btn${i === activeLayerIndex ? ' active' : ''}`;
    btn.innerHTML = `
      <span class="indicator"></span>
      <span>${layer.get('label')}</span>
  <span class="prefetch-status" id="layer-status-${i}">-</span>
    `;
    btn.addEventListener('click', () => switchLayer(i));
    container.appendChild(btn);

    // Priority control row
    const prio = layer.get('prefetchPriority');
    const prioRow = document.createElement('div');
    prioRow.className = 'priority-row';
    prioRow.innerHTML = `
      <label class="priority-label">
        <span>Prefetch priority:</span>
        <input type="number" class="priority-input" value="${prio}" min="0" max="99" step="1"
          title="Lower = loaded first">
        <span class="priority-hint">(lower = first)</span>
      </label>
    `;
    prioRow
      .querySelector('.priority-input')
      .addEventListener('change', (e) => {
        const val = parseInt(
          /** @type {HTMLInputElement} */ (e.target).value,
          10,
        );
        if (isNaN(val) || val < 0) return;
        layer.set('prefetchPriority', val);
        if (prefetchManager) {
          prefetchManager.setBackgroundLayerPriority(layer, val);
          log(`Priority for "${layer.get('label')}" to ${val}`, 'info');
        }
      });
    prioRow.addEventListener('click', (e) => e.stopPropagation());
    container.appendChild(prioRow);
  });
}

// -----------------------------------------------------------------------------
// UI: Controls wiring
// -----------------------------------------------------------------------------

function init() {
  renderDateRanges();
  renderLayerButtons();

  // Add range button
  document.getElementById('add-range-btn').addEventListener('click', () => {
    const last = dateRanges[dateRanges.length - 1];
    let newStart, newEnd;
    if (last) {
      const s = new Date(last.end);
      s.setDate(s.getDate() + 1);
      const e = new Date(s);
      e.setMonth(e.getMonth() + 1);
      e.setDate(0);
      newStart = s.toISOString().slice(0, 10);
      newEnd = e.toISOString().slice(0, 10);
    } else {
      newStart = '2024-04-01';
      newEnd = '2024-04-30';
    }
    dateRanges.push({start: newStart, end: newEnd, searchId: null, error: null});
    renderDateRanges();
  });

  // Register button
  document.getElementById('register-btn').addEventListener('click', () => {
    registerAll();
  });

  // Prefetch toggle
  document
    .getElementById('prefetch-toggle')
    .addEventListener('change', (e) => {
      const checked = /** @type {HTMLInputElement} */ (e.target).checked;
      if (prefetchManager) {
        prefetchManager.setEnabled(checked);
      }
      log(checked ? 'Prefetching enabled' : 'Prefetching disabled', 'warn');
    });

  // Buffer factor
  const bufferSlider = /** @type {HTMLInputElement} */ (
    document.getElementById('buffer-factor')
  );
  const bufferValue = document.getElementById('buffer-factor-value');
  if (bufferSlider && bufferValue) {
    bufferSlider.addEventListener('input', () => {
      const val = parseFloat(bufferSlider.value);
      bufferValue.textContent = `${val.toFixed(1)}x`;
      if (prefetchManager) {
        prefetchManager.spatialBufferFactor_ = val;
      }
      log(`Spatial buffer: ${val.toFixed(1)}x`, 'info');
    });
  }

  // Max concurrent
  const concurrentSlider = /** @type {HTMLInputElement} */ (
    document.getElementById('max-concurrent')
  );
  const concurrentValue = document.getElementById('max-concurrent-value');
  if (concurrentSlider && concurrentValue) {
    concurrentSlider.addEventListener('input', () => {
      const val = parseInt(concurrentSlider.value, 10);
      concurrentValue.textContent = val;
      if (prefetchManager) {
        prefetchManager.setMaxConcurrent(val);
      }
      log(`Max concurrent: ${val}`, 'info');
    });
  }

  // Category priorities
  function applyCategoryPriorities() {
    if (!prefetchManager) return;
    const priorities = {};
    for (const [elId, catKey] of Object.entries(CAT_PRIO_ELEMENT_MAP)) {
      const input = /** @type {HTMLInputElement} */ (
        document.getElementById(elId)
      );
      const val = parseInt(input.value, 10);
      if (!isNaN(val) && val >= 1) {
        priorities[catKey] = val;
      }
    }
    prefetchManager.setCategoryPriorities(priorities);
    log(
      `Category priorities updated: ${Object.entries(priorities)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`,
      'info',
    );
  }

  const applyBtn = document.getElementById('apply-priorities-btn');
  if (applyBtn) {
    applyBtn.addEventListener('click', applyCategoryPriorities);
  }

  // Also allow pressing Enter in any priority input to apply
  for (const elId of Object.keys(CAT_PRIO_ELEMENT_MAP)) {
    const input = document.getElementById(elId);
    if (!input) continue;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        applyCategoryPriorities();
      }
    });
  }

  // Navigation targets (fixed shuffled list)
  navTargets = shuffleTargets(CAPITAL_TARGETS);
  nextTargetIndex = 0;
  renderNavTargets();

  const goToBtn = document.getElementById('go-to-target');
  if (goToBtn) {
    goToBtn.disabled = navTargets.length === 0;
    goToBtn.addEventListener('click', () => {
      const next = getNextTarget();
      if (!next) return;
      log(`Jumped to ${next.name}`, 'info');
      const center = fromLonLat([next.lon, next.lat]);
      mainView.setCenter(center);
      mainView.setZoom(NEXT_NAV_ZOOM);
      nextTargetIndex = (nextTargetIndex + 1) % navTargets.length;
      preloadNextTarget();
    });
  }

  // Periodic stats refresh
  setInterval(() => {
    if (prefetchManager) {
      updateStatsUI(prefetchManager.getStats());
    }
  }, 500);

  // Map movement logging
  mainMap.on('movestart', () => {
  log('User interaction - prefetch paused', 'warn');
  });
  mainMap.on('moveend', () => {
    const zoom = mainView.getZoom().toFixed(1);
  log(`View settled (z${zoom}) - prefetch resuming`, 'success');
  });

  log('Ready - set date ranges and click "Register Mosaics"', 'info');
  log(`${dateRanges.length} default date ranges loaded`, 'info');
  log('Preview maps will appear after registration', 'info');

  preloadNextTarget();

  if (!autoRegisterTriggered) {
    autoRegisterTriggered = true;
    setTimeout(() => {
      registerAll();
    }, 0);
  }
}

// -----------------------------------------------------------------------------
// Logging
// -----------------------------------------------------------------------------

const logContainer = document.getElementById('log');
let logCount = 0;
let autoRegisterTriggered = false;

function log(msg, type = '') {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  const time = new Date().toLocaleTimeString('en-US', {hour12: false});
  entry.innerHTML = `<span class="log-time">${time}</span> <span class="log-msg ${type}">${msg}</span>`;
  logContainer.prepend(entry);
  logCount++;
  if (logCount > 100) {
    logContainer.removeChild(logContainer.lastChild);
    logCount--;
  }
}

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------

init();
