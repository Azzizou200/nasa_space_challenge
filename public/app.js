/**
 * NASA Earth Observation Platform // World Map Web App
 * Universal SAR Deforestation & Disaster Analytics
 */

// Embedded Fallback Manifest for offline / standalone use
const EMBEDDED_MANIFEST = {
  "florida": [
    { "id": 0, "label": "Pre-Storm Baseline (Sept 2024)", "startDate": "2024-09-01", "endDate": "2024-09-20", "image": "data/florida/florida_00.png", "bounds": [[27.65, -82.85], [28.05, -82.35]] },
    { "id": 1, "label": "Hurricane Helene Surge (Sept 26, 2024)", "startDate": "2024-09-25", "endDate": "2024-09-28", "image": "data/florida/florida_01.png", "bounds": [[27.65, -82.85], [28.05, -82.35]] },
    { "id": 2, "label": "Between Storms (Early Oct 2024)", "startDate": "2024-10-01", "endDate": "2024-10-08", "image": "data/florida/florida_02.png", "bounds": [[27.65, -82.85], [28.05, -82.35]] },
    { "id": 3, "label": "Hurricane Milton Landfall (Oct 10-11, 2024)", "startDate": "2024-10-09", "endDate": "2024-10-14", "image": "data/florida/florida_03.png", "bounds": [[27.65, -82.85], [28.05, -82.35]] }
  ]
};

// Global App State
const state = {
  manifest: null,
  activeMission: 'deforestation', // 'deforestation' | 'florida' | 'global'
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
  select.value = state.imageView;
  document.getElementById('image-view-note').textContent = IMAGE_VIEW_NOTES[state.imageView];
  let legend = MISSION_METADATA[state.activeMission]?.legend || [];
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
  florida: {
    title: "Florida hurricanes",
    region: "Tampa Bay & Coastal Pinellas County, FL",
    sensor: "Copernicus Sentinel-1 SAR (C-Band Microwave Radar)",
    timeframe: "Sept - Oct 2024 (Helene & Milton Sequence)",
    description: "Radar backscatter mapping of historic dual-hurricane landfalls. Water acts as a specular reflector bouncing radar pulses away from the antenna, highlighting flooded urban streets, coastal surge, and emergency recovery intervals.",
    legend: [
      { color: "swatch-dark", label: "Dark / Black: Standing surge water & inland flood ponds (specular bounce)" },
      { color: "swatch-blue", label: "Cyan / Blue: Saturated soils & emergent wetland vegetation" },
      { color: "swatch-red", label: "Bright / White: Urban double-bounce structures & debris lines" }
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
      selectDeforestationRoi(drawnBbox, "Custom Bounding Box", 2025);
    }

    toggleDrawingMode(false);
  });
}

/* ==========================================================================
   SELECT & ANALYZE ROI SQUARE (Matching pipeline.py /api/analyze)
   ========================================================================== */
async function selectDeforestationRoi(bbox, regionName, year = 2025) {
  if (state.activeMission !== 'deforestation') switchMission('deforestation');
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
  document.getElementById('sidebar-region').textContent = `Sentinel-1 radar · ${year}`;
  document.getElementById('roi-area-badge').textContent = `${areaKm2.toLocaleString()} km²`;
  document.getElementById('kpi-year').textContent = year;

  // Fly to Bounding Box
  state.map.flyToBounds(leafBounds, mapFocusOptions());

  // Render Glowing Bounding Box Rectangle
  if (state.boundsRect) {
    state.map.removeLayer(state.boundsRect);
  }

  state.boundsRect = L.rectangle(leafBounds, {
    color: '#73e2cf',
    weight: 1.5,
    dashArray: '6, 6',
    fillColor: '#73e2cf',
    fillOpacity: 0.03
  }).addTo(state.map);

  // Render Floating Anchor Badge above rectangle
  if (state.roiAnchorMarker) {
    state.map.removeLayer(state.roiAnchorMarker);
  }

  const topCenter = L.latLng(max_lat, (min_lon + max_lon) / 2);
  const anchorIcon = L.divIcon({
    className: 'roi-anchor-div',
    html: `
      <div class="roi-anchor-badge">
        <span>Selected region · <strong>${areaKm2.toLocaleString()} km²</strong></span>
      </div>
    `,
    iconSize: [184, 30],
    iconAnchor: [92, 42]
  });

  state.roiAnchorMarker = L.marker(topCenter, { icon: anchorIcon, interactive: true }).addTo(state.map);

  // Fetch or Compute Metrics via /api/analyze endpoint
  await fetchRoiAnalysis(bbox, year, regionName);
}

