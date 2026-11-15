/**
 * NASA Earth Observation Platform // World Map Web App
 * Universal SAR Deforestation & Disaster Analytics
 */

// Embedded Fallback Manifest for offline / standalone use
const EMBEDDED_MANIFEST = {};
const FOREST_EXAMPLES = globalThis.ForestExamples || { sentinel1: [], nisar: [] };

// Compact study areas, chosen around locations documented by NASA Earth Observatory.
// Historical examples establish context; they do not guarantee current NISAR coverage.
const FLOOD_REFERENCES = [
  {
    id: 'limpopo', label: 'Limpopo · Chókwè, Mozambique', center: [-24.53, 32.98],
    bbox: [32.81, -24.70, 33.15, -24.36],
    context: 'Lower Limpopo floodplain. NASA documented widespread flooding in southern Mozambique in January 2026.',
    source: 'https://science.nasa.gov/earth/earth-observatory/floods-inundate-southern-mozambique/'
  },
  {
    id: 'jamuna', label: 'Jamuna · Sirajganj, Bangladesh', center: [24.45, 89.72],
    bbox: [89.55, 24.28, 89.89, 24.62],
    context: 'Brahmaputra–Jamuna floodplain. NASA documented extensive monsoon flooding along the Jamuna in July 2020.',
    source: 'https://science.nasa.gov/earth/earth-observatory/intense-flooding-in-bangladesh-147057/'
  },
  {
    id: 'indus', label: 'Indus · Sukkur, Pakistan', center: [27.71, 68.86],
    bbox: [68.69, 27.54, 69.03, 27.88],
    context: 'Indus floodplain near Sukkur. NASA tracked the lower Indus flood surge during August 2010.',
    source: 'https://science.nasa.gov/earth/earth-observatory/flooding-along-the-lower-indus-river-45189/'
  },
  {
    id: 'mekong', label: 'Mekong · Phnom Penh, Cambodia', center: [11.56, 104.92],
    bbox: [104.75, 11.39, 105.09, 11.73],
    context: 'Mekong and Tonle Sap river junction. NASA has documented wet-season floodplain expansion around Phnom Penh.',
    source: 'https://science.nasa.gov/earth/earth-observatory/wet-season-floods-along-the-mekong-river-6970/'
  },
  {
    id: 'mississippi', label: 'Mississippi · Vicksburg, USA', center: [32.35, -90.88],
    bbox: [-91.05, 32.18, -90.71, 32.52],
    context: 'Mississippi–Yazoo floodplain. NASA documented record river flooding near Vicksburg in May 2011.',
    source: 'https://science.nasa.gov/earth/earth-observatory/mississippi-floods-near-vicksburg-50663/'
  }
];

// Global App State
const state = {
  manifest: null,
  flood: { bbox: null, name: "", data: null, requestId: 0, timer: null, referenceId: '', referenceLayer: null },
  activeMission: 'deforestation', // 'deforestation' | 'flood' | 'global'
  forestSource: 'sentinel1',
  forestExampleId: '',
  currentFrameIndex: 0,
  isPlaying: false,
  playbackSpeed: 1200,
  playTimer: null,
  overlayOpacity: 0.9,
  imageView: 'original',
  imageRenderId: 0,
  isComparing: false,
  showBoundsBox: true,
  baseMapKey: 'satellite',
  map: null,
  activeOverlay: null,
  boundsRect: null,
  roiAnchorMarker: null,
  baseMaps: {},

  // Square Selector State
  isDrawingSquare: false,
  drawStartLatLng: null,
  tempDrawRect: null,
  activeRoiBBox: null,
  activeRoiName: "",
  activeRoiData: null,
  activeFrames: [],
  geePollTimer: null,
  analysisRequestId: 0
};

const IMAGE_VIEW_NOTES = {
  original: 'Original radar colors. Choose Enhanced radar for a clearer view.',
  enhanced: 'Softer speckle and clearer contrast. Display only; measurements are unchanged.',
  simple: 'Visual guide only: colors group similar radar patterns, not confirmed land cover. Measurements are unchanged.'
};

function updateImageViewControls() {
  const select = document.getElementById('image-view-select');
  const simpleOption = document.getElementById('simple-view-option');
  simpleOption.disabled = state.activeMission !== 'deforestation';
  select.disabled = state.activeMission === 'flood';
  select.value = state.imageView;
  document.getElementById('image-view-note').textContent = state.activeMission === 'flood'
    ? 'NISAR flood map: red shows new open water, blue shows other detected water. Colors are preserved.'
    : IMAGE_VIEW_NOTES[state.imageView];
  let legend = MISSION_METADATA[state.activeMission]?.legend || [];
  if (state.activeMission === 'deforestation' && state.forestSource === 'nisar') {
    legend = [
      { color: 'swatch-green', label: 'Green (HV): vegetation volume scattering' },
      { color: 'swatch-red', label: 'Red (HH − HV): polarization contrast' },
      { color: 'swatch-blue', label: 'Blue (HH): surface backscatter' }
    ];
  }
  if (state.imageView === 'simple' && state.activeMission === 'deforestation') {
    legend = [
      { color: 'swatch-simple-green', label: 'Green: vegetation-like radar pattern' },
      { color: 'swatch-sand', label: 'Sand: exposed-ground or built-up pattern' },
      { color: 'swatch-simple-blue', label: 'Blue: weak radar return; water and shadow can look similar' },
      { color: 'swatch-mixed', label: 'Gray: mixed radar pattern' }
    ];
  }
  document.getElementById('sidebar-legend').innerHTML = legend.map(item => `
    <div class="legend-item"><span class="legend-swatch ${item.color}"></span><span>${item.label}</span></div>
  `).join('');
}

function setImageView(mode) {
  if (state.activeMission === 'flood') return;
  if (!Object.hasOwn(IMAGE_VIEW_NOTES, mode)) return;
  state.imageView = mode === 'simple' && state.activeMission !== 'deforestation' ? 'enhanced' : mode;
  updateImageViewControls();
  if (state.imageView === 'simple') document.getElementById('map-legend-details').open = true;
  renderActiveFrame();
}

// Metadata Profiles
const MISSION_METADATA = {
  deforestation: {
    title: "Forest observations",
    region: "Draw a region on the map to begin",
    sensor: "Copernicus Sentinel-1 SAR (C-Band Microwave Radar)",
    timeframe: "Monthly Multi-Temporal Analysis",
    description: "Compare monthly Sentinel-1 radar observations for a selected region. Forest cover is estimated from VH backscatter; measurements appear after satellite processing completes.",
    legend: [
      { color: "swatch-green", label: "Green (VH): Intact forest canopy volume scattering (dense biomass)" },
      { color: "swatch-red", label: "Red (VV - VH): Bare soil, cleared logging plots, pasture roads" },
      { color: "swatch-blue", label: "Blue / Cyan: Edge disturbance, water courses & moisture saturation" }
    ]
  },
  flood: {
    title: "Flood detection & tracking",
    region: "Draw a region, then choose an observation period",
    sensor: "NISAR L-band SAR · GCOV HH + HV",
    timeframe: "Choose start and end dates",
    description: "Track new open water against the first NISAR acquisition. The same track and frame are used across dates; flooded vegetation is not mapped.",
    legend: [
      { color: "swatch-flood", label: "Red: new open water since the first acquisition" },
      { color: "swatch-water", label: "Blue: other detected open water" },
      { color: "swatch-dark", label: "Gray: HH radar backscatter on analyzed land" }
    ]
  },
  global: {
    title: "Global Earth Observation",
    region: "Worldwide Planetary View",
    sensor: "NASA Earth Science & ESA Copernicus Constellations",
    timeframe: "Active Global Missions",
    description: "Explore the planet in high resolution. Search for a location, then draw a region to analyze forest change.",
    legend: [
      { color: "swatch-blue", label: "Selected region: area used for satellite analysis" }
    ]
  }
};

/* ==========================================================================
   INITIALIZATION
   ========================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  setSidebarVisible(!window.matchMedia('(max-width: 820px)').matches);
  await loadManifest();
  setupEventListeners();
  setupSearch();
  setupSquareDrawingTool();
  
  // Start with no selection; only a user-drawn region starts an analysis.
  switchMission('deforestation');
});

function setSidebarVisible(visible) {
  const sidebar = document.getElementById('mission-sidebar');
  const toggle = document.getElementById('sidebar-toggle-btn');
  const loader = document.getElementById('gee-loading');
  sidebar.classList.toggle('collapsed', !visible);
  sidebar.inert = !visible;
  document.body.classList.toggle('sidebar-collapsed', !visible);
  toggle.classList.toggle('active', visible);
  toggle.setAttribute('aria-expanded', String(visible));

  // Keep progress visible even when the inspector is tucked away.
  if (visible) sidebar.insertBefore(loader, sidebar.querySelector('.sidebar-content'));
  else document.body.appendChild(loader);
  requestAnimationFrame(() => state.map?.invalidateSize({ pan: false }));
}

function mapFocusOptions() {
  const dock = document.getElementById('bottom-dock');
  const dockHeight = dock.getBoundingClientRect().height;
  return {
    paddingTopLeft: [32, 48],
    paddingBottomRight: [76, dockHeight + 64],
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.2,
    maxZoom: 12
  };
}

/* ==========================================================================
   MAP ENGINE INITIALIZATION
   ========================================================================== */
function initMap() {
  state.map = L.map('map', {
    center: [18, 0],
    zoom: 3,
    zoomControl: false,
    attributionControl: true,
    minZoom: 2,
    maxZoom: 18,
    worldCopyJump: true
  });

  L.control.zoom({ position: 'topright' }).addTo(state.map);
  L.control.scale({ position: 'bottomleft', imperial: true, metric: true }).addTo(state.map);

  // Setup Base Map Tile Layers
  state.baseMaps = {
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics, CNES/Airbus DS',
      maxZoom: 18
    }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors',
      subdomains: 'abcd',
      maxZoom: 19
    }),
    light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors',
      subdomains: 'abcd',
      maxZoom: 19
    }),
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }),
    night: L.tileLayer('https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg', {
      attribution: 'Imagery &copy; NASA EOSDIS GIBS VIIRS CityLights',
      bounds: [[-85.0511287776, -179.999999975], [85.0511287776, 179.999999975]],
      minZoom: 1,
      maxZoom: 8
    })
  };

  state.baseMaps.satellite.addTo(state.map);

  new ResizeObserver(() => {
    state.map.invalidateSize({ pan: false });
  }).observe(document.getElementById('map'));

  // Telemetry HUD Tracking
  state.map.on('mousemove', (e) => {
    const lat = e.latlng.lat.toFixed(4);
    const lng = e.latlng.lng.toFixed(4);
    const latStr = lat >= 0 ? `${lat}° N` : `${Math.abs(lat)}° S`;
    const lngStr = lng >= 0 ? `${lng}° E` : `${Math.abs(lng)}° W`;
    document.getElementById('hud-coords').textContent = `${latStr}, ${lngStr}`;
  });

  state.map.on('zoomend', () => {
    document.getElementById('hud-zoom').textContent = state.map.getZoom();
  });
}

