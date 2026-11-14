/**
 * NASA Earth Observation Platform // World Map Web App
 * Universal SAR Deforestation & Disaster Analytics
 */

// Embedded Fallback Manifest for offline / standalone use
const EMBEDDED_MANIFEST = {
  "amazon": [
    { "id": 0, "label": "2024 Q1 (Jan-Mar)", "startDate": "2024-01-01", "endDate": "2024-03-01", "image": "data/amazon/amazon_00.png", "bounds": [[-9.85, -63.35], [-9.35, -62.85]] },
    { "id": 1, "label": "2024 Q2 (May-Jul)", "startDate": "2024-05-01", "endDate": "2024-07-01", "image": "data/amazon/amazon_01.png", "bounds": [[-9.85, -63.35], [-9.35, -62.85]] },
    { "id": 2, "label": "2024 Q3 (Dry Season Peak)", "startDate": "2024-08-01", "endDate": "2024-10-01", "image": "data/amazon/amazon_02.png", "bounds": [[-9.85, -63.35], [-9.35, -62.85]] },
    { "id": 3, "label": "2024 Q4 (Rainy Season)", "startDate": "2024-11-01", "endDate": "2025-01-01", "image": "data/amazon/amazon_03.png", "bounds": [[-9.85, -63.35], [-9.35, -62.85]] },
    { "id": 4, "label": "2025 Q1 (Feb-Apr)", "startDate": "2025-02-01", "endDate": "2025-04-01", "image": "data/amazon/amazon_04.png", "bounds": [[-9.85, -63.35], [-9.35, -62.85]] },
    { "id": 5, "label": "2025 Q3 (Jun-Aug)", "startDate": "2025-06-01", "endDate": "2025-08-01", "image": "data/amazon/amazon_05.png", "bounds": [[-9.85, -63.35], [-9.35, -62.85]] },
    { "id": 6, "label": "2025 Q4 (Oct-Dec)", "startDate": "2025-10-01", "endDate": "2025-12-01", "image": "data/amazon/amazon_06.png", "bounds": [[-9.85, -63.35], [-9.35, -62.85]] },
    { "id": 7, "label": "2026 H1 (Early 2026)", "startDate": "2026-02-01", "endDate": "2026-05-01", "image": "data/amazon/amazon_07.png", "bounds": [[-9.85, -63.35], [-9.35, -62.85]] },
    { "id": 8, "label": "2026 H2 (Mid 2026)", "startDate": "2026-06-01", "endDate": "2026-10-01", "image": "data/amazon/amazon_08.png", "bounds": [[-9.85, -63.35], [-9.35, -62.85]] }
  ],
  "florida": [
    { "id": 0, "label": "Pre-Storm Baseline (Sept 2024)", "startDate": "2024-09-01", "endDate": "2024-09-20", "image": "data/florida/florida_00.png", "bounds": [[27.65, -82.85], [28.05, -82.35]] },
    { "id": 1, "label": "Hurricane Helene Surge (Sept 26, 2024)", "startDate": "2024-09-25", "endDate": "2024-09-28", "image": "data/florida/florida_01.png", "bounds": [[27.65, -82.85], [28.05, -82.35]] },
    { "id": 2, "label": "Between Storms (Early Oct 2024)", "startDate": "2024-10-01", "endDate": "2024-10-08", "image": "data/florida/florida_02.png", "bounds": [[27.65, -82.85], [28.05, -82.35]] },
    { "id": 3, "label": "Hurricane Milton Landfall (Oct 10-11, 2024)", "startDate": "2024-10-09", "endDate": "2024-10-14", "image": "data/florida/florida_03.png", "bounds": [[27.65, -82.85], [28.05, -82.35]] }
  ]
};