// Trigger explicit pipeline analysis
window.triggerRoiAnalysis = function() {
  if (!state.activeRoiBBox) {
    document.getElementById('square-select-btn').click();
    return;
  }
  fetchRoiAnalysis(state.activeRoiBBox, 2025, state.activeRoiName);
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
  const series = data.monthly_series || [];
  document.getElementById('roi-area-badge').textContent = formatMeasurement(data.total_region_area_km2);
  document.getElementById('metrics-status').textContent = measured
    ? 'Sentinel-1 SAR · Radar-derived estimates'
    : data.error ? 'Satellite analysis unavailable' : 'Waiting for satellite measurements';
  document.getElementById('metrics-method').textContent = measured
    ? `Monthly median VH > ${data.method.vh_threshold_db} dB · ${data.method.scale_m} m analysis scale. Radar-derived forest-cover estimates, not a validated land-cover classification.`
    : 'Forest measurements will appear after satellite processing completes.';
  document.getElementById('kpi-baseline').textContent = measured ? formatMeasurement(data.baseline_jan_forest_km2) : '—';
  const area = data.total_region_area_km2;
  const baseline = data.baseline_jan_forest_km2;
  document.getElementById('kpi-baseline-pct').textContent = measured && area > 0 && Number.isFinite(baseline)
    ? `${(baseline / area * 100).toFixed(1)}% estimated coverage` : 'Awaiting analysis';

  const lost = data.total_forest_lost_km2;
  document.getElementById('kpi-lost').textContent = measured && Number.isFinite(lost)
    ? `${lost > 0 ? '−' : lost < 0 ? '+' : ''}${formatMeasurement(Math.abs(lost))}` : '—';
  const change = data.net_loss_percentage;
  document.getElementById('kpi-loss-pct').textContent = measured && Number.isFinite(change)
    ? `${Math.abs(change)}% ${change < 0 ? 'increase' : 'decrease'}`
    : measured ? 'No baseline forest to compare' : 'Awaiting analysis';
  document.getElementById('kpi-speed').textContent = measured ? formatMeasurement(data.peak_monthly_loss_km2, 'km²/mo') : '—';
  document.getElementById('kpi-peak-month').textContent = measured
    ? data.peak_logging_month ? `Peak: ${data.peak_logging_month}` : 'No monthly loss detected'
    : 'Awaiting analysis';
  document.getElementById('kpi-year').textContent = data.year;
  document.getElementById('kpi-pass').textContent = data.orbit_pass
    ? `${data.orbit_pass.toLowerCase()} pass` : 'Orbit pending';

  const maxSpeed = Math.max(1, ...series.map(item => item.loss_speed_km2_month || 0));
  document.getElementById('chart-bars').innerHTML = measured ? series.map((item, idx) => {
    const speed = item.loss_speed_km2_month;
    const height = Math.max(0, speed / maxSpeed * 100);
    return `
      <button type="button" class="chart-bar-col" data-index="${idx}"
        aria-label="${item.month_label}: ${speed} km² estimated forest-cover loss"
        title="${item.month_label}: ${speed} km²/mo" onclick="jumpToFrame(${idx})">
        <span class="chart-bar-fill" style="height:${height}%;min-height:${speed > 0 ? 3 : 0}px"></span>
        <span class="chart-bar-label">${item.month_label.split(' ')[0][0]}</span>
      </button>`;
  }).join('') : '';
  document.getElementById('chart-active-val').textContent = measured ? 'km² / month' : 'Awaiting measurements';

  // Preserve the selected date and any already-downloaded images as metrics arrive.
  const existingImages = new Map(state.activeFrames.map(frame => [frame.sourceImage, frame.image]));
  const frameRegionKey = data.region || regionNameKey(state.activeRoiName);
  state.activeFrames = series.map((item, idx) => {
    const sourceImage = item.image || `${frameRegionKey}_${data.year}_${String(idx + 1).padStart(2, '0')}.png`;
    return {
      id: idx,
      label: measured
        ? `${item.month_label} · ${formatMeasurement(item.forest_area_km2)} estimated forest`
        : `${item.month_label} · Satellite imagery`,
      startDate: item.start_date,
      endDate: item.end_date,
      bounds: [[bbox[1], bbox[0]], [bbox[3], bbox[2]]],
      image: item.image_url || existingImages.get(sourceImage) || null,
      sourceImage,
      loss_speed: measured ? item.loss_speed_km2_month : null
    };
  });
  state.currentFrameIndex = Math.max(0, Math.min(state.currentFrameIndex, state.activeFrames.length - 1));
  const slider = document.getElementById('timeline-slider');
  slider.min = 0;
  slider.max = Math.max(0, state.activeFrames.length - 1);
  slider.value = state.currentFrameIndex;
  document.getElementById('timeline-ticks').innerHTML = state.activeFrames.map(frame =>
    `<span class="timeline-tick-label">${frame.startDate.split('-')[1]}</span>`
  ).join('');
  renderActiveFrame();
}