/* ==========================================================================
   GEODETIC GEOMETRY & AREA CALCULATIONS
   ========================================================================== */
function calculateBBoxAreaKm2(bbox) {
  const [min_lon, min_lat, max_lon, max_lat] = bbox;
  const R = 6371.0; // km
  const lat_dist = Math.abs(max_lat - min_lat) * Math.PI / 180 * R;
  const mid_lat = ((min_lat + max_lat) / 2.0) * Math.PI / 180;
  const lon_dist = Math.abs(max_lon - min_lon) * Math.PI / 180 * R * Math.cos(mid_lat);
  return Math.round(lat_dist * lon_dist);
}

/* ==========================================================================
   MANIFEST DATA LOADER
   ========================================================================== */
async function loadManifest() {
  const tryPaths = [
    'data/manifest.json',
    '/data/manifest.json',
    'public/data/manifest.json',
    '../public/data/manifest.json'
  ];

  for (const path of tryPaths) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        state.manifest = await res.json();
        console.log(`[Observatory] Loaded manifest from: ${path}`);
        normalizeImagePaths(path);
        return;
      }
    } catch (e) {
      // Continue
    }
  }

  state.manifest = EMBEDDED_MANIFEST;
}

function normalizeImagePaths(manifestPath) {
  if (!state.manifest) return;
  let baseDir = manifestPath.substring(0, manifestPath.lastIndexOf('/') + 1) || 'data/';
  
  for (const key of Object.keys(state.manifest)) {
    state.manifest[key].forEach(item => {
      let imgPath = item.image;
      if (imgPath.startsWith('/data/')) {
        imgPath = imgPath.replace(/^\/data\//, baseDir);
      } else if (imgPath.startsWith('data/')) {
        imgPath = imgPath.replace(/^data\//, baseDir);
      }
      item.resolvedImage = imgPath;
    });
  }
}

/* ==========================================================================
   INTERACTIVE SQUARE SELECTOR (ROI BOUNDING BOX TOOL)
   ========================================================================== */
function setupSquareDrawingTool() {
  const mapEl = document.getElementById('map');
  const toast = document.getElementById('drawing-toast');
  const squareBtn = document.getElementById('square-select-btn');
  const cancelBtn = document.getElementById('cancel-drawing-btn');
  const drawChip = document.getElementById('draw-region-btn');

  function toggleDrawingMode(enable) {
    state.isDrawingSquare = enable !== undefined ? enable : !state.isDrawingSquare;
    squareBtn.setAttribute('aria-pressed', String(state.isDrawingSquare));

    if (state.isDrawingSquare) {
      if (window.matchMedia('(max-width: 820px)').matches) setSidebarVisible(false);
      mapEl.classList.add('drawing-mode');
      toast.classList.add('active');
      squareBtn.classList.add('square-active');
      state.map.dragging.disable();
    } else {
      mapEl.classList.remove('drawing-mode');
      toast.classList.remove('active');
      squareBtn.classList.remove('square-active');
      state.map.dragging.enable();
      state.drawStartLatLng = null;
      if (state.tempDrawRect) {
        state.map.removeLayer(state.tempDrawRect);
        state.tempDrawRect = null;
      }
    }
  }

  squareBtn.addEventListener('click', () => toggleDrawingMode());
  cancelBtn.addEventListener('click', () => toggleDrawingMode(false));
  if (drawChip) drawChip.addEventListener('click', () => toggleDrawingMode(true));

  // Map Mousedown: start drawing square
  state.map.on('mousedown', (e) => {
    if (!state.isDrawingSquare) return;
    state.drawStartLatLng = e.latlng;

    if (state.tempDrawRect) {
      state.map.removeLayer(state.tempDrawRect);
    }

    state.tempDrawRect = L.rectangle(L.latLngBounds(e.latlng, e.latlng), {
      color: '#00e5ff',
      weight: 2,
      dashArray: '5, 5',
      fillColor: '#00e5ff',
      fillOpacity: 0.15
    }).addTo(state.map);
  });

  // Map Mousemove: stretch square
  state.map.on('mousemove', (e) => {
    if (!state.isDrawingSquare || !state.drawStartLatLng || !state.tempDrawRect) return;
    const currentBounds = L.latLngBounds(state.drawStartLatLng, e.latlng);
    state.tempDrawRect.setBounds(currentBounds);
  });

  // Map Mouseup: finish square
  state.map.on('mouseup', (e) => {
    if (!state.isDrawingSquare || !state.drawStartLatLng) return;

    const south = Math.min(state.drawStartLatLng.lat, e.latlng.lat);
    const north = Math.max(state.drawStartLatLng.lat, e.latlng.lat);
    const west = Math.min(state.drawStartLatLng.lng, e.latlng.lng);
    const east = Math.max(state.drawStartLatLng.lng, e.latlng.lng);

    // Prevent zero-size clicks
    if (Math.abs(north - south) > 0.05 && Math.abs(east - west) > 0.05) {
      const drawnBbox = [
        parseFloat(west.toFixed(4)),
        parseFloat(south.toFixed(4)),
        parseFloat(east.toFixed(4)),
        parseFloat(north.toFixed(4))
      ];

      // Finalize ROI
      if (state.activeMission === 'flood') selectFloodRoi(drawnBbox);
      else selectDeforestationRoi(drawnBbox, "Custom Bounding Box", 2025);
    }

    toggleDrawingMode(false);
  });
}

/* ==========================================================================
   SELECT & ANALYZE ROI SQUARE (Matching pipeline.py /api/analyze)
   ========================================================================== */
async function selectDeforestationRoi(bbox, regionName, year = 2025) {
  if (state.activeMission !== 'deforestation') switchMission('deforestation');
  state.forestExampleId = '';
  updateForestExampleControls();
  state.activeRoiBBox = bbox;
  state.activeRoiName = regionName;
  stopPlayback();
  state.currentFrameIndex = 0;
  document.getElementById('bottom-dock').hidden = false;

  state.isComparing = false;
  document.getElementById('compare-btn').classList.remove('active');
  document.getElementById('compare-btn').setAttribute('aria-pressed', 'false');

  const [min_lon, min_lat, max_lon, max_lat] = bbox;
  const leafBounds = [[min_lat, min_lon], [max_lat, max_lon]];
  const areaKm2 = calculateBBoxAreaKm2(bbox);

  // Update UI Header
  document.getElementById('sidebar-title').textContent = regionName;
  document.getElementById('sidebar-region').textContent = state.forestSource === 'nisar' ? 'NISAR L-band · selected region' : `Sentinel-1 radar · ${year}`;
  document.getElementById('roi-area-badge').textContent = `${areaKm2.toLocaleString()} km²`;
  document.getElementById('kpi-year').textContent = year;

  // Fly to Bounding Box
  state.map.flyToBounds(leafBounds, mapFocusOptions());

  drawSelectedRegion(bbox);

  // Fetch or Compute Metrics via /api/analyze endpoint
  if (state.forestSource === 'nisar') {
    resetForestAnalysis();
    setSidebarVisible(true);
  } else await fetchRoiAnalysis(bbox, year, regionName);
}

// Trigger explicit pipeline analysis
window.triggerRoiAnalysis = function() {
  if (!state.activeRoiBBox) {
    document.getElementById('square-select-btn').click();
    return;
  }
  if (state.forestSource === 'nisar') document.getElementById('forest-analysis-form').requestSubmit();
  else fetchRoiAnalysis(state.activeRoiBBox, 2025, state.activeRoiName);
};

/* ==========================================================================
   REQUEST SATELLITE ANALYSIS & UPDATE SIDEBAR CHARTS
   ========================================================================== */
function pendingRoiAnalysis(bbox, year) {
  return {
    year, region: null, metrics_ready: false, status: 'running',
    total_region_area_km2: calculateBBoxAreaKm2(bbox),
    monthly_series: Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, '0');
      const days = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
      return {
        month_label: new Date(Date.UTC(year, index, 1)).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        start_date: `${year}-${month}-01`,
        end_date: `${year}-${month}-${days}`,
        forest_area_km2: null, loss_speed_km2_month: null, image_url: null
      };
    })
  };
}

async function fetchRoiAnalysis(bbox, year, regionName) {
  const requestId = ++state.analysisRequestId;
  globalThis.SarImageEffects?.clear();
  clearTimeout(state.geePollTimer);
  state.geePollTimer = null;
  state.activeRoiData = pendingRoiAnalysis(bbox, year);
  if (state.activeOverlay) {
    state.map.removeLayer(state.activeOverlay);
    state.activeOverlay = null;
  }
  if (state.activeMission === 'deforestation') {
    updateDeforestationUI(state.activeRoiData, bbox);
    setGeeLoading(true);
  }
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbox, year, region_name: regionNameKey(regionName) })
    });
    if (!res.ok) {
      const failure = await res.json().catch(() => ({}));
      throw new Error(failure.error || 'Satellite analysis is unavailable. Run the app with server.py.');
    }
    const data = await res.json();
    if (requestId !== state.analysisRequestId) return;
    if (data.source !== 'COPERNICUS/S1_GRD' || typeof data.metrics_ready !== 'boolean') {
      throw new Error('Restart server.py to enable satellite-derived measurements.');
    }
    state.activeRoiData = data;
    if (state.activeMission === 'deforestation') {
      updateDeforestationUI(data, bbox);
      pollGeneratedFrames(data.region, requestId);
    }
  } catch (err) {
    if (requestId === state.analysisRequestId) showAnalysisError(err.message);
  }
}

function formatMeasurement(value, unit = 'km²') {
  return Number.isFinite(value)
    ? `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`
    : '—';
}