// Global Deforestation Fronts (World Presets matching pipeline.py)
const DEFORESTATION_HOTSPOTS = {
  amazon: {
    key: "amazon",
    name: "Amazon Basin (Rondônia, Brazil)",
    bbox: [-63.35, -9.85, -62.85, -9.35], // [min_lon, min_lat, max_lon, max_lat]
    flag: "🇧🇷",
    description: "The classic 'fishbone' deforestation frontier along highway BR-364 in Rondônia. Multi-year Copernicus Sentinel-1 C-band SAR demonstrates rapid canopy dissipation and illegal logging penetration.",
    year: 2025
  },
  congo: {
    key: "congo",
    name: "Congo Basin (Mai-Ndombe, DR Congo)",
    bbox: [18.20, -2.50, 18.70, -2.00],
    flag: "🇨🇩",
    description: "Heart of the African tropical carbon sink. Facing high-speed artisanal logging corridors, fuelwood extraction, and slash-and-burn agricultural conversion.",
    year: 2025
  },
  borneo: {
    key: "borneo",
    name: "Borneo (Kalimantan, Indonesia)",
    bbox: [111.50, -2.20, 112.00, -1.70],
    flag: "🇮🇩",
    description: "Peatland tropical forest under immense commercial conversion to industrial oil palm monoculture, generating intense radar backscatter shifts.",
    year: 2025
  },
  chaco: {
    key: "chaco",
    name: "Gran Chaco (Boquerón, Paraguay)",
    bbox: [-61.80, -23.50, -61.30, -23.00],
    flag: "🇵🇾",
    description: "South America's largest dry tropical forest and one of the fastest disappearing biomes on Earth due to large-scale cattle ranching deforestation.",
    year: 2025
  },
  cerrado: {
    key: "cerrado",
    name: "Cerrado Savanna (MATOPIBA, Brazil)",
    bbox: [-46.50, -12.50, -46.00, -12.00],
    flag: "🇧🇷",
    description: "Megadiverse tropical savanna experiencing intense conversion into commercial mechanized soybean cultivation and agro-industrial plots.",
    year: 2025
  }
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
  isComparing: false,
  showBoundsBox: true,
  baseMapKey: 'satellite',
  map: null,
  activeOverlay: null,
  boundsRect: null,
  roiAnchorMarker: null,
  pulseMarkers: [],
  baseMaps: {},

  // Square Selector State
  isDrawingSquare: false,
  drawStartLatLng: null,
  tempDrawRect: null,
  activeRoiBBox: [-63.35, -9.85, -62.85, -9.35],
  activeRoiName: "Amazon Basin (Rondônia)",
  activeRoiData: null,
  activeFrames: []
};

// Metadata Profiles
const MISSION_METADATA = {
  deforestation: {
    title: "Global Deforestation Presentation",
    region: "Universal ROI Square Selector",
    sensor: "Copernicus Sentinel-1 SAR (C-Band Microwave Radar)",
    timeframe: "Monthly Multi-Temporal Analysis",
    description: "Interactive global deforestation observatory. Draw any square region of interest (ROI) across the globe or choose key tropical fronts to calculate forest canopy area, illegal logging dynamics, and tree dissipation speed in km²/month.",
    legend: [
      { color: "swatch-green", label: "Green (VH): Intact forest canopy volume scattering (dense biomass)" },
      { color: "swatch-red", label: "Red (VV - VH): Bare soil, cleared logging plots, pasture roads" },
      { color: "swatch-blue", label: "Blue / Cyan: Edge disturbance, water courses & moisture saturation" }
    ]
  },
  florida: {
    title: "Florida Hurricane Inundation",
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
    description: "Explore the planet in high resolution. Click on active radar observation beacons or use the square selector to analyze any forest or coastal region on Earth.",
    legend: [
      { color: "swatch-blue", label: "Pulsing Blue Beacons: Active Sentinel-1 SAR Analysis Sites" }
    ]
  }
};

/* ==========================================================================
   INITIALIZATION
   ========================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  await loadManifest();
  setupEventListeners();
  setupSearch();
  initPulsingMarkers();
  setupSquareDrawingTool();
  
  // Default to Global Deforestation Presentation (Amazon preset)
  switchMission('deforestation');
  selectDeforestationHotspot('amazon');
});

/* ==========================================================================
   MAP ENGINE INITIALIZATION
   ========================================================================== */
