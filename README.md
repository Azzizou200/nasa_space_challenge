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
    - **SAR Change Detection**: Calculates selection area (km²), radar-derived baseline forest cover, monthly forest-cover change (km²/month), and peak monthly loss using [pipeline.py](pipeline.py).
    - **Custom regions only**: The map starts without a selected area or an automatic analysis. Search for a location and draw a bounding box to begin.
    - **Monthly Forest Loss Chart**: Interactive bar chart displaying changes in estimated forest cover across the year.
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
  - Integrated OpenStreetMap Nominatim search to fly to cities and landmarks on Earth.

---

## 🚀 Quick Start

### Option 1: Development Server (Recommended)
You need Python 3.10 or newer, a modern browser, internet access, and a Google account
with access to an Earth Engine enabled Google Cloud project. Node.js is only needed
for the JavaScript regression tests. The frontend uses plain HTML, CSS, and JavaScript;
there is no npm install or frontend build step.

Create the project environment and install the Earth Engine pipeline dependencies once:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Authenticate Earth Engine and set your project before starting the server. Replace
`YOUR_PROJECT_ID` with your Google Cloud project ID:

```bash
.venv/bin/earthengine authenticate
.venv/bin/earthengine set_project YOUR_PROJECT_ID
```

Launch the included Python server:

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

To use a different port, run `.venv/bin/python server.py 8080` and open
`http://localhost:8080/`. Map tiles, location search, and the Leaflet CDN also require
internet access.

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

These checks use mocked satellite responses; they do not validate live Earth Engine
access or the scientific accuracy of the forest-cover estimates.

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

## Using the App

1. Open **Forests**, search for a location, and choose a search result.
2. Click **Draw a region** (or press `S`), then drag a rectangle on the map. The
   browser currently requests the twelve months of **2025** for each selection.
3. Wait for the monthly radar images and measured statistics. Images can appear
   before processing finishes; forest statistics stay pending until the full run succeeds.
4. Use the timeline, playback controls, and **Compare baseline** to inspect changes.
   Open **Display settings → Image view** to change the radar display. **Simple colors**
   is available for the forest mission; hurricane imagery supports Original and Enhanced radar.
5. Switch to **Hurricanes** for the existing Florida sequence or **Explore** for the global view.

Keyboard shortcuts: `/` focuses search, `S` starts region selection, `Space` toggles
playback, `←` / `→` step dates, `B` toggles baseline comparison, `I` toggles analytics,
`F` toggles fullscreen, `?` opens help, and `Esc` cancels drawing or closes menus.

Each analysis writes monthly PNGs, `metrics.json`, and `metrics.csv` to its own
`public/data/<region>_<run-id>/` directory. Earlier runs remain on disk. Active job
status is held in memory, so after restarting the server, draw the region again to
start a new analysis. Existing output files are not automatically loaded as an active run.

If analysis fails, check the error shown in the app and the server terminal. Verify
Earth Engine authentication and the configured project using the same environment
and operating system account as the server. Every month must have Sentinel-1 observations
for the selected orbit; a missing month causes an explicit failure. A static file server
cannot handle the analysis API.

## Analysis API and Command Line

`POST /api/analyze` accepts JSON such as:

```json
{"bbox": [-63.35, -9.85, -62.85, -9.35], "year": 2025, "region_name": "custom_roi"}
```

Coordinates are `[west, south, east, north]` in degrees. Rectangles must have increasing
longitude and latitude and cannot cross the antimeridian. The API accepts years from
2014 through the current year, subject to observations being available for every month.
It returns HTTP `202` with a generated `region` identifier. Poll
`GET /api/analyze/status?region_name=<region>` for `running`, `complete`, or `error`;
completed responses include `metrics_ready: true`, measurements, and image URLs.

You can also run the pipeline directly for another year or output directory:

```bash
.venv/bin/python pipeline.py --bbox -63.35 -9.85 -62.85 -9.35 --year 2025 --name example --outdir public/data/example
```

---

## 📁 Project Structure

```
nasa_space_challenge/
├── index.html                  # Root forwarder
├── server.py                   # Lightweight local web server
├── pipeline.py                 # Earth Engine monthly radar and forest-cover analysis
├── requirements.txt            # Python pipeline dependencies
├── tests/                      # Python and Node.js regression checks
├── README.md                   # Project documentation
├── test.ipynb                  # Google Earth Engine data pipeline script
└── public/
    ├── index.html              # Main web application
    ├── style.css               # Responsive map workspace styling
    ├── app.js                  # Map engine, playback, and interactivity
    ├── image-effects.js        # Local radar display processing
    ├── assets/                 # Shared frontend assets
    └── data/
        ├── manifest.json       # Metadata & geographic bounding boxes
        ├── amazon/             # Sentinel-1 SAR frames (2024–2026)
        ├── florida/            # Sentinel-1 SAR hurricane frames (Sept–Oct 2024)
        └── <region>_<run-id>/  # Generated monthly PNGs and JSON/CSV measurements
```

---

## 📡 Data Attribution
- **Copernicus Sentinel-1 SAR**: European Space Agency (ESA) & European Commission
- **Data Processing**: Google Earth Engine API
- **Basemap Imagery**: Esri, CartoDB, OpenStreetMap, NASA EOSDIS GIBS