function updateDeforestationUI(data, bbox) {
  document.getElementById('kpi-section').hidden = false;
  document.getElementById('bottom-dock').hidden = false;
  const measured = data.metrics_ready === true;
  const nisar = data.source === 'NISAR_L2_GCOV';
  const series = nisar ? (data.acquisition_series || []).map(row => ({ ...row,
    month_label: row.date, start_date: row.date, end_date: row.date,
    loss_speed_km2_month: row.loss_km2 })) : data.monthly_series || [];
  document.getElementById('forest-baseline-label').textContent = nisar ? 'Baseline vegetation' : 'Baseline forest';
  document.getElementById('forest-loss-label').textContent = nisar ? 'Net vegetation loss' : 'Forest lost';
  document.getElementById('forest-peak-label').textContent = nisar ? 'Peak interval loss' : 'Peak monthly loss';
  document.getElementById('forest-period-label').textContent = nisar ? 'Observations' : 'Observation year';
  document.getElementById('forest-chart-label').textContent = nisar ? 'Vegetation loss by acquisition' : 'Monthly forest loss';
  document.getElementById('forest-cancel-btn').hidden = !nisar || data.status !== 'running';
  document.getElementById('forest-cancel-btn').disabled = !data.region;
  document.getElementById('forest-coverage-note').hidden = !nisar || !measured;
  document.getElementById('forest-coverage-note').textContent = nisar && measured
    ? `${formatMeasurement(data.total_region_area_km2)} of common valid land analyzed. Baseline: ${data.baseline_date}. Only the selected frame and land observed on every date are included. Loss is measured between acquisitions, not per month.` : '';
  document.getElementById('forest-downloads').hidden = !nisar || !measured;
  if (nisar && measured) {
    for (const [id, key] of [['forest-csv-download', 'csv'], ['forest-tiff-download', 'geotiff']]) {
      const anchor = document.getElementById(id);
      const url = data.downloads?.[key];
      const safe = typeof url === 'string' && url.startsWith(`/public/data/${data.region}/`) && !url.includes('..');
      anchor.hidden = !safe;
      if (safe) anchor.href = url;
    }
  }
  document.getElementById('roi-area-badge').textContent = formatMeasurement(data.total_region_area_km2);
  document.getElementById('metrics-status').textContent = measured
    ? nisar ? 'NISAR L-band · Exploratory vegetation estimates' : 'Sentinel-1 SAR · Radar-derived estimates'
    : data.error ? 'Satellite analysis unavailable' : 'Waiting for satellite measurements';
  if (data.saved_example) document.getElementById('metrics-status').textContent = 'Saved example · ' + document.getElementById('metrics-status').textContent;
  document.getElementById('metrics-method').textContent = measured
    ? nisar ? `HV gamma0 > ${data.method.hv_threshold_db} dB · 4 × 4 averaging. Exploratory vegetation-cover proxy requiring regional calibration; not an official NISAR forest-disturbance product.`
      : `Monthly median VH > ${data.method.vh_threshold_db} dB · ${data.method.scale_m} m analysis scale. Radar-derived forest-cover estimates, not a validated land-cover classification.`
    : 'Forest measurements will appear after satellite processing completes.';
  document.getElementById('kpi-baseline').textContent = measured ? formatMeasurement(nisar ? data.baseline_forest_km2 : data.baseline_jan_forest_km2) : '—';
  const area = data.total_region_area_km2;
  const baseline = nisar ? data.baseline_forest_km2 : data.baseline_jan_forest_km2;
  document.getElementById('kpi-baseline-pct').textContent = measured && area > 0 && Number.isFinite(baseline)
    ? `${(baseline / area * 100).toFixed(1)}% estimated coverage` : 'Awaiting analysis';

  const lost = data.total_forest_lost_km2;
  document.getElementById('kpi-lost').textContent = measured && Number.isFinite(lost)
    ? `${lost > 0 ? '−' : lost < 0 ? '+' : ''}${formatMeasurement(Math.abs(lost))}` : '—';
  const change = data.net_loss_percentage;
  document.getElementById('kpi-loss-pct').textContent = measured && Number.isFinite(change)
    ? `${Math.abs(change)}% ${change < 0 ? 'increase' : 'decrease'}`
    : measured ? 'No baseline forest to compare' : 'Awaiting analysis';
  document.getElementById('kpi-speed').textContent = measured ? formatMeasurement(nisar ? data.peak_loss_km2 : data.peak_monthly_loss_km2, nisar ? 'km²' : 'km²/mo') : '—';
  const peakDate = nisar ? data.peak_loss_date : data.peak_logging_month;
  document.getElementById('kpi-peak-month').textContent = measured
    ? peakDate ? `Peak: ${peakDate}` : nisar ? 'No interval loss detected' : 'No monthly loss detected'
    : 'Awaiting analysis';
  document.getElementById('kpi-year').textContent = nisar ? measured ? series.length : '—' : data.year;
  document.getElementById('kpi-pass').textContent = nisar ? measured ? `Track ${data.track}${data.direction} · frame ${data.frame}` : 'Track pending' : data.orbit_pass
    ? `${data.orbit_pass.toLowerCase()} pass` : 'Orbit pending';

  const maxSpeed = Math.max(1, ...series.map(item => item.loss_speed_km2_month || 0));
  document.getElementById('chart-bars').innerHTML = measured ? series.map((item, idx) => {
    const speed = item.loss_speed_km2_month;
    const height = Math.max(0, speed / maxSpeed * 100);
    return `
      <button type="button" class="chart-bar-col" data-index="${idx}"
        aria-label="${item.month_label}: ${speed} km² estimated ${nisar ? 'vegetation' : 'forest-cover'} loss"
        title="${item.month_label}: ${speed} ${nisar ? 'km² / interval' : 'km²/mo'}" onclick="jumpToFrame(${idx})">
        <span class="chart-bar-fill" style="height:${height}%;min-height:${speed > 0 ? 3 : 0}px"></span>
        <span class="chart-bar-label">${nisar ? item.date.slice(5) : item.month_label.split(' ')[0][0]}</span>
      </button>`;
  }).join('') : '';
  document.getElementById('chart-active-val').textContent = measured ? nisar ? 'km² / interval' : 'km² / month' : 'Awaiting measurements';

  // Preserve the selected date and any already-downloaded images as metrics arrive.
  const existingImages = new Map(state.activeFrames.map(frame => [frame.sourceImage, frame.image]));
  const frameRegionKey = data.region || regionNameKey(state.activeRoiName);
  state.activeFrames = series.map((item, idx) => {
    const sourceImage = item.image || `${frameRegionKey}_${data.year}_${String(idx + 1).padStart(2, '0')}.png`;
    return {
      id: idx,
      label: measured
        ? `${item.month_label} · ${formatMeasurement(item.forest_area_km2)} estimated ${nisar ? 'vegetation' : 'forest'}`
        : `${item.month_label} · Satellite imagery`,
      startDate: item.start_date,
      endDate: item.end_date,
      bounds: nisar ? item.bounds : [[bbox[1], bbox[0]], [bbox[3], bbox[2]]],
      image: item.image_url || existingImages.get(sourceImage) || null,
      sourceImage,
      loss_speed: measured ? item.loss_speed_km2_month : null,
      loss_unit: nisar ? 'km² / interval' : 'km²/mo'
    };
  });
  state.currentFrameIndex = Math.max(0, Math.min(state.currentFrameIndex, state.activeFrames.length - 1));
  const slider = document.getElementById('timeline-slider');
  slider.min = 0;
  slider.max = Math.max(0, state.activeFrames.length - 1);
  slider.value = state.currentFrameIndex;
  document.getElementById('timeline-ticks').innerHTML = state.activeFrames.map(frame =>
    `<span class="timeline-tick-label">${nisar ? frame.startDate.slice(5) : frame.startDate.split('-')[1]}</span>`
  ).join('');
  renderActiveFrame();
}

function regionNameKey(name) {
  return String(name || 'custom_roi').toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function updateForestExampleControls() {
  const examples = FOREST_EXAMPLES[state.forestSource] || [];
  const select = document.getElementById('forest-example-select');
  select.innerHTML = '<option value="">Choose a saved example</option>'
    + examples.map(example => `<option value="${example.id}">${example.name}</option>`).join('');
  select.value = state.forestExampleId;
  select.disabled = examples.length === 0;
  const selected = examples.find(example => example.id === state.forestExampleId);
  document.getElementById('forest-example-note').textContent = selected
    ? `${selected.name} · ${state.forestSource === 'nisar' ? `${selected.start_date} → ${selected.end_date}` : selected.year}. Analyze forest reruns these settings.`
    : 'Open an example to view saved radar images and measurements.';
}

async function selectForestExample(id) {
  const example = (FOREST_EXAMPLES[state.forestSource] || []).find(item => item.id === id);
  if (!example) return;
  if (state.activeMission !== 'deforestation') switchMission('deforestation');
  resetForestAnalysis();
  const requestId = state.analysisRequestId;
  state.forestExampleId = example.id;
  state.activeRoiBBox = [...example.bbox];
  state.activeRoiName = example.name;
  updateForestExampleControls();
  if (state.forestSource === 'nisar') {
    document.getElementById('forest-start-date').value = example.start_date;
    document.getElementById('forest-end-date').value = example.end_date;
    document.getElementById('forest-hv-threshold').value = example.hv_threshold_db;
  }
  document.getElementById('sidebar-title').textContent = example.name;
  drawSelectedRegion(example.bbox);
  state.map.flyToBounds([[example.bbox[1], example.bbox[0]], [example.bbox[3], example.bbox[2]]], mapFocusOptions());
  setSidebarVisible(true);
  updateForestSourceControls();
  setGeeLoading(true, 'Opening saved forest images and measurements…', 0, example.observation_count);
  document.getElementById('gee-loading').querySelector('strong').textContent = 'Opening saved example';
  try {
    const response = await fetch(example.metrics_url, { cache: 'no-store' });
    if (!response.ok) throw new Error('This saved example could not be opened. Select Analyze forest to run it again.');
    const data = await response.json();
    if (requestId !== state.analysisRequestId || state.forestExampleId !== example.id) return;
    const nisar = state.forestSource === 'nisar';
    const rows = nisar ? data.acquisition_series : data.monthly_series;
    if (data.source !== (nisar ? 'NISAR_L2_GCOV' : 'COPERNICUS/S1_GRD')
        || data.region !== example.region || JSON.stringify(data.bbox) !== JSON.stringify(example.bbox)
        || data.metrics_ready !== true || !data.method || !Array.isArray(rows)
        || rows.length !== example.observation_count
        || (nisar ? data.mission !== 'forest' || data.start_date !== example.start_date
          || data.end_date !== example.end_date || data.method.hv_threshold_db !== example.hv_threshold_db
          : data.year !== example.year || rows.length !== 12)
        || rows.some((row, index) => typeof row.image !== 'string'
          || !/^[a-zA-Z0-9_-]+\.png$/.test(row.image)
          || !Number.isFinite(row.forest_area_km2)
          || (nisar && (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)
            || row.date < example.start_date || row.date > example.end_date
            || (index > 0 && row.date <= rows[index - 1].date)
            || !Number.isFinite(row.loss_km2))))) {
      throw new Error('The saved measurements do not match this example. Select Analyze forest to run it again.');
    }
    const directory = `/public/data/${example.region}/`;
    rows.forEach(row => { row.image_url = directory + row.image; });
    data.downloads = { csv: directory + 'metrics.csv' };
    if (nisar) data.downloads.geotiff = directory + 'forest.tif';
    Object.assign(data, { status: 'complete', saved_example: true });
    state.activeRoiData = data;
    if (state.activeMission === 'deforestation') {
      updateDeforestationUI(data, example.bbox);
      updateForestSourceControls();
      setGeeLoading(false);
    }
  } catch (error) {
    if (requestId !== state.analysisRequestId || state.forestExampleId !== example.id) return;
    document.getElementById('forest-example-note').textContent = error.message;
    if (state.activeMission === 'deforestation') showAnalysisError(error.message);
  }
}