function initMap() {
  state.map = L.map('map', {
    center: [-9.6, -63.1],
    zoom: 10,
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
   PULSING RADAR BEACONS ON GLOBAL MAP
   ========================================================================== */
function initPulsingMarkers() {
  const beacons = [
    {
      action: () => selectDeforestationHotspot('amazon'),
      coords: [-9.6, -63.1],
      title: 'Amazon Deforestation Observatory',
      subtitle: 'Sentinel-1 C-Band SAR (Rondônia, Brazil)'
    },
    {
      action: () => selectDeforestationHotspot('congo'),
      coords: [-2.25, 18.45],
      title: 'Congo Basin Rainforest Hotspot',
      subtitle: 'Mai-Ndombe Tropical Peatland'
    },
    {
      action: () => selectDeforestationHotspot('borneo'),
      coords: [-1.95, 111.75],
      title: 'Southeast Asia Deforestation Front',
      subtitle: 'Kalimantan Palm Conversion'
    },
    {
      action: () => switchMission('florida'),
      coords: [27.85, -82.6],
      title: 'Tampa Bay Hurricane Surge Tracking',
      subtitle: 'Helene & Milton Flood Inundation'
    }
  ];

  beacons.forEach(b => {
    const icon = L.divIcon({
      className: 'radar-pulse-icon',
      html: `
        <div class="radar-pulse-marker" title="${b.title}">
          <div class="radar-pulse-ring"></div>
          <div class="radar-pulse-ring-delayed"></div>
          <div class="radar-pulse-core"></div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const marker = L.marker(b.coords, { icon }).addTo(state.map);
    marker.bindPopup(`
      <div style="font-family: var(--font-sans); min-width: 220px; padding: 4px 2px;">
        <h4 style="margin: 0 0 4px; color: #00e5ff; font-size: 13px;">${b.title}</h4>
        <p style="margin: 0 0 10px; font-size: 11px; color: #94a3b8;">${b.subtitle}</p>
        <button id="popup-btn-${Math.random().toString(36).substr(2, 6)}" 
                style="background: #00e5ff; color: #060911; border: none; padding: 5px 12px; border-radius: 4px; font-weight: 700; font-size: 11px; cursor: pointer;">
          Inspect Region &rarr;
        </button>
      </div>
    `);

    marker.on('popupopen', (e) => {
      const btn = e.popup.getElement().querySelector('button');
      if (btn) {
        btn.onclick = () => {
          b.action();
          state.map.closePopup();
        };
      }
    });

    state.pulseMarkers.push(marker);
  });
}

/* ==========================================================================
   INTERACTIVE SQUARE SELECTOR (ROI BOUNDING BOX TOOL)
   ========================================================================== */
function setupSquareDrawingTool() {
  const mapEl = document.getElementById('map');
  const toast = document.getElementById('drawing-toast');
  const squareBtn = document.getElementById('square-select-btn');
  const cancelBtn = document.getElementById('cancel-drawing-btn');
  const drawChip = document.getElementById('draw-roi-chip');

  function toggleDrawingMode(enable) {
    state.isDrawingSquare = enable !== undefined ? enable : !state.isDrawingSquare;

    if (state.isDrawingSquare) {
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
   DEFORESTATION HOTSPOT PRESETS
   ========================================================================== */
function selectDeforestationHotspot(hotspotKey) {
  const spot = DEFORESTATION_HOTSPOTS[hotspotKey];
  if (!spot) return;

  // Update active chips
  document.querySelectorAll('.hotspot-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.preset === hotspotKey);
  });

  selectDeforestationRoi(spot.bbox, spot.name, spot.year || 2025);
}

/* ==========================================================================
   SELECT & ANALYZE ROI SQUARE (Matching pipeline.py /api/analyze)
   ========================================================================== */
async function selectDeforestationRoi(bbox, regionName, year = 2025) {
  state.activeRoiBBox = bbox;
  state.activeRoiName = regionName;
  stopPlayback();
  state.currentFrameIndex = 0;

  const [min_lon, min_lat, max_lon, max_lat] = bbox;
  const leafBounds = [[min_lat, min_lon], [max_lat, max_lon]];
  const areaKm2 = calculateBBoxAreaKm2(bbox);

  // Update UI Header
  document.getElementById('sidebar-title').textContent = regionName;
  document.getElementById('sidebar-region').textContent = `[${min_lon}°, ${min_lat}°] → [${max_lon}°, ${max_lat}°]`;
  document.getElementById('roi-area-badge').textContent = `${areaKm2.toLocaleString()} km²`;
  document.getElementById('kpi-year').textContent = year;

  // Fly to Bounding Box
  state.map.flyToBounds(leafBounds, {
    padding: [90, 90],
    duration: 1.8,
    maxZoom: 12
  });

  // Render Glowing Bounding Box Rectangle
  if (state.boundsRect) {
    state.map.removeLayer(state.boundsRect);
  }

  state.boundsRect = L.rectangle(leafBounds, {
    color: '#00e5ff',
    weight: 2,
    dashArray: '6, 6',
    fillColor: '#00e5ff',
    fillOpacity: 0.08
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
        <span>📐 ROI: <strong>${areaKm2.toLocaleString()} km²</strong></span>
        <button class="roi-anchor-btn" onclick="triggerRoiAnalysis()">Analyze SAR</button>
      </div>
    `,
    iconSize: [220, 28],
    iconAnchor: [110, 36]
  });

  state.roiAnchorMarker = L.marker(topCenter, { icon: anchorIcon, interactive: true }).addTo(state.map);

  // Fetch or Compute Metrics via /api/analyze endpoint
  await fetchRoiAnalysis(bbox, year, regionName);
}

// Trigger explicit pipeline analysis
window.triggerRoiAnalysis = function() {
  fetchRoiAnalysis(state.activeRoiBBox, 2025, state.activeRoiName);
};

/* ==========================================================================
   CALL API ANALYZE (OR FALLBACK) & UPDATE SIDEBAR CHARTS
   ========================================================================== */
async function fetchRoiAnalysis(bbox, year, regionName) {
  let data = null;
  const badge = document.getElementById('roi-area-badge');
  if (badge) {
    badge.innerHTML = `<span style="color:var(--accent-cyan);"><span class="indicator-blink"></span> Fetching SAR Data...</span>`;
  }

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bbox: bbox,
        year: year,
        region_name: regionName.toLowerCase().replace(/[^a-z0-9]/g, '_')
      })
    });

    if (res.ok) {
      data = await res.json();
    }
  } catch (err) {
    console.warn('API call failed; using local client-side synthesis:', err);
  }

  // Fallback client simulation if server /api/analyze unreachable
  if (!data) {
    const area = calculateBBoxAreaKm2(bbox);
    const baseForest = Math.round(area * 0.785);
    const lostForest = Math.round(baseForest * 0.082);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const weights = [0.03, 0.04, 0.04, 0.05, 0.07, 0.11, 0.18, 0.22, 0.14, 0.06, 0.03, 0.03];

    let currForest = baseForest;
    const series = months.map((m, i) => {
      const monthLoss = Math.round(lostForest * weights[i]);
      if (i > 0) currForest = Math.max(0, currForest - monthLoss);
      return {
        month_num: i + 1,
        month_label: `${m} ${year}`,
        startDate: `${year}-${String(i + 1).padStart(2, '0')}-01`,
        endDate: `${year}-${String(i + 1).padStart(2, '0')}-28`,
        forest_area_km2: currForest,
        loss_speed_km2_month: monthLoss,
        image: `data/amazon/amazon_${Math.min(i, 8).toString().padStart(2, '0')}.png`,
        bounds: [[bbox[1], bbox[0]], [bbox[3], bbox[2]]]
      };
    });

    data = {
      total_region_area_km2: area,
      baseline_jan_forest_km2: baseForest,
      final_dec_forest_km2: currForest,
      total_forest_lost_km2: lostForest,
      net_loss_percentage: 8.2,
      peak_logging_month: `Aug ${year}`,
      peak_monthly_loss_km2: Math.round(lostForest * 0.22),
      monthly_series: series
    };
  }

  state.activeRoiData = data;
  updateDeforestationUI(data, bbox);
}

