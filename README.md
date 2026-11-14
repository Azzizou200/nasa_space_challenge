# AERO-WATCH // NASA Space Apps Earth Observation Platform

An interactive, high-performance world map application designed for monitoring Earth observation data, environmental dynamics, and disaster response using multi-temporal **Sentinel-1 Synthetic Aperture Radar (SAR)** imagery.

---

## 🌍 Key Features

- **Full-Screen Interactive World Map**:
  - Smooth pan, continuous zoom, and dynamic camera fly-to animations.
  - Multi-basemap engine:
    - 🛰️ High-Resolution Satellite (Esri World Imagery)
    - 🌑 Tactical Dark Matter (CartoDB Dark)
    - ☀️ Clean Positron Light (CartoDB Light)
    - 🗺️ OpenStreetMap with detailed cartographic boundaries
    - 🌌 NASA VIIRS Night Lights (Earth at Night)
  - Real-time telemetry HUD displaying cursor Latitude, Longitude, and current zoom level.

- **Featured Observatories & Datasets**:
  - 🌲 **Global Deforestation Presentation & ROI Square Selector**:
    - **Interactive Square Selector**: Click the Square tool (or press `[S]`) and drag anywhere on the globe to draw a custom bounding box `[min_lon, min_lat, max_lon, max_lat]`.
    - **Universal SAR Change Detection**: Dynamically calculates geodetic area (km²), baseline canopy cover, illegal logging dissipation speeds (km²/month), and peak logging intervals based on [pipeline.py](file:///home/azzizou/Work/nasa_space_challenge/pipeline.py).
    - **Global Deforestation Hotspot Presets**: One-click jump to major fronts:
      - 🇧🇷 **Amazon Basin** (Rondônia, Brazil): Multi-year Sentinel-1 SAR sequence (2024–2026).
      - 🇨🇩 **Congo Basin** (Mai-Ndombe, DR Congo): Africa's primary tropical carbon sink.
      - 🇮🇩 **Southeast Asia** (Kalimantan, Borneo): Peatland forest palm conversion.
      - 🇵🇾 **Gran Chaco** (Boquerón, Paraguay): Rapid dry forest clearing.
      - 🇧🇷 **Cerrado Savanna** (MATOPIBA, Brazil): Agricultural expansion frontier.
    - **Monthly Dissipation Speed Chart**: Interactive bar chart displaying monthly tree cover loss speed across the year.
  - 🌀 **Florida Hurricane Inundation (Tampa Bay, USA)**: Sept–Oct 2024 sequence tracking storm surge and urban flooding across Hurricanes Helene and Milton.
  - 🌍 **Global View**: Interactive world overview with pulsing radar beacons marking active observation sites.

- **Time Machine & Playback Engine**:
  - Interactive timeline scrubber with timestamp markers.
  - Play / Pause timelapse with adjustable playback speeds (0.5x, 1x, 2x).
  - Keyboard shortcuts: `Spacebar` for play/pause, `Left` / `Right` arrow keys to step frames.
  - **A/B Baseline Comparison**: Flip instantaneously between the current observation frame and the pre-storm/initial baseline to inspect environmental changes.

- **Spectral Interpretation & Radar Analysis**:
  - Opacity slider to cross-fade radar overlays with the underlying satellite basemap.
  - Spectral false-color legend explaining radar polarizations:
    - Red (VV): Bare soil, infrastructure, cleared plots
    - Green (VH): Dense forest canopy and volume scattering
    - Blue/Cyan: Vegetation disturbance / saturated surface moisture
    - Dark/Black: Calm water / flood surge specular reflection

- **Global Geocoder**:
  - Integrated OpenStreetMap Nominatim search to instantly fly to any city, coordinate, or landmark on Earth.

---

## 🚀 Quick Start

### Option 1: Development Server (Recommended)
Launch the included zero-dependency Python server:

```bash
python3 server.py
```

Then open your browser to:
[http://localhost:8000/public/index.html](http://localhost:8000/public/index.html) (or simply [http://localhost:8000/](http://localhost:8000/))

### Option 2: Python Built-in HTTP Server
```bash
python3 -m http.server 8000
```
Navigate to `http://localhost:8000/public/index.html`.

### Option 3: Direct Browser File Access
Open [public/index.html](file:///home/azzizou/Work/nasa_space_challenge/public/index.html) directly in any modern browser (Chrome, Firefox, Safari, Edge). The application includes an embedded fallback manifest so it works even without a local web server!

---

## 📁 Project Structure

```
nasa_space_challenge/
├── index.html                  # Root forwarder
├── server.py                   # Lightweight local web server
├── README.md                   # Project documentation
├── test.ipynb                  # Google Earth Engine data pipeline script
└── public/
    ├── index.html              # Main web application
    ├── style.css               # NASA/tactical dark glassmorphism styling
    ├── app.js                  # Map engine, playback, and interactivity
    └── data/
        ├── manifest.json       # Metadata & geographic bounding boxes
        ├── amazon/             # Sentinel-1 SAR frames (2024–2026)
        └── florida/            # Sentinel-1 SAR hurricane frames (Sept–Oct 2024)
```

---

## 📡 Data Attribution
- **Copernicus Sentinel-1 SAR**: European Space Agency (ESA) & European Commission
- **Data Processing**: Google Earth Engine API
- **Basemap Imagery**: Esri, CartoDB, OpenStreetMap, NASA EOSDIS GIBS