function updateForestSourceControls() {
  const nisar = state.forestSource === 'nisar';
  document.getElementById('forest-source-select').value = state.forestSource;
  document.getElementById('forest-nisar-options').hidden = !nisar;
  for (const id of ['forest-start-date', 'forest-end-date', 'forest-hv-threshold']) {
    document.getElementById(id).disabled = !nisar;
    document.getElementById(id).required = nisar;
  }
  document.getElementById('forest-source-note').textContent = nisar
    ? 'NISAR HH/HV observations on actual acquisition dates. Requires NASA Earthdata access. At least two dates after the July 2025 launch are needed.'
    : 'Monthly Sentinel-1 observations for 2025. Requires Google Earth Engine access.';
  if (state.activeMission !== 'deforestation') return;
  document.getElementById('workspace-sensor').textContent = nisar ? 'NISAR L-band SAR' : 'Sentinel-1 SAR';
  document.getElementById('sidebar-sensor').textContent = nisar ? 'NISAR L-band SAR · GCOV HH + HV' : MISSION_METADATA.deforestation.sensor;
  document.getElementById('sidebar-timeframe').textContent = nisar
    ? state.activeRoiData ? `${state.activeRoiData.start_date} → ${state.activeRoiData.end_date}` : 'Choose start and end dates'
    : 'Monthly sequence · 2025';
  document.getElementById('sidebar-region').textContent = state.activeRoiBBox
    ? nisar ? 'NISAR L-band · selected region' : 'Sentinel-1 radar · 2025' : MISSION_METADATA.deforestation.region;
  document.getElementById('sidebar-desc').textContent = nisar
    ? 'Compare NISAR L-band observations for a selected region. HV backscatter provides an exploratory vegetation-cover estimate; it needs regional calibration.'
    : MISSION_METADATA.deforestation.description;
  if (!state.activeRoiData) document.getElementById('metrics-method').textContent = nisar
    ? 'Exploratory HV gamma0 threshold. Estimates are not an official NISAR forest-disturbance product.'
    : 'Forest measurements will appear after satellite processing completes.';
  updateImageViewControls();
  updateForestExampleControls();
}

function forestClientId() {
  // Separate identifiers allow forest and flood workers to run independently.
  return getFloodClientId().replace(/^flood_/, 'forest_');
}

function cancelNisarForestRun() {
  const data = state.activeRoiData;
  if (data?.source !== 'NISAR_L2_GCOV' || data.status !== 'running' || !data.region) return;
  fetch('/api/nisar/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: forestClientId(), region_name: data.region })
  }).catch(error => console.warn('Could not cancel NISAR forest analysis:', error.message));
}

function resetForestAnalysis() {
  cancelNisarForestRun();
  ++state.analysisRequestId;
  state.imageRenderId++;
  clearTimeout(state.geePollTimer);
  state.geePollTimer = null;
  stopPlayback();
  state.isComparing = false;
  document.getElementById('compare-btn').classList.remove('active');
  document.getElementById('compare-btn').setAttribute('aria-pressed', 'false');
  state.activeRoiData = null;
  state.activeFrames = [];
  state.currentFrameIndex = 0;
  globalThis.SarImageEffects?.clear();
  if (state.activeOverlay) { state.map.removeLayer(state.activeOverlay); state.activeOverlay = null; }
  document.getElementById('kpi-section').hidden = true;
  document.getElementById('bottom-dock').hidden = true;
  document.getElementById('forest-cancel-btn').hidden = true;
  document.getElementById('forest-analysis-error').hidden = true;
  setGeeLoading(false);
}

function setNisarForestProgress(progress = {}, elapsed) {
  setGeeLoading(true, progress.message || 'Searching NISAR forest observations…', progress.completed || 0, progress.total || 0);
  document.getElementById('gee-progress-label').textContent = `NISAR · ${progress.stage || 'starting'}${Number.isFinite(elapsed) ? ` · ${elapsed}s elapsed` : ''}`;
}

function setupForestControls() {
  const start = document.getElementById('forest-start-date');
  const end = document.getElementById('forest-end-date');
  const now = new Date();
  const earlier = new Date(now);
  earlier.setUTCDate(earlier.getUTCDate() - 90);
  start.value = earlier.toISOString().slice(0, 10);
  end.value = now.toISOString().slice(0, 10);
  start.max = end.max = end.value;
  document.getElementById('forest-source-select').addEventListener('change', event => {
    if (!['sentinel1', 'nisar'].includes(event.target.value)) return;
    resetForestAnalysis();
    state.forestSource = event.target.value;
    state.forestExampleId = '';
    updateForestSourceControls();
    if (state.activeRoiBBox) drawSelectedRegion(state.activeRoiBBox);
  });
  document.getElementById('forest-example-select').addEventListener('change', event => selectForestExample(event.target.value));
  document.getElementById('forest-cancel-btn').addEventListener('click', () => {
    cancelNisarForestRun();
    ++state.analysisRequestId;
    clearTimeout(state.geePollTimer);
    if (state.activeRoiData) state.activeRoiData.status = 'cancelled';
    document.getElementById('forest-cancel-btn').hidden = true;
    document.getElementById('metrics-status').textContent = 'Analysis cancelled';
    setGeeLoading(false);
  });
  document.getElementById('forest-analysis-form').addEventListener('submit', event => {
    event.preventDefault();
    const error = document.getElementById('forest-analysis-error');
    error.hidden = true;
    const thresholdInput = document.getElementById('forest-hv-threshold');
    for (const field of [start, end, thresholdInput]) field.setAttribute('aria-invalid', 'false');
    let message = '';
    let field = end;
    const threshold = Number(thresholdInput.value);
    if (!state.activeRoiBBox) message = 'Draw a region on the map before starting forest analysis.';
    else if (state.forestSource === 'nisar') {
      if (!start.value) { message = 'Enter a start date.'; field = start; }
      else if (!end.value) message = 'Enter an end date.';
      else if (start.value >= end.value) message = 'End date must be after start date.';
      else if (end.value < '2025-07-30') message = 'NISAR launched in July 2025. Choose a period after launch.';
      else if (end.value > new Date().toISOString().slice(0, 10)) message = 'End date cannot be in the future.';
      else if (!thresholdInput.value || !Number.isFinite(threshold) || threshold < -40 || threshold > 0) {
        message = 'Choose an HV threshold between −40 and 0 dB.'; field = thresholdInput;
      }
    }
    if (message) {
      error.textContent = message;
      error.hidden = false;
      if (!state.activeRoiBBox) document.getElementById('draw-region-btn').focus();
      else { field.setAttribute('aria-invalid', 'true'); field.focus(); }
      return;
    }
    if (state.forestSource === 'nisar') fetchNisarForestAnalysis(state.activeRoiBBox, start.value, end.value, threshold);
    else {
      resetForestAnalysis();
      fetchRoiAnalysis(state.activeRoiBBox, 2025, state.activeRoiName);
    }
  });
  updateForestSourceControls();
}

async function fetchNisarForestAnalysis(bbox, startDate, endDate, threshold) {
  resetForestAnalysis();
  const requestId = state.analysisRequestId;
  state.activeRoiData = { source: 'NISAR_L2_GCOV', mission: 'forest', bbox,
    start_date: startDate, end_date: endDate, hv_threshold_db: threshold,
    status: 'running', metrics_ready: false, acquisition_series: [] };
  updateDeforestationUI(state.activeRoiData, bbox);
  updateForestSourceControls();
  setNisarForestProgress();
  try {
    const response = await fetch('/api/forest/nisar/analyze', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bbox,
        start_date: startDate, end_date: endDate, hv_threshold_db: threshold,
        region_name: regionNameKey(state.activeRoiName), client_id: forestClientId() }) });
    const data = await response.json();
    if (requestId !== state.analysisRequestId) return;
    if (!response.ok) throw new Error(data.error || 'NISAR forest analysis could not start. Run server.py.');
    if (data.source !== 'NISAR_L2_GCOV' || data.mission !== 'forest' || !data.region
        || data.metrics_ready !== false || data.start_date !== startDate || data.end_date !== endDate
        || data.hv_threshold_db !== threshold || JSON.stringify(data.bbox) !== JSON.stringify(bbox)) {
      throw new Error('NISAR returned a mismatched forest analysis.');
    }
    state.activeRoiData = data;
    if (state.activeMission === 'deforestation') {
      updateDeforestationUI(data, bbox);
      await pollNisarForestAnalysis(data.region, requestId);
    }
  } catch (error) {
    if (requestId === state.analysisRequestId) showAnalysisError(error.message);
  }
}