function regionNameKey(name) {
  return String(name || 'custom_roi').toLowerCase().replace(/[^a-z0-9]/g, '_');
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
  setGeeLoading(false, message, state.activeFrames.filter(frame => frame.image).length, 12, true);
}

function scheduleAnalysisPoll(regionKey, requestId) {
  clearTimeout(state.geePollTimer);
  state.geePollTimer = setTimeout(() => pollGeneratedFrames(regionKey, requestId), 2500);
}

async function pollGeneratedFrames(regionKey, requestId = state.analysisRequestId) {
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

/* ==========================================================================
   MISSION SWITCHER
   ========================================================================== */
function switchMission(missionKey) {
  state.activeMission = missionKey;
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

  // Navigation Pill State
  document.querySelectorAll('.mission-btn').forEach(btn => {
    const isActive = btn.dataset.mission === missionKey;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive);
  });

  const hasForestRegion = missionKey === 'deforestation' && state.activeRoiData !== null;
  document.getElementById('region-section').hidden = missionKey !== 'deforestation';
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
    if (state.boundsRect) state.boundsRect.addTo(state.map);
    if (state.roiAnchorMarker) state.roiAnchorMarker.addTo(state.map);
    updateDeforestationUI(state.activeRoiData, state.activeRoiBBox);
    if (state.activeRoiData.region) pollGeneratedFrames(state.activeRoiData.region);
    if (state.activeRoiData.error) showAnalysisError(state.activeRoiData.error);
    const [west, south, east, north] = state.activeRoiBBox;
    state.map.flyToBounds([[south, west], [north, east]], mapFocusOptions());
  }

  // Handle Global View
  if (missionKey === 'global') {
    if (state.activeOverlay) state.map.removeLayer(state.activeOverlay);
    if (state.boundsRect) state.map.removeLayer(state.boundsRect);
    if (state.roiAnchorMarker) state.map.removeLayer(state.roiAnchorMarker);
    state.map.flyTo([18, 0], 2.5, { duration: 2 });
    return;
  }

  // Handle Florida Hurricane Mission
  if (missionKey === 'florida') {
    if (state.roiAnchorMarker) state.map.removeLayer(state.roiAnchorMarker);
    if (state.boundsRect) state.map.removeLayer(state.boundsRect);
    const flFrames = (state.manifest && state.manifest.florida) || EMBEDDED_MANIFEST.florida;
    state.activeFrames = flFrames;

    const slider = document.getElementById('timeline-slider');
    slider.min = 0;
    slider.max = flFrames.length - 1;
    slider.value = 0;

    const ticksWrap = document.getElementById('timeline-ticks');
    ticksWrap.innerHTML = flFrames.map((f, i) => `
      <span class="timeline-tick-label ${i === 0 ? 'active' : ''}" 
            data-index="${i}" 
            onclick="jumpToFrame(${i})">
        ${f.label.split(' ')[0]}
      </span>
    `).join('');

    state.map.flyToBounds(flFrames[0].bounds, mapFocusOptions());
    renderActiveFrame();
    return;
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
  document.querySelectorAll('.chart-bar-col').forEach((bar, i) => {
    bar.classList.toggle('active', i === state.currentFrameIndex);
  });

  const chartVal = document.getElementById('chart-active-val');
  if (chartVal && Number.isFinite(frame.loss_speed)) {
    chartVal.textContent = `${frame.startDate.substring(0, 7)}: ${frame.loss_speed} km²/mo`;
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
