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
    - **Custom regions only**: The map starts without a selected area or an automatic analysis. Search for a location and draw a bounding box to begin.
    - **Monthly Dissipation Speed Chart**: Interactive bar chart displaying monthly tree cover loss speed across the year.
  - 🌀 **Florida Hurricane Inundation (Tampa Bay, USA)**: Sept–Oct 2024 sequence tracking storm surge and urban flooding across Hurricanes Helene and Milton.
  - 🌍 **Global View**: Interactive world overview without preset region markers.

- **Time Machine & Playback Engine**:
  - Interactive timeline scrubber with timestamp markers.
  - Play / Pause timelapse with adjustable playback speeds (0.5x, 1x, 2x).
  - Keyboard shortcuts: `Spacebar` for play/pause, `Left` / `Right` arrow keys to step frames.
  - **A/B Baseline Comparison**: Flip instantaneously between the current observation frame and the pre-storm/initial baseline to inspect environmental changes.

- **Spectral Interpretation & Radar Analysis**:
  - **Optional public-friendly image effects** under Display settings → Image view: Original radar, Enhanced radar (speckle softening and contrast), and Simple colors (a plain-language color guide for forest radar composites).
  - Effects run locally in the browser, apply across the timeline and comparison view, and never change the source images or measured statistics. Simplified colors group rendered radar patterns; they are not a land-cover classification. Original radar is always available.
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
Create the project environment and install the Earth Engine pipeline dependencies once:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Launch the included zero-dependency Python server:

```bash
.venv/bin/python server.py
```

Then open your browser to:
[http://localhost:8000/public/index.html](http://localhost:8000/public/index.html) (or simply [http://localhost:8000/](http://localhost:8000/))

Forest statistics now come from the same Sentinel-1 Earth Engine run as the radar images.
The cards show “Awaiting analysis” until the run finishes; failures remain visible and never
fall back to simulated coverage or seasonal loss rates. Restart `server.py` after updating.
Earth Engine must already be authenticated and configured with an enabled project; background
requests do not open an interactive login prompt.

The current method thresholds monthly median VH backscatter at −15.5 dB and sums classified
pixel areas at an 80 m analysis scale. These are radar-derived forest-cover estimates, not a
validated land-cover classification or proof of illegal logging. Changes in moisture and other
surface conditions can affect the estimates. Region area shown while waiting is calculated
from the selection rectangle, not from a forest classification.

Run the data-flow regression checks without making Earth Engine requests:

```bash
.venv/bin/python -B -m unittest discover -s tests -v
node tests/satellite-ui.test.cjs
node tests/image-effects.test.cjs
```

### Option 2: Python Built-in HTTP Server
```bash
python3 -m http.server 8000
```
Navigate to `http://localhost:8000/public/index.html`.
This serves the map interface only; new satellite analysis requires `server.py`.

### Option 3: Direct Browser File Access
Direct file access does not support satellite analysis. Use the development server above;
the embedded manifest is only a fallback for browsing existing imagery.

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