async function pollNisarForestAnalysis(region, requestId = state.analysisRequestId) {
  if (state.activeMission !== 'deforestation' || state.forestSource !== 'nisar'
      || requestId !== state.analysisRequestId || state.activeRoiData?.region !== region) return;
  try {
    const response = await fetch(`/api/analyze/status?region_name=${encodeURIComponent(region)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to retrieve NISAR forest analysis.');
    const status = await response.json();
    if (state.activeMission !== 'deforestation' || state.forestSource !== 'nisar'
        || requestId !== state.analysisRequestId || state.activeRoiData?.region !== region) return;
    if (status.region !== region) throw new Error('NISAR returned results for another region.');
    if (status.status === 'error') throw new Error(status.error || 'NISAR forest processing failed.');
    if (status.status === 'cancelled') {
      state.activeRoiData.status = 'cancelled';
      document.getElementById('forest-cancel-btn').hidden = true;
      document.getElementById('metrics-status').textContent = 'Analysis cancelled';
      setGeeLoading(false);
      return;
    }
    if (status.status === 'complete') {
      const metrics = status.metrics;
      const selection = state.activeRoiData;
      const rows = metrics?.acquisition_series;
      if (!status.metrics_ready || !metrics?.metrics_ready || metrics.source !== 'NISAR_L2_GCOV'
          || metrics.mission !== 'forest' || metrics.region !== region
          || JSON.stringify(metrics.bbox) !== JSON.stringify(state.activeRoiBBox)
          || metrics.start_date !== selection.start_date || metrics.end_date !== selection.end_date
          || !metrics.method || metrics.method.hv_threshold_db !== selection.hv_threshold_db
          || !Array.isArray(rows) || rows.length < 2 || rows.some((row, index) =>
            !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || row.date < selection.start_date || row.date > selection.end_date
            || (index > 0 && row.date <= rows[index-1].date)
            || !Number.isFinite(row.forest_area_km2) || !Number.isFinite(row.loss_km2)
            || typeof row.image_url !== 'string' || !row.image_url.startsWith(`/public/data/${region}/`))) {
        throw new Error('NISAR forest measurements do not match the selected region, dates, and threshold.');
      }
      state.activeRoiData = metrics;
      updateDeforestationUI(metrics, state.activeRoiBBox);
      updateForestSourceControls();
      setGeeLoading(false);
      return;
    }
    setNisarForestProgress(status.progress || {}, status.elapsed_seconds);
    scheduleAnalysisPoll(region, requestId);
  } catch (error) {
    if (requestId === state.analysisRequestId && state.activeRoiData?.region === region) showAnalysisError(error.message);
  }
}

function setGeeLoading(isLoading, message = '', loaded = 0, total = 12, isError = false) {
  const loader = document.getElementById('gee-loading');
  if (!loader) return;
  loader.querySelector('strong').textContent = isError ? 'Satellite data unavailable' : 'Analyzing satellite observations';
  loader.querySelector('small').textContent = message || 'Calculating forest cover from Sentinel-1 radar…';
  document.getElementById('gee-progress-fill').style.width = `${Math.min(100, Math.round(loaded / Math.max(1, total) * 100))}%`;
  document.getElementById('gee-progress-label').textContent = `${loaded} / ${total} images ready`;
  loader.hidden = !isLoading && !isError;
}

function showAnalysisError(message) {
  if (state.activeRoiData) {
    state.activeRoiData.error = message;
    state.activeRoiData.status = 'error';
  }
  if (state.activeMission !== 'deforestation') return;
  document.getElementById('metrics-status').textContent = 'Satellite analysis unavailable';
  document.getElementById('forest-cancel-btn').hidden = true;
  setGeeLoading(false, message, state.activeFrames.filter(frame => frame.image).length, 12, true);
  if (state.activeRoiData?.source === 'NISAR_L2_GCOV') document.getElementById('gee-progress-label').textContent = 'NISAR · analysis stopped';
}

function scheduleAnalysisPoll(regionKey, requestId) {
  clearTimeout(state.geePollTimer);
  state.geePollTimer = setTimeout(() => pollGeneratedFrames(regionKey, requestId), 2500);
}

async function pollGeneratedFrames(regionKey, requestId = state.analysisRequestId) {
  if (state.activeRoiData?.saved_example) return;
  if (state.activeRoiData?.source === 'NISAR_L2_GCOV') return pollNisarForestAnalysis(regionKey, requestId);
  if (!regionKey || state.activeMission !== 'deforestation' || requestId !== state.analysisRequestId) return;
  try {
    const res = await fetch(`/api/analyze/status?region_name=${encodeURIComponent(regionKey)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Unable to retrieve satellite analysis results.');
    const status = await res.json();
    if (state.activeMission !== 'deforestation' || requestId !== state.analysisRequestId || state.activeRoiData?.region !== regionKey) return;
    if (status.region !== regionKey) throw new Error('Received results for a different analysis region.');
    const images = new Map((status.images || []).map(item => [item.filename, item.image_url]));
    let changed = false;
    state.activeFrames.forEach(frame => {
      const url = images.get(frame.sourceImage);
      if (url && frame.image !== url) { frame.image = url; changed = true; }
    });
    if (status.metrics_ready && status.metrics && !state.activeRoiData.metrics_ready) {
      const metrics = status.metrics;
      if (metrics.region !== regionKey || metrics.source !== 'COPERNICUS/S1_GRD'
          || metrics.year !== state.activeRoiData.year
          || JSON.stringify(metrics.bbox) !== JSON.stringify(state.activeRoiBBox)
          || metrics.monthly_series?.length !== 12 || !metrics.method) {
        throw new Error('Satellite measurements do not match this region and year.');
      }
      state.activeRoiData = metrics;
      updateDeforestationUI(metrics, state.activeRoiBBox);
    } else if (changed) renderActiveFrame();
    const ready = state.activeFrames.filter(frame => frame.image).length;
    const total = state.activeFrames.length || 12;
    if (status.status === 'error') {
      showAnalysisError(status.error || 'Satellite processing failed. Select the region to retry.');
      return;
    }
    if (status.status === 'complete') {
      if (!state.activeRoiData.metrics_ready) {
        showAnalysisError('Satellite processing ended without forest measurements.');
      } else if (ready < total) {
        setGeeLoading(false, 'Forest estimates are ready, but some image downloads failed.', ready, total, true);
      } else {
        setGeeLoading(false, '', ready, total);
      }
      return;
    }
    setGeeLoading(true, ready >= total ? 'Images ready; finalizing forest measurements…' : '', ready, total);
    scheduleAnalysisPoll(regionKey, requestId);
  } catch (err) {
    if (requestId === state.analysisRequestId && state.activeRoiData?.region === regionKey) showAnalysisError(err.message);
  }
}

/* NISAR flood selection, dated acquisitions, and independent request lifecycle. */
function drawSelectedRegion(bbox) {
  const [west, south, east, north] = bbox;
  if (state.boundsRect) state.map.removeLayer(state.boundsRect);
  if (state.roiAnchorMarker) state.map.removeLayer(state.roiAnchorMarker);
  const bounds = [[south, west], [north, east]];
  state.boundsRect = L.rectangle(bounds, {
    color: '#73e2cf', weight: 1.5, dashArray: '6, 6', fillColor: '#73e2cf', fillOpacity: 0.03
  }).addTo(state.map);
  const icon = L.divIcon({ className: 'roi-anchor-div',
    html: `<div class="roi-anchor-badge"><span>Selected region · <strong>${calculateBBoxAreaKm2(bbox).toLocaleString()} km²</strong></span></div>`,
    iconSize: [184, 30], iconAnchor: [92, 42] });
  state.roiAnchorMarker = L.marker(L.latLng(north, (west + east) / 2), { icon }).addTo(state.map);
}

function selectFloodRoi(bbox, name = 'Selected flood region', referenceId = '') {
  cancelPreviousFloodRun();
  ++state.flood.requestId;
  clearTimeout(state.flood.timer);
  state.flood.bbox = bbox;
  state.flood.name = name;
  state.flood.referenceId = referenceId;
  state.flood.data = null;
  state.imageRenderId++;
  stopPlayback();
  state.isComparing = false;
  document.getElementById('compare-btn').classList.remove('active');
  document.getElementById('compare-btn').setAttribute('aria-pressed', 'false');
  state.activeFrames = [];
  state.currentFrameIndex = 0;
  if (state.activeOverlay) { state.map.removeLayer(state.activeOverlay); state.activeOverlay = null; }
  drawSelectedRegion(bbox);
  state.map.flyToBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], mapFocusOptions());
  document.getElementById('sidebar-title').textContent = state.flood.name;
  document.getElementById('sidebar-region').textContent = referenceId
    ? 'NISAR L-band · reference study area' : 'NISAR L-band · selected region';
  document.getElementById('flood-kpi-section').hidden = true;
  document.getElementById('flood-cancel-btn').hidden = true;
  document.getElementById('bottom-dock').hidden = true;
  document.getElementById('flood-date-error').hidden = true;
  document.getElementById('flood-selection-status').textContent = `${formatMeasurement(calculateBBoxAreaKm2(bbox))} selected. Choose dates and select Analyze floods.`;
  setGeeLoading(false);
  setSidebarVisible(true);
  updateFloodReferenceDetails();
}

function updateFloodReferenceDetails() {
  const site = FLOOD_REFERENCES.find(item => item.id === state.flood.referenceId);
  document.getElementById('flood-reference-select').value = site?.id || '';
  document.getElementById('flood-reference-details').hidden = !site;
  document.getElementById('flood-reference-context').textContent = site
    ? `${site.context} Historical events provide context; choose recent dates to check NISAR observations.` : '';
  const source = document.getElementById('flood-reference-source');
  if (site) source.href = site.source;
  else source.removeAttribute('href');
  state.flood.referenceLayer?.eachLayer(marker => {
    marker.getElement?.()?.classList.toggle('selected', marker.options.referenceId === site?.id);
  });
}

function selectFloodReference(id) {
  const site = FLOOD_REFERENCES.find(item => item.id === id);
  if (!site) return;
  if (state.activeMission !== 'flood') switchMission('flood');
  selectFloodRoi([...site.bbox], site.label, site.id);
}

function updateFloodReferenceMarkers() {
  if (state.activeMission !== 'flood') {
    if (state.flood.referenceLayer) state.map.removeLayer(state.flood.referenceLayer);
    return;
  }
  if (!state.flood.referenceLayer) {
    state.flood.referenceLayer = L.layerGroup(FLOOD_REFERENCES.map((site, index) => {
      const marker = L.marker(site.center, {
        icon: L.divIcon({ className: 'flood-reference-marker', html: `<span>${index + 1}</span>`,
          iconSize: [32, 32], iconAnchor: [16, 16] }),
        title: `${index + 1}. ${site.label} — select study area`, alt: site.label,
        keyboard: true, referenceId: site.id, zIndexOffset: 100
      });
      marker.bindTooltip(site.label, { direction: 'top', offset: [0, -16] });
      marker.on('click', () => selectFloodReference(site.id));
      marker.on('keydown', event => {
        if (event.originalEvent.key !== 'Enter' && event.originalEvent.key !== ' ') return;
        event.originalEvent.preventDefault();
        event.originalEvent.stopPropagation();
        selectFloodReference(site.id);
      });
      marker.on('add', () => marker.getElement().setAttribute('aria-label', `Select ${site.label} study area`));
      return marker;
    }));
  }
  state.flood.referenceLayer.addTo(state.map);
  updateFloodReferenceDetails();
}