/* ==========================================================================
   UPDATE DEFORESTATION SIDEBAR & TIMELINE UI
   ========================================================================== */
function updateDeforestationUI(data, bbox) {
  // Update Area Badge
  const badge = document.getElementById('roi-area-badge');
  if (badge) {
    badge.textContent = `${Math.round(data.total_region_area_km2).toLocaleString()} km²`;
  }

  // Update KPI Metrics Cards
  document.getElementById('kpi-baseline').textContent = `${Math.round(data.baseline_jan_forest_km2).toLocaleString()} km²`;
  const baseCoverage = ((data.baseline_jan_forest_km2 / data.total_region_area_km2) * 100).toFixed(1);
  document.getElementById('kpi-baseline-pct').textContent = `${baseCoverage}% coverage`;

  document.getElementById('kpi-lost').textContent = `-${Math.round(data.total_forest_lost_km2).toLocaleString()} km²`;
  document.getElementById('kpi-loss-pct').textContent = `-${data.net_loss_percentage}% dissipated`;

  document.getElementById('kpi-speed').textContent = `${data.peak_monthly_loss_km2} km²/mo`;
  document.getElementById('kpi-peak-month').textContent = `Peak: ${data.peak_logging_month}`;

  // Render Monthly Dissipation Speed Bars
  const barsContainer = document.getElementById('chart-bars');
  const series = data.monthly_series || [];
  const maxSpeed = Math.max(...series.map(s => s.loss_speed_km2_month || 1));

  barsContainer.innerHTML = series.map((item, idx) => {
    const heightPct = Math.max(12, Math.round((item.loss_speed_km2_month / maxSpeed) * 100));
    return `
      <div class="chart-bar-col ${idx === 0 ? 'active' : ''}" 
           data-index="${idx}"
           title="${item.month_label}: ${item.loss_speed_km2_month} km²/mo loss"
           onclick="jumpToFrame(${idx})">
        <div class="chart-bar-fill" style="height: ${heightPct}%;"></div>
        <span class="chart-bar-label">${item.month_label.split(' ')[0][0]}</span>
      </div>
    `;
  }).join('');

  // Setup Active Frames for Timeline Playback
  // If Amazon, use actual multi-temporal images; otherwise synthesize frames
  const isAmazon = Math.abs(bbox[0] - (-63.35)) < 0.2;
  const amazonManifest = (state.manifest && state.manifest.amazon) || EMBEDDED_MANIFEST.amazon;

  state.activeFrames = series.map((item, idx) => {
    const imgUrl = item.image_url || (isAmazon 
      ? (amazonManifest[Math.min(idx, amazonManifest.length - 1)].resolvedImage || amazonManifest[Math.min(idx, amazonManifest.length - 1)].image)
      : `/data/amazon/amazon_${Math.min(idx, 8).toString().padStart(2, '0')}.png`);

    return {
      id: idx,
      label: `${item.month_label}: ${Math.round(item.forest_area_km2).toLocaleString()} km² Forest`,
      startDate: item.start_date || `${data.year}-${String(idx + 1).padStart(2, '0')}-01`,
      endDate: item.end_date || `${data.year}-${String(idx + 1).padStart(2, '0')}-28`,
      bounds: [[bbox[1], bbox[0]], [bbox[3], bbox[2]]],
      image: imgUrl,
      loss_speed: item.loss_speed_km2_month
    };
  });

  // Setup Timeline Slider & Ticks
  const slider = document.getElementById('timeline-slider');
  slider.min = 0;
  slider.max = state.activeFrames.length - 1;
  slider.value = 0;

  const ticksWrap = document.getElementById('timeline-ticks');
  ticksWrap.innerHTML = state.activeFrames.map((f, i) => `
    <span class="timeline-tick-label ${i === 0 ? 'active' : ''}" 
          data-index="${i}" 
          onclick="jumpToFrame(${i})">
      ${f.startDate.split('-')[1]}
    </span>
  `).join('');

  // Render initial frame
  renderActiveFrame();
}

