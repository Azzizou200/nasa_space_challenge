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
    - **Forest data source**: Choose Sentinel-1 C-band (monthly 2025 analysis) or NISAR L-band (actual acquisition dates with a selectable period and HV threshold).
    - **Ready-made examples**: Open saved analyses for Amazon/Rondônia, Congo/Mai-Ndombe, or Borneo/Central Kalimantan with either forest source. Each includes measured statistics and timeline imagery.
    - **Custom regions**: The map starts without a selected area or an automatic analysis. Choose an example, or search for a location and draw a bounding box to begin.
    - **Monthly Forest Loss Chart**: Interactive bar chart displaying changes in estimated forest cover across the year.
  - **NISAR Flood Detection & Tracking**: Draw any region, enter start and end dates,
    and analyze a chronological NISAR L2 GCOV HH/HV stack. Track baseline water,
    peak and latest new open water, and individual acquisition dates. Download
    measured CSV data, a flood GeoTIFF, and a flood-duration GeoTIFF.
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
You need Python 3.10 or newer, a modern browser, and internet access. Sentinel-1 forest
analysis needs a Google account with access to an Earth Engine enabled Google Cloud
project. NISAR forest and flood analysis use NASA Earthdata credentials instead (see below). Node.js is only needed
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
Direct file access does not support satellite analysis. Use the development server above
for both forest and flood analysis. Archived images remain in `public/data/`.

---

## Using the App

1. Open **Forests** and choose a **Forest data source**. Open a **Ready-made example** for immediate results, or search for a location and choose a search result to analyze a custom region.
2. Click **Draw a region** (or press `S`), then drag a rectangle on the map. The
   browser currently requests the twelve months of **2025** for each Sentinel-1 selection.
   For NISAR, drawing only selects the region: set the dates and threshold, then click **Analyze forest**.
3. Wait for the monthly radar images and measured statistics. Images can appear
   before processing finishes; forest statistics stay pending until the full run succeeds.
4. Use the timeline, playback controls, and **Compare baseline** to inspect changes.
   Open **Display settings → Image view** to change the radar display. **Simple colors**
   is available for the forest mission. Flood maps preserve their classification colors.
5. Switch to **Floods** for NISAR flood tracking or **Explore** for the global view.

Keyboard shortcuts: `/` focuses search, `S` starts region selection, `Space` toggles
playback, `←` / `→` step dates, `B` toggles baseline comparison, `I` toggles analytics,
`F` toggles fullscreen, `?` opens help, and `Esc` cancels drawing or closes menus.

Each analysis writes monthly PNGs, `metrics.json`, and `metrics.csv` to its own
`public/data/<region>_<run-id>/` directory. Earlier runs remain on disk. Active job
status is held in memory, so after restarting the server, draw the region again to
start a new analysis. Existing output files are not automatically loaded as an active run.
The curated forest examples can be opened directly without an active background job.

If analysis fails, check the error shown in the app and the server terminal. Verify
Earth Engine authentication and the configured project using the same environment
and operating system account as the server. Every month must have Sentinel-1 observations
for the selected orbit; a missing month causes an explicit failure. A static file server
cannot handle the analysis API.

## Ready-Made Forest Examples

Each forest source offers three saved examples in the **Ready-made examples** selector:

| Example | Region | Sentinel-1 period | NISAR period |
| --- | --- | --- | --- |
| Amazon | Rondônia, Brazil | January–December 2025 | September–October 2026 |
| Congo | Mai-Ndombe, DR Congo | January–December 2025 | September–October 2026 |
| Borneo | Central Kalimantan, Indonesia | January–December 2025 | September–October 2026 |

The examples use the same compact rectangles with both sources, so it is easy to
inspect the two radar views. Their periods differ; they are not a simultaneous
sensor comparison. Each Sentinel-1 example has twelve monthly observations. NISAR
examples use real matching acquisition dates and the exploratory −13 dB HV threshold.
Both sources retain their method limitations.

Choosing an example moves the map, selects its rectangle, fills the appropriate
settings, and loads its saved images and measured statistics. It does not submit a
new analysis or require satellite-service login. **Analyze forest** reruns the
selected settings through the live pipeline. Choosing a different source or drawing
a custom region clears the example selection. Examples remain available after server
restarts, and their status is labeled **Saved example**.

`public/forest-examples.js` lists the six snapshots and their run directories in
`public/data/`. To regenerate them with current pipeline code, authenticate the server
for both Earth Engine and Earthdata, start `server.py`, then run:

```bash
.venv/bin/python -B scripts/build_forest_examples.py
```

Use `--base-url http://127.0.0.1:8011` for a different server port. The builder checks
that all six analyses, image files, and NISAR masks completed before replacing the
catalog. Previous outputs are retained.

## NISAR Forest Observations