function setupFloodControls() {
  document.getElementById('flood-cancel-btn').addEventListener('click', () => {
    cancelPreviousFloodRun();
    ++state.flood.requestId;
    clearTimeout(state.flood.timer);
    if (state.flood.data) state.flood.data.status = 'cancelled';
    document.getElementById('flood-cancel-btn').hidden = true;
    document.getElementById('flood-selection-status').textContent = 'Analysis cancelled. Adjust the region or dates and analyze again.';
    document.getElementById('flood-metrics-status').textContent = 'Analysis cancelled';
    setGeeLoading(false);
  });
  const references = document.getElementById('flood-reference-select');
  references.innerHTML = '<option value="">Choose a reference location</option>'
    + FLOOD_REFERENCES.map((site, index) => `<option value="${site.id}">${index + 1}. ${site.label}</option>`).join('');
  references.addEventListener('change', event => selectFloodReference(event.target.value));
  const start = document.getElementById('flood-start-date');
  const end = document.getElementById('flood-end-date');
  const today = new Date();
  const earlier = new Date(today);
  earlier.setUTCDate(earlier.getUTCDate() - 90);
  start.value = earlier.toISOString().slice(0, 10);
  end.value = today.toISOString().slice(0, 10);
  start.max = end.max = end.value;
  document.getElementById('flood-date-form').addEventListener('submit', event => {
    event.preventDefault();
    const error = document.getElementById('flood-date-error');
    error.hidden = true;
    start.setAttribute('aria-invalid', 'false');
    end.setAttribute('aria-invalid', 'false');
    let message = '';
    let field = end;
    if (!start.value) { message = 'Enter a start date.'; field = start; }
    else if (!end.value) message = 'Enter an end date.';
    else if (start.value >= end.value) message = 'End date must be after start date.';
    else if (end.value < '2025-07-30') message = 'NISAR launched in July 2025. Choose a period after launch; there are no 2024 NISAR observations.';
    else if (end.value > new Date().toISOString().slice(0, 10)) message = 'End date cannot be in the future.';
    if (message) {
      error.textContent = message;
      error.hidden = false;
      field.setAttribute('aria-invalid', 'true');
      field.focus();
      return;
    }
    if (!state.flood.bbox) {
      error.textContent = 'Draw a region on the map or choose a reference location before starting flood analysis.';
      error.hidden = false;
      document.getElementById('draw-region-btn').focus();
      return;
    }
    fetchFloodAnalysis(state.flood.bbox, start.value, end.value);
  });
}

function getFloodClientId() {
  if (state.flood.clientId) return state.flood.clientId;
  let saved;
  try { saved = window.sessionStorage?.getItem('flood-client-id'); } catch {}
  const clientId = saved || `flood_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  state.flood.clientId = clientId;
  try { window.sessionStorage?.setItem('flood-client-id', clientId); } catch {}
  return clientId;
}

function cancelPreviousFloodRun() {
  const previous = state.flood.data;
  if (!previous?.region || previous.status !== 'running') return;
  fetch('/api/flood/cancel', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: getFloodClientId(), region_name: previous.region })
  }).catch(error => console.warn('Could not cancel the previous NISAR run:', error.message));
}

function setFloodProgress(progress = {}, elapsedSeconds) {
  const completed = progress.completed || 0;
  const total = progress.total || 0;
  setGeeLoading(true, progress.message || 'Searching NISAR observations…', completed, total);
  document.getElementById('gee-progress-label').textContent = total ? `${completed} / ${total} acquisitions · ${progress.stage}` : 'NISAR · ' + (progress.stage || 'searching');
  if (Number.isFinite(elapsedSeconds)) document.getElementById('gee-progress-label').textContent += ` · ${elapsedSeconds}s elapsed`;
}

function showFloodError(message) {
  document.getElementById('flood-cancel-btn').hidden = true;
  if (state.flood.data) Object.assign(state.flood.data, { error: message, status: 'error' });
  if (state.activeMission !== 'flood') return;
  document.getElementById('flood-metrics-status').textContent = 'NISAR flood analysis unavailable';
  document.getElementById('flood-selection-status').textContent = 'Analysis failed. Adjust the region or dates and try again.';
  setGeeLoading(false, message, 0, 0, true);
  document.getElementById('gee-progress-label').textContent = 'NISAR · analysis stopped';
}

async function fetchFloodAnalysis(bbox, startDate, endDate) {
  const requestId = ++state.flood.requestId;
  clearTimeout(state.flood.timer);
  globalThis.SarImageEffects?.clear();
  state.imageRenderId++;
  stopPlayback();
  state.currentFrameIndex = 0;
  state.isComparing = false;
  document.getElementById('compare-btn').classList.remove('active');
  document.getElementById('compare-btn').setAttribute('aria-pressed', 'false');
  if (state.activeOverlay) { state.map.removeLayer(state.activeOverlay); state.activeOverlay = null; }
  state.flood.bbox = bbox;
  state.flood.data = { mission: 'flood', source: 'NISAR_L2_GCOV', bbox,
    start_date: startDate, end_date: endDate, status: 'running', metrics_ready: false, acquisition_series: [] };
  updateFloodUI(state.flood.data);
  setFloodProgress();
  try {
    const response = await fetch('/api/flood/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbox, start_date: startDate, end_date: endDate, region_name: 'custom_roi', client_id: getFloodClientId() })
    });
    const data = await response.json();
    if (requestId !== state.flood.requestId) return;
    if (!response.ok) throw new Error(data.error || 'NISAR analysis could not start. Run the app with server.py.');
    if (data.source !== 'NISAR_L2_GCOV' || !data.region || data.metrics_ready !== false
        || data.start_date !== startDate || data.end_date !== endDate
        || JSON.stringify(data.bbox) !== JSON.stringify(bbox)) throw new Error('NISAR returned a mismatched analysis. Restart server.py and retry.');
    state.flood.data = data;
    if (state.activeMission === 'flood') {
      updateFloodUI(data);
      await pollFloodAnalysis(data.region, requestId);
    }
  } catch (error) {
    if (requestId === state.flood.requestId) showFloodError(error.message);
  }
}

async function pollFloodAnalysis(region, requestId = state.flood.requestId) {
  if (state.activeMission !== 'flood' || requestId !== state.flood.requestId || state.flood.data?.region !== region) return;
  try {
    const response = await fetch(`/api/analyze/status?region_name=${encodeURIComponent(region)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to retrieve NISAR flood analysis.');
    const status = await response.json();
    if (state.activeMission !== 'flood' || requestId !== state.flood.requestId || state.flood.data?.region !== region) return;
    if (status.region !== region) throw new Error('NISAR returned results for another region.');
    if (status.status === 'cancelled') {
      state.flood.data.status = 'cancelled';
      document.getElementById('flood-cancel-btn').hidden = true;
      document.getElementById('flood-selection-status').textContent = 'This run was cancelled or replaced by a newer analysis.';
      document.getElementById('flood-metrics-status').textContent = 'Analysis cancelled';
      setGeeLoading(false);
      return;
    }
    if (status.status === 'error') throw new Error(status.error || 'NISAR processing failed.');
    if (status.status === 'complete') {
      const metrics = status.metrics;
      const selection = state.flood.data;
      const rows = metrics?.acquisition_series;
      if (!status.metrics_ready || !metrics?.metrics_ready || metrics.source !== 'NISAR_L2_GCOV'
          || metrics.region !== region || JSON.stringify(metrics.bbox) !== JSON.stringify(state.flood.bbox)
          || metrics.start_date !== selection.start_date || metrics.end_date !== selection.end_date
          || !Array.isArray(rows) || rows.length < 2 || !metrics.method
          || rows.some((row, index) => !/^\d{4}-\d{2}-\d{2}$/.test(row.date)
            || row.date < selection.start_date || row.date > selection.end_date
            || (index > 0 && row.date <= rows[index-1].date)
            || !Number.isFinite(row.flood_area_km2) || !Number.isFinite(row.water_area_km2))) {
        throw new Error('NISAR flood measurements do not match the selected region and dates.');
      }
      state.flood.data = metrics;
      updateFloodUI(metrics);
      setGeeLoading(false);
      return;
    }
    state.flood.data.progress = status.progress;
    setFloodProgress(status.progress || {}, status.elapsed_seconds);
    clearTimeout(state.flood.timer);
    state.flood.timer = setTimeout(() => pollFloodAnalysis(region, requestId), 2500);
  } catch (error) {
    if (requestId === state.flood.requestId && state.flood.data?.region === region) showFloodError(error.message);
  }
}