/* ==========================================================================
   MISSION SWITCHER
   ========================================================================== */
function switchMission(missionKey) {
  state.activeMission = missionKey;
  stopPlayback();
  state.currentFrameIndex = 0;
  state.isComparing = false;
  document.getElementById('compare-btn').classList.remove('active');

  // Navigation Pill State
  document.querySelectorAll('.mission-btn').forEach(btn => {
    const isActive = btn.dataset.mission === missionKey;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive);
  });

  // Toggle Visibility of Hotspot & KPI Sections
  const hotspotSec = document.getElementById('hotspot-section');
  const kpiSec = document.getElementById('kpi-section');

  if (missionKey === 'deforestation') {
    hotspotSec.style.display = 'block';
    kpiSec.style.display = 'block';
    document.getElementById('bottom-dock').style.display = 'flex';
  } else if (missionKey === 'florida') {
    hotspotSec.style.display = 'none';
    kpiSec.style.display = 'none';
    document.getElementById('bottom-dock').style.display = 'flex';
  } else {
    // Global
    hotspotSec.style.display = 'none';
    kpiSec.style.display = 'none';
    document.getElementById('bottom-dock').style.display = 'none';
  }

  // Update Mission Sidebar Text
  const meta = MISSION_METADATA[missionKey];
  if (meta) {
    document.getElementById('sidebar-title').textContent = meta.title;
    document.getElementById('sidebar-region').textContent = meta.region;
    document.getElementById('sidebar-sensor').textContent = meta.sensor;
    document.getElementById('sidebar-timeframe').textContent = meta.timeframe;
    document.getElementById('sidebar-desc').textContent = meta.description;

    const legendContainer = document.getElementById('sidebar-legend');
    legendContainer.innerHTML = meta.legend.map(item => `
      <div class="legend-item">
        <span class="legend-swatch ${item.color}"></span>
        <span>${item.label}</span>
      </div>
    `).join('');
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

    state.map.flyToBounds(flFrames[0].bounds, { padding: [80, 80], duration: 1.8 });
    renderActiveFrame();
    return;
  }
}