In **Forests → Forest data source**, choose **NISAR · L-band**. Draw a region, select
start and end dates, and click **Analyze forest**. Date defaults cover the last 90 days.
The source selector does not start downloads. Sentinel-1 remains available from the
same selector; switching sources clears the prior displayed results. Forest and flood
selections and workers remain independent.

NISAR forest analysis uses the same NASA Earthdata login, GCOV collection fallback,
region-only streaming, matching HH/HV grids, and isolated worker limits as flood
analysis. It needs at least two acquisition dates after NISAR's July 2025 launch.
Only land with valid HH and HV on every selected date contributes to measured areas.

The forest option is an **exploratory vegetation-cover proxy**, not an official NISAR
forest-disturbance product or a validated land-cover classification. It averages 4 × 4
pixels in linear power, converts to dB, and estimates vegetation cover using
**HV gamma0 > the selected threshold**. The adjustable **−13 dB** starting value needs
regional calibration. The [NISAR Science Users' Handbook](https://nisar.jpl.nasa.gov/documents/26/NISAR_FINAL_9-6-19.pdf)
discusses HV threshold masks and cites −13 dB for earlier ALOS experiments; that is
not a calibrated threshold for the gamma0 GCOV data used here. The
[ASF GCOV guide](https://nisar-docs.asf.alaska.edu/gcov/) describes GCOV normalization
and its real HH/HV covariance terms. Moisture, season, vegetation type, and other
surface changes affect this proxy, and it must not be interpreted as confirmed logging.

The cards show baseline vegetation, net vegetation loss (or gain), peak loss between
acquisitions, and observation count. Loss intervals are irregular and **are not monthly
rates**. The chart and timeline use actual acquisition dates; the image legend uses
HH/HV rather than Sentinel-1 VV/VH. Image enhancements remain display-only.

Each run writes `forest_<date>.png`, `metrics.json`, `metrics.csv`, and `forest.tif` in
`public/data/forest_<region>_<run-id>/`. The CSV includes date, estimated cover area,
nonnegative interval loss, and signed interval net change (positive means gain).
The GeoTIFF has one vegetation-mask band per date (1 above threshold, 0 below,
255 outside common valid land), on the native multilooked projected grid.
The browser provides CSV/GeoTIFF download links and **Cancel analysis**. Starting
another NISAR forest run cancels the previous forest run for that browser; it does not
cancel its flood job. Earth Engine is not required for this source.

`POST /api/forest/nisar/analyze` accepts:

```json
{"bbox": [-63.35, -9.85, -62.85, -9.35], "start_date": "2026-08-01", "end_date": "2026-11-01", "hv_threshold_db": -13, "region_name": "custom_roi", "client_id": "forest_browser_session"}
```

It returns HTTP `202` with `mission: "forest"`, `source: "NISAR_L2_GCOV"`,
`hv_threshold_db`, and a unique `region`. Poll the shared
`GET /api/analyze/status?region_name=<region>` endpoint. Completed `metrics` contain
`acquisition_series`, the selected method, common analyzed land area, and download
URLs. `POST /api/nisar/cancel` accepts `client_id` and optional `region_name`.
The existing `/api/flood/cancel` endpoint remains supported.

## NISAR Flood Tracking

The **Floods** tab adapts the supplied `nisar_flood_pipeline.ipynb` flood method.
The forest tab continues to use the Sentinel-1 pipeline; the Amazon notebook is a
separate forest study.

Install the updated `requirements.txt` in the project environment and restart the server.
NISAR downloads use NASA Earthdata credentials, separately from Google Earth Engine.
Configure `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`, or `EARTHDATA_TOKEN`, in the
server environment. Alternatively, create a persistent login from a terminal:

```bash
.venv/bin/python -c 'import earthaccess; earthaccess.login(strategy="interactive", persist=True)'
.venv/bin/python server.py
```

The server uses environment credentials or `.netrc` without interactive prompts. Keep
credentials outside the repository. See the [earthaccess authentication guide](https://earthaccess.readthedocs.io/en/stable/user/howto/authenticate/).

1. Open **Floods**, search for the area, and click **Draw a region** or press `S`.
   You can also choose **Flood reference locations** or click a numbered map marker:
   **Limpopo / Chókwè** (Mozambique), **Jamuna / Sirajganj** (Bangladesh),
   **Indus / Sukkur** (Pakistan), **Mekong / Phnom Penh** (Cambodia), and
   **Mississippi / Vicksburg** (USA). Each selects a compact study rectangle and
   includes a link to NASA's flood history for that area. Your date inputs stay
   unchanged, and selection does not start downloads. Reference markers appear
   only in Floods; drawing a custom region clears the reference selection.
2. Enter **Start date** and **End date**, then click **Analyze floods**. Both dates
   are included in the search; the end date must follow the start and cannot be in the future.
   The default period is the last 90 days. Changing dates does not start downloads
   until you click **Analyze floods** again.
3. Follow authentication, search, region reading, processing, and export progress. At least two acquisitions
   from one track/direction/frame/mode are required. The search tries validated,
   provisional, then beta GCOV releases, without mixing them, using the collection
   names in the [NISAR data access guide](https://nisar-docs.asf.alaska.edu/earthaccess/).
4. Play or scrub actual acquisition dates and compare against the first observation.
   Red means new open water; blue means other detected water; gray is HH radar backscatter.
   The CSV and GeoTIFF download links appear after processing completes.

Reference locations identify historically flood-prone river areas. The linked
historical events may predate NISAR and do not guarantee NISAR observations or
flooding in the period you select. Choose dates covered by NISAR for analysis.

The method averages 4 × 4 pixels in linear power before converting to dB, then
classifies open water with **HH < −15 dB and HV < −24 dB**. It applies the notebook's
Natural Earth land mask, removes the first date's water and water present throughout
the stack, and removes flood patches smaller than 10 connected pixels. It uses only
land pixels with valid HH and HV on every acquisition. It requires real HH and HV in
frequency A on matching grids; it never creates proxy polarizations. Radar maps are
reprojected for correct placement on the Leaflet map; measurement areas and GeoTIFFs
use the source projected grid.

These thresholds come from the supplied notebook and need regional calibration.
Results estimate **new open water relative to the first available acquisition**,
which may already be flooded. They do not detect inundation beneath vegetation and
have not been independently validated. A single selected frame may cover part of a
large rectangle; the app reports the common analyzed land area, and unobserved areas
are transparent. Duration exports count flooded acquisitions, not elapsed days.

Full GCOV files can be several GB each. The app streams only the HDF5 blocks needed
for the selected region, using a bounded block cache, instead of downloading every
full scene. Existing complete GCOV files in `.cache/nisar/` are reused. The Natural
Earth coastline is fetched on first use into `.cache/cartopy/`.
Caches are excluded from Git. Each run exports PNGs, `metrics.json`, `metrics.csv`,
`flood.tif`, and `flood_duration.tif` into `public/data/flood_<region>_<run-id>/`.
Each run uses an isolated worker, so another analysis cannot hold up its network
access. Starting a new analysis in the same browser cancels its previous run;
**Cancel analysis** also stops the active worker. Progress includes elapsed time.
A worker that reports no progress for 120 seconds is stopped with a stage-specific
error; the overall run limit is 15 minutes. Shorten the date range or draw a smaller
region if processing reaches time or memory limits.

NISAR [launched on July 30, 2025](https://science.nasa.gov/mission/nisar/mission-overview/),
so there are no NISAR observations for 2024. A range spanning 2024–2026 searches only
the portion after launch and uses the actual first available acquisition as its
baseline. A period ending before launch is rejected immediately.
If no consistent two-date stack is found, widen the dates or select another region.
If authentication fails, verify Earthdata access and restart the server with its
credentials available. The notebook's dependencies are installed by `requirements.txt`;
no notebook execution is needed to use the app.

The flood API is `POST /api/flood/analyze`:

```json
{"bbox": [32.5, -25.5, 33.8, -24.0], "start_date": "2025-10-01", "end_date": "2025-11-01", "region_name": "custom_roi"}
```

It returns HTTP `202` with a run-specific `region`. Poll the shared
`GET /api/analyze/status?region_name=<region>` endpoint. Running responses include
`progress.stage`, `progress.message`, and `elapsed_seconds`; completed responses include `acquisition_series`
with dates, measured water/new-water areas, image URLs and geographic bounds, plus
`downloads` for the CSV and GeoTIFFs. Failures return an error without simulated measurements.
The browser supplies a persistent per-session `client_id`; submitting another analysis
with the same identifier cancels the previous one. `POST /api/flood/cancel` accepts
`{"client_id": "...", "region_name": "..."}` to cancel that browser's run. Cancelled
jobs report `status: "cancelled"` and cannot publish late worker results.

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
├── flood_pipeline.py           # NISAR GCOV region streaming, new water detection, exports
├── nisar_forest_pipeline.py    # NISAR HV vegetation estimates, dated imagery and mask exports
├── flood_jobs.py               # Isolated worker, cancellation, and timeout supervision
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
        ├── florida/            # Archived imagery from the former hurricane demonstration
        └── <region>_<run-id>/  # Generated monthly PNGs and JSON/CSV measurements
```

---

## 📡 Data Attribution
- **Copernicus Sentinel-1 SAR**: European Space Agency (ESA) & European Commission
- **Data Processing**: Google Earth Engine API
- **Basemap Imagery**: Esri, CartoDB, OpenStreetMap, NASA EOSDIS GIBS