function updateFloodUI(data) {
  const measured = data.metrics_ready === true;
  const rows = data.acquisition_series || [];
  document.getElementById('flood-cancel-btn').hidden = measured || data.status !== 'running';
  document.getElementById('flood-cancel-btn').disabled = !data.region;
  document.getElementById('flood-kpi-section').hidden = false;
  document.getElementById('kpi-section').hidden = true;
  document.getElementById('sidebar-title').textContent = state.flood.name || 'Flood detection & tracking';
  document.getElementById('sidebar-region').textContent = 'NISAR L-band · selected region';
  document.getElementById('sidebar-timeframe').textContent = `${data.start_date} → ${data.end_date}`;
  document.getElementById('flood-metrics-status').textContent = measured ? 'NISAR GCOV · Radar-derived new open water' : 'Waiting for NISAR observations';
  document.getElementById('flood-area-badge').textContent = measured ? formatMeasurement(data.analyzed_land_area_km2) : '—';
  document.getElementById('flood-baseline').textContent = measured ? formatMeasurement(data.baseline_water_km2) : '—';
  document.getElementById('flood-baseline-date').textContent = measured ? data.baseline_date : 'First acquisition';
  document.getElementById('flood-peak').textContent = measured ? formatMeasurement(data.peak_flood_km2) : '—';
  document.getElementById('flood-peak-date').textContent = measured ? data.peak_flood_date : 'Awaiting analysis';
  document.getElementById('flood-latest').textContent = measured ? formatMeasurement(data.latest_flood_km2) : '—';
  document.getElementById('flood-latest-date').textContent = measured ? rows.at(-1).date : 'Awaiting analysis';
  document.getElementById('flood-count').textContent = measured ? rows.length.toLocaleString() : '—';
  document.getElementById('flood-track').textContent = measured ? `Track ${data.track}${data.direction} · frame ${data.frame}` : 'Track pending';
  document.getElementById('flood-selection-status').textContent = measured ? `${rows.length} acquisitions ready. Use the timeline to track changes.` : 'NISAR analysis is running. Reading radar data for the selected region.';
  document.getElementById('flood-coverage-note').textContent = measured
    ? `${formatMeasurement(data.analyzed_land_area_km2)} of common valid land analyzed. ${formatMeasurement(data.affected_area_km2)} showed new water on at least one date. Only the selected frame and pixels observed on every date are included.` : '';
  document.getElementById('flood-downloads').hidden = !measured;
  if (measured) {
    for (const [id, key] of [['flood-csv-download', 'csv'], ['flood-tiff-download', 'geotiff'], ['flood-duration-download', 'duration']]) {
      const anchor = document.getElementById(id);
      // Export URLs must stay within this run's public directory.
      const url = data.downloads?.[key];
      const safe = typeof url === 'string' && url.startsWith(`/public/data/${data.region}/`) && !url.includes('..');
      anchor.hidden = !safe;
      if (safe) anchor.href = url;
    }
  }
  const maxArea = Math.max(1, ...rows.map(row => row.flood_area_km2));
  document.getElementById('flood-chart-bars').innerHTML = measured ? rows.map((row, index) => `
    <button type="button" class="chart-bar-col" aria-label="${row.date}: ${row.flood_area_km2} km² new open water" title="${row.date}: ${row.flood_area_km2} km²" onclick="jumpToFrame(${index})">
      <span class="chart-bar-fill" style="height:${row.flood_area_km2 / maxArea * 100}%;min-height:${row.flood_area_km2 > 0 ? 3 : 0}px"></span>
      <span class="chart-bar-label">${row.date.slice(5)}</span>
    </button>`).join('') : '';
  state.activeFrames = measured ? rows.map((row, index) => ({ id: index,
    label: `${row.date} · ${formatMeasurement(row.flood_area_km2)} new open water`,
    startDate: row.date, endDate: row.date, image: row.image_url, bounds: row.bounds,
    flood_area_km2: row.flood_area_km2 })) : [];
  state.currentFrameIndex = Math.max(0, Math.min(state.currentFrameIndex, state.activeFrames.length - 1));
  document.getElementById('bottom-dock').hidden = !measured;
  const slider = document.getElementById('timeline-slider');
  slider.min = 0;
  slider.max = Math.max(0, state.activeFrames.length - 1);
  slider.value = state.currentFrameIndex;
  document.getElementById('timeline-ticks').innerHTML = measured ? rows.map(row => `<span class="timeline-tick-label">${row.date.slice(5)}</span>`).join('') : '';
  document.getElementById('flood-chart-active').textContent = measured ? 'km²' : 'Awaiting measurements';
  renderActiveFrame();
}

/* ==========================================================================
   MISSION SWITCHER
   ========================================================================== */
function switchMission(missionKey) {
  if (!Object.hasOwn(MISSION_METADATA, missionKey)) return;
  state.activeMission = missionKey;
  document.getElementById('workspace-sensor').textContent = missionKey === 'flood' ? 'NISAR L-band SAR'
    : missionKey === 'deforestation' ? 'Sentinel-1 SAR' : 'Earth observation';
  state.imageRenderId++;
  if (missionKey !== 'deforestation' && state.imageView === 'simple') state.imageView = 'enhanced';
  updateImageViewControls();
  stopPlayback();
  state.currentFrameIndex = 0;
  state.isComparing = false;
  document.getElementById('compare-btn').classList.remove('active');
  document.getElementById('compare-btn').setAttribute('aria-pressed', 'false');

  clearInterval(state.geePollTimer);
  state.geePollTimer = null;
  if (missionKey !== 'deforestation') setGeeLoading(false);

  clearTimeout(state.flood.timer);
  state.flood.timer = null;
  if (state.activeOverlay) { state.map.removeLayer(state.activeOverlay); state.activeOverlay = null; }
  if (state.boundsRect) state.map.removeLayer(state.boundsRect);
  if (state.roiAnchorMarker) state.map.removeLayer(state.roiAnchorMarker);
  if (missionKey === 'flood') { state.imageView = 'original'; updateImageViewControls(); }
  document.getElementById('flood-date-form').hidden = missionKey !== 'flood';
  document.getElementById('forest-source-controls').hidden = missionKey !== 'deforestation';
  document.getElementById('forest-analysis-form').hidden = missionKey !== 'deforestation';
  document.getElementById('flood-reference-controls').hidden = missionKey !== 'flood';
  updateFloodReferenceMarkers();
  document.getElementById('flood-kpi-section').hidden = missionKey !== 'flood' || !state.flood.data;
  document.getElementById('region-instructions').textContent = missionKey === 'flood'
    ? 'Draw a region or choose a reference location, then set the dates for NISAR flood tracking.'
    : 'Search for a location, then draw the area you want to analyze.';
  document.getElementById('metrics-method').textContent = missionKey === 'flood'
    ? 'HH < −15 dB and HV < −24 dB after 4 × 4 averaging. New water is compared with the first available acquisition. Estimates have not been independently validated.'
    : 'Forest measurements will appear after satellite processing completes.';

  // Navigation Pill State
  document.querySelectorAll('.mission-btn').forEach(btn => {
    const isActive = btn.dataset.mission === missionKey;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive);
  });

  const hasForestRegion = missionKey === 'deforestation' && state.activeRoiData !== null;
  document.getElementById('region-section').hidden = missionKey === 'global';
  document.getElementById('kpi-section').hidden = !hasForestRegion;
  document.getElementById('bottom-dock').hidden = missionKey === 'global'
    || (missionKey === 'deforestation' && !hasForestRegion);
  if (missionKey === 'deforestation' && !hasForestRegion) {
    state.activeFrames = [];
    if (state.activeOverlay) {
      state.map.removeLayer(state.activeOverlay);
      state.activeOverlay = null;
    }
    setGeeLoading(false);
  }

  // Update Mission Sidebar Text
  const meta = MISSION_METADATA[missionKey];
  if (meta) {
    document.getElementById('sidebar-title').textContent = meta.title;
    document.getElementById('sidebar-region').textContent = meta.region;
    document.getElementById('sidebar-sensor').textContent = meta.sensor;
    document.getElementById('sidebar-timeframe').textContent = meta.timeframe;
    document.getElementById('sidebar-desc').textContent = meta.description;

  }

  if (missionKey === 'deforestation' && state.activeRoiData) {
    document.getElementById('sidebar-title').textContent = state.activeRoiName;
    document.getElementById('sidebar-region').textContent = `Sentinel-1 radar · ${state.activeRoiData.year || 2025}`;
    drawSelectedRegion(state.activeRoiBBox);
    updateDeforestationUI(state.activeRoiData, state.activeRoiBBox);
    if (state.activeRoiData.region) pollGeneratedFrames(state.activeRoiData.region);
    if (state.activeRoiData.error) showAnalysisError(state.activeRoiData.error);
    const [west, south, east, north] = state.activeRoiBBox;
    state.map.flyToBounds([[south, west], [north, east]], mapFocusOptions());
  }

  if (missionKey === 'deforestation') updateForestSourceControls();
  if (missionKey === 'deforestation' && !state.activeRoiData && state.activeRoiBBox) {
    drawSelectedRegion(state.activeRoiBBox);
    document.getElementById('sidebar-title').textContent = state.activeRoiName;
  }

  // Handle Global View
  if (missionKey === 'global') {
    if (state.activeOverlay) state.map.removeLayer(state.activeOverlay);
    if (state.boundsRect) state.map.removeLayer(state.boundsRect);
    if (state.roiAnchorMarker) state.map.removeLayer(state.roiAnchorMarker);
    state.map.flyTo([18, 0], 2.5, { duration: 2 });
    return;
  }

  if (missionKey === 'flood') {
    state.activeFrames = [];
    document.getElementById('bottom-dock').hidden = true;
    setGeeLoading(false);
    if (state.flood.bbox) drawSelectedRegion(state.flood.bbox);
    else state.map.flyTo([15, 20], 2.5, { duration: 1.2 });
    if (state.flood.name) {
      document.getElementById('sidebar-title').textContent = state.flood.name;
      document.getElementById('sidebar-region').textContent = state.flood.referenceId
        ? 'NISAR L-band · reference study area' : 'NISAR L-band · selected region';
    }
    if (state.flood.data) {
      updateFloodUI(state.flood.data);
      if (state.flood.data.error) showFloodError(state.flood.data.error);
      else if (state.flood.data.region && !state.flood.data.metrics_ready) pollFloodAnalysis(state.flood.data.region);
    }
  }
}

/* ==========================================================================
   FRAME RENDERING & IMAGE OVERLAY
   ========================================================================== */
function renderActiveFrame() {
  const renderId = ++state.imageRenderId;
  const frames = state.activeFrames;
  if (!frames || !frames.length) return;

  const frame = frames[state.currentFrameIndex];
  if (!frame) return;

  // Update UI Text
  document.getElementById('event-title').textContent = frame.label;
  document.getElementById('date-badge').textContent = `${frame.startDate} → ${frame.endDate}`;
  document.getElementById('timeline-slider').value = state.currentFrameIndex;

  // Update chart active bar
  document.querySelectorAll(state.activeMission === 'flood' ? '#flood-chart-bars .chart-bar-col' : '#chart-bars .chart-bar-col').forEach((bar, i) => {
    bar.classList.toggle('active', i === state.currentFrameIndex);
  });

  const chartVal = document.getElementById('chart-active-val');
  if (chartVal && Number.isFinite(frame.loss_speed)) {
    chartVal.textContent = `${frame.startDate.substring(0, frame.loss_unit === 'km² / interval' ? 10 : 7)}: ${frame.loss_speed} ${frame.loss_unit || 'km²/mo'}`;
  }

  if (state.activeMission === 'flood' && Number.isFinite(frame.flood_area_km2)) {
    document.getElementById('flood-chart-active').textContent = `${frame.startDate}: ${formatMeasurement(frame.flood_area_km2)}`;
  }

  // Update tick active states
  document.querySelectorAll('.timeline-tick-label').forEach((tick, i) => {
    tick.classList.toggle('active', i === state.currentFrameIndex);
  });

  const imgUrl = frame.resolvedImage || frame.image;

  // Remove existing overlay
  if (state.activeOverlay) {
    state.map.removeLayer(state.activeOverlay);
    state.activeOverlay = null;
  }

  // Render Image Overlay
  if (imgUrl && frame.bounds) {
    state.activeOverlay = L.imageOverlay(imgUrl, frame.bounds, {
      opacity: state.overlayOpacity,
      interactive: false,
      crossOrigin: true
    }).addTo(state.map);
    if (state.imageView !== 'original') {
      const overlay = state.activeOverlay;
      const mode = state.imageView;
      const effects = globalThis.SarImageEffects;
      document.getElementById('image-view-note').textContent = 'Preparing the clearer image…';
      const processed = effects ? effects.render(imgUrl, mode) : Promise.reject(new Error('Image processing is unavailable.'));
      processed.then(url => {
        if (renderId !== state.imageRenderId || overlay !== state.activeOverlay) return;
        overlay.setUrl(url);
        document.getElementById('image-view-note').textContent = IMAGE_VIEW_NOTES[mode];
      }).catch(error => {
        if (renderId !== state.imageRenderId || overlay !== state.activeOverlay) return;
        state.imageView = 'original';
        updateImageViewControls();
        document.getElementById('image-view-note').textContent = 'Enhancement unavailable for this image. Showing original radar.';
        console.warn('Radar image enhancement failed:', error);
      });
    }
  }
}