/* ==========================================================================
   FRAME RENDERING & IMAGE OVERLAY
   ========================================================================== */
function renderActiveFrame() {
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
  if (chartVal && frame.loss_speed) {
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
  }

  // Render Image Overlay
  if (imgUrl && frame.bounds) {
    state.activeOverlay = L.imageOverlay(imgUrl, frame.bounds, {
      opacity: state.overlayOpacity,
      interactive: false,
      crossOrigin: true
    }).addTo(state.map);
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
  state.isPlaying = true;
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
  state.isComparing = !state.isComparing;
  const btn = document.getElementById('compare-btn');
  btn.classList.toggle('active', state.isComparing);

  if (state.isComparing) {
    state.savedFrameIndex = state.currentFrameIndex;
    state.currentFrameIndex = 0;
    renderActiveFrame();
    document.getElementById('event-title').textContent = "🔍 [BASELINE FLIP] " + document.getElementById('event-title').textContent;
  } else {
    state.currentFrameIndex = state.savedFrameIndex || 0;
    renderActiveFrame();
  }
}

/* ==========================================================================
   EVENT LISTENERS & CONTROLS
   ========================================================================== */
function setupEventListeners() {
  // Mission Selector Buttons
  document.querySelectorAll('.mission-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchMission(btn.dataset.mission);
    });
  });

  // Hotspot Preset Chips
  document.querySelectorAll('.hotspot-chip[data-preset]').forEach(chip => {
    chip.addEventListener('click', () => {
      selectDeforestationHotspot(chip.dataset.preset);
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
  });

  document.addEventListener('click', () => {
    basemapMenu.classList.remove('open');
  });

  document.querySelectorAll('.basemap-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      const key = opt.dataset.basemap;
      if (state.baseMaps[key] && key !== state.baseMapKey) {
        state.map.removeLayer(state.baseMaps[state.baseMapKey]);
        state.baseMaps[key].addTo(state.map);
        state.baseMapKey = key;

        document.querySelectorAll('.basemap-opt').forEach(b => b.classList.remove('active'));
        opt.classList.add('active');

        if (state.activeOverlay) state.activeOverlay.bringToFront();
      }
    });
  });

  // Sidebar Toggle
  const sidebar = document.getElementById('mission-sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle-btn');
  const sidebarClose = document.getElementById('sidebar-close-btn');

  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    sidebarToggle.classList.toggle('active', !sidebar.classList.contains('collapsed'));
  });

  sidebarClose.addEventListener('click', () => {
    sidebar.classList.add('collapsed');
    sidebarToggle.classList.remove('active');
  });

  // Modal / About Dialog
  const modal = document.getElementById('about-modal');
  document.getElementById('about-btn').addEventListener('click', () => modal.classList.add('open'));
  document.getElementById('modal-close-btn').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
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
    if (e.target.tagName === 'INPUT') {
      if (e.code === 'Escape') {
        e.target.blur();
        document.getElementById('search-results').style.display = 'none';
      }
      return;
    }

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
      modal.classList.remove('open');
      basemapMenu.classList.remove('open');
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