/* ==========================================================================
   PLAYBACK ENGINE
   ========================================================================== */
function togglePlayback() {
  if (state.isPlaying) {
    stopPlayback();
  } else {
    startPlayback();
  }
}

function startPlayback() {
  if (!state.activeFrames.length || state.activeMission === 'global') return;
  state.isPlaying = true;
  document.getElementById('play-btn').setAttribute('aria-label', 'Pause timelapse');
  document.getElementById('play-btn-icon').innerHTML = `
    <rect x="6" y="4" width="4" height="16" fill="currentColor" />
    <rect x="14" y="4" width="4" height="16" fill="currentColor" />
  `;

  state.playTimer = setInterval(() => {
    const frames = state.activeFrames;
    if (state.currentFrameIndex >= frames.length - 1) {
      state.currentFrameIndex = 0;
    } else {
      state.currentFrameIndex++;
    }
    renderActiveFrame();
  }, state.playbackSpeed);
}

function stopPlayback() {
  state.isPlaying = false;
  document.getElementById('play-btn').setAttribute('aria-label', 'Play timelapse');
  if (state.playTimer) {
    clearInterval(state.playTimer);
    state.playTimer = null;
  }
  const playIcon = document.getElementById('play-btn-icon');
  if (playIcon) {
    playIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3" fill="currentColor"></polygon>`;
  }
}

function stepFrame(delta) {
  stopPlayback();
  const frames = state.activeFrames;
  if (!frames.length || state.activeMission === 'global') return;
  let next = state.currentFrameIndex + delta;
  if (next < 0) next = frames.length - 1;
  if (next >= frames.length) next = 0;
  state.currentFrameIndex = next;
  renderActiveFrame();
}

function jumpToFrame(index) {
  stopPlayback();
  state.currentFrameIndex = index;
  renderActiveFrame();
}

/* ==========================================================================
   A/B BASELINE COMPARISON
   ========================================================================== */
function toggleCompare() {
  if (!state.activeFrames.length || state.activeMission === 'global') return;
  state.isComparing = !state.isComparing;
  const btn = document.getElementById('compare-btn');
  btn.classList.toggle('active', state.isComparing);
  btn.setAttribute('aria-pressed', String(state.isComparing));

  if (state.isComparing) {
    state.savedFrameIndex = state.currentFrameIndex;
    state.currentFrameIndex = 0;
    renderActiveFrame();
    document.getElementById('event-title').textContent = "Baseline · " + document.getElementById('event-title').textContent;
  } else {
    state.currentFrameIndex = state.savedFrameIndex || 0;
    renderActiveFrame();
  }
}

/* ==========================================================================
   EVENT LISTENERS & CONTROLS
   ========================================================================== */
function setupEventListeners() {
  setupForestControls();
  setupFloodControls();
  document.getElementById('image-view-select').addEventListener('change', event => {
    setImageView(event.target.value);
  });
  // Mission Selector Buttons
  document.querySelectorAll('.mission-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchMission(btn.dataset.mission);
    });
  });

  // Timeline Slider
  const slider = document.getElementById('timeline-slider');
  slider.addEventListener('input', (e) => {
    stopPlayback();
    state.currentFrameIndex = parseInt(e.target.value, 10);
    renderActiveFrame();
  });

  // Playback Controls
  document.getElementById('play-btn').addEventListener('click', togglePlayback);
  document.getElementById('step-prev-btn').addEventListener('click', () => stepFrame(-1));
  document.getElementById('step-next-btn').addEventListener('click', () => stepFrame(1));
  document.getElementById('compare-btn').addEventListener('click', toggleCompare);

  // Speed Selector
  document.getElementById('speed-select').addEventListener('change', (e) => {
    state.playbackSpeed = parseInt(e.target.value, 10);
    if (state.isPlaying) {
      stopPlayback();
      startPlayback();
    }
  });

  // Opacity Slider
  const opacitySlider = document.getElementById('opacity-slider');
  const opacityVal = document.getElementById('opacity-val');
  opacitySlider.addEventListener('input', (e) => {
    state.overlayOpacity = parseFloat(e.target.value);
    opacityVal.textContent = `${Math.round(state.overlayOpacity * 100)}%`;
    if (state.activeOverlay) {
      state.activeOverlay.setOpacity(state.overlayOpacity);
    }
  });

  // Basemap Dropdown
  const basemapToggle = document.getElementById('basemap-toggle-btn');
  const basemapMenu = document.getElementById('basemap-menu');
  basemapToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    basemapMenu.classList.toggle('open');
    basemapToggle.setAttribute('aria-expanded', String(basemapMenu.classList.contains('open')));
  });

  document.addEventListener('click', () => {
    basemapMenu.classList.remove('open');
    basemapToggle.setAttribute('aria-expanded', 'false');
  });

  document.querySelectorAll('.basemap-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      const key = opt.dataset.basemap;
      if (state.baseMaps[key] && key !== state.baseMapKey) {
        state.map.removeLayer(state.baseMaps[state.baseMapKey]);
        state.baseMaps[key].addTo(state.map);
        state.baseMapKey = key;

        document.querySelectorAll('.basemap-opt').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        opt.classList.add('active');
        opt.setAttribute('aria-pressed', 'true');

        if (state.activeOverlay) state.activeOverlay.bringToFront();
      }
    });
  });

  // Sidebar Toggle
  const sidebar = document.getElementById('mission-sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle-btn');
  const sidebarClose = document.getElementById('sidebar-close-btn');

  sidebarToggle.addEventListener('click', () => {
    setSidebarVisible(sidebar.classList.contains('collapsed'));
  });

  sidebarClose.addEventListener('click', () => {
    setSidebarVisible(false);
    sidebarToggle.focus();
  });

  window.matchMedia('(max-width: 820px)').addEventListener('change', event => {
    setSidebarVisible(!event.matches);
  });

  // Modal / About Dialog
  const modal = document.getElementById('about-modal');
  let helpReturnFocus;
  function closeHelp() {
    modal.classList.remove('open');
    modal.inert = true;
    helpReturnFocus?.focus();
  }
  function openHelp() {
    helpReturnFocus = document.activeElement;
    modal.inert = false;
    modal.classList.add('open');
    document.getElementById('modal-close-btn').focus();
  }
  document.getElementById('about-btn').addEventListener('click', openHelp);
  document.getElementById('modal-close-btn').addEventListener('click', closeHelp);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeHelp();
  });

  // Fullscreen Button
  document.getElementById('fullscreen-btn').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // Keyboard Shortcuts (S: Square Tool, Space: Play/Pause, Arrows: Step frames, etc.)
  window.addEventListener('keydown', (e) => {
    if (modal.classList.contains('open')) {
      if (e.code === 'Escape') closeHelp();
      else if (e.code === 'Tab') {
        e.preventDefault();
        document.getElementById('modal-close-btn').focus();
      }
      return;
    }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) {
      if (e.code === 'Escape') {
        e.target.blur();
        document.getElementById('search-results').style.display = 'none';
      }
      return;
    }

    if (e.key === '?') {
      e.preventDefault();
      openHelp();
      return;
    }
    if ((e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'ArrowLeft') && e.target.closest('button, summary')) return;

    if (e.code === 'KeyS') {
      e.preventDefault();
      document.getElementById('square-select-btn').click();
    } else if (e.code === 'Space') {
      e.preventDefault();
      togglePlayback();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      stepFrame(1);
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      stepFrame(-1);
    } else if (e.code === 'KeyB') {
      e.preventDefault();
      toggleCompare();
    } else if (e.code === 'KeyI') {
      e.preventDefault();
      sidebarToggle.click();
    } else if (e.code === 'KeyF') {
      e.preventDefault();
      document.getElementById('fullscreen-btn').click();
    } else if (e.code === 'Slash') {
      e.preventDefault();
      document.getElementById('search-input').focus();
    } else if (e.code === 'Escape') {
      basemapMenu.classList.remove('open');
      basemapToggle.setAttribute('aria-expanded', 'false');
      document.getElementById('search-results').style.display = 'none';
      if (state.isDrawingSquare) {
        document.getElementById('cancel-drawing-btn').click();
      }
    }
  });
}

/* ==========================================================================
   GLOBAL SEARCH / GEOCODER (OpenStreetMap Nominatim)
   ========================================================================== */
function setupSearch() {
  const searchInput = document.getElementById('search-input');
  const resultsContainer = document.getElementById('search-results');
  let debounceTimeout = null;

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(debounceTimeout);

    if (query.length < 2) {
      resultsContainer.style.display = 'none';
      resultsContainer.innerHTML = '';
      return;
    }

    debounceTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
        if (!res.ok) return;
        const data = await res.json();

        if (!data || !data.length) {
          resultsContainer.style.display = 'none';
          return;
        }

        resultsContainer.innerHTML = data.map(item => `
          <div class="search-item" data-lat="${item.lat}" data-lon="${item.lon}">
            <strong>${item.display_name.split(',')[0]}</strong>
            <span style="font-size: 10px; color: var(--ink-dim); display: block;">${item.display_name}</span>
          </div>
        `).join('');

        resultsContainer.style.display = 'flex';

        resultsContainer.querySelectorAll('.search-item').forEach(item => {
          item.addEventListener('click', () => {
            const lat = parseFloat(item.dataset.lat);
            const lon = parseFloat(item.dataset.lon);
            state.map.flyTo([lat, lon], 12, { duration: 2 });
            resultsContainer.style.display = 'none';
            searchInput.value = item.querySelector('strong').textContent;
          });
        });
      } catch (err) {
        console.warn('Search lookup failed:', err);
      }
    }, 350);
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
      resultsContainer.style.display = 'none';
    }
  });
}
