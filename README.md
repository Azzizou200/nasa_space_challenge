# AERO-WATCH

An Earth observation workspace built for the NASA Space Apps Challenge. Explore a
satellite map, select a region, and inspect changes over time using Sentinel-1
C-band radar or NISAR L-band radar.

The app includes forest observations, NISAR flood tracking, and six saved forest
examples with real imagery and measured statistics. The frontend uses plain HTML,
CSS, JavaScript, and Leaflet; the backend is Python. No frontend build or npm
installation is required.

## Features

| Mode | Source | Results |
| --- | --- | --- |
| Forests · Sentinel-1 | Google Earth Engine `COPERNICUS/S1_GRD`, VV/VH | Monthly forest-cover estimates, baseline coverage, net change, and peak monthly loss |
| Forests · NISAR | NASA Earthdata L2 GCOV, HH/HV | Exploratory vegetation-cover estimates on acquisition dates, net change, and peak interval loss |
| Floods | NASA Earthdata L2 GCOV, HH/HV | Baseline water, peak/latest new open water, and acquisition-count duration |
| Explore | Basemap imagery | Global browsing and location search |

- Draw a rectangle or open a ready-made forest example.
- Scrub observations, play a sequence, change playback speed, or compare with the baseline.
- Switch between Esri satellite imagery, CARTO dark/light, OpenStreetMap, and NASA VIIRS night lights.
- Search locations through OpenStreetMap Nominatim and inspect coordinates and zoom.
- Adjust overlay opacity or use display-only forest image enhancements.
- Download CSV and GeoTIFF outputs from completed NISAR analyses.

Radar estimates are not validated land-cover classifications, confirmed logging
detections, or independently validated flood assessments. Moisture, season,
terrain, and vegetation type can affect the results.

## Quick start

You need Python 3.10 or newer, a modern browser, and internet access. Node.js is
only needed for the JavaScript tests.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python server.py
```

Open [http://localhost:8000/](http://localhost:8000/). The root page forwards to
`public/index.html`. To use another port, run `.venv/bin/python server.py 8080`
and open `http://localhost:8080/`.

**Try saved data first:** open **Forests**, choose a **Forest data source**, then
select a **Ready-made example**. Saved examples require no Earth Engine or
Earthdata login. Map tiles, location search, and the Leaflet CDN still need
internet access. New analyses require the appropriate authentication below.

Restart `server.py` after changing Python code. Refresh the browser after changing
frontend files.

## Authentication for new analyses

### Sentinel-1: Google Earth Engine

Use a Google account with access to an Earth Engine enabled Cloud project. Replace
`YOUR_PROJECT_ID` with your project ID:

```bash
.venv/bin/earthengine authenticate
.venv/bin/earthengine set_project YOUR_PROJECT_ID
.venv/bin/python server.py
```

Authenticate under the same operating system account and Python environment as
the server. Background jobs do not open interactive login prompts.

### NISAR forests and floods: NASA Earthdata

NISAR uses Earthdata credentials separately from Earth Engine. Create a persistent
login from a terminal:

```bash
.venv/bin/python -c 'import earthaccess; earthaccess.login(strategy="interactive", persist=True)'
.venv/bin/python server.py
```

Alternatively, provide `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`, or
`EARTHDATA_TOKEN`, in the server environment. The server uses environment
credentials or `.netrc` without prompting. Keep credentials outside the repository.
See the [earthaccess authentication guide](https://earthaccess.readthedocs.io/en/stable/user/howto/authenticate/).

Earth Engine is not required for either NISAR mode.

## Ready-made forest examples

Each forest source offers three saved examples, for six analyses in total:

| Example | Region | Sentinel-1 | NISAR |
| --- | --- | --- | --- |
| Amazon | Rondônia, Brazil | 12 monthly frames · 2025 | 4 acquisitions · September–October 2026 |
| Congo | Mai-Ndombe, DR Congo | 12 monthly frames · 2025 | 4 acquisitions · September–October 2026 |
| Borneo | Central Kalimantan, Indonesia | 12 monthly frames · 2025 | 5 acquisitions · September–October 2026 |

Selecting an example moves the map, selects its rectangle, fills the settings, and
loads saved images, statistics, and timeline frames. It does not start an analysis
or poll an active job. The statistics are labeled **Saved example** and remain
available after server restarts. **Analyze forest** reruns the selected settings.
Changing the source or drawing a custom region clears the example selection.

The sources use the same rectangles but different periods and methods; their
estimates are not a direct measurement of change between sensors. The Congo
rectangle includes river-dominated terrain and is retained as a mixed-surface
example, rather than a forest-only reference.

The catalog is [public/forest-examples.js](public/forest-examples.js). Retain its
referenced run directories in `public/data/` with the application. To rebuild all
six examples, authenticate the running server for both services, then run:

```bash
.venv/bin/python -B scripts/build_forest_examples.py
```

For another port, add `--base-url http://127.0.0.1:8080`. The builder uses fixed
study rectangles, Sentinel-1 year 2025, and NISAR dates September 1–October 31, 2026
with an HV threshold of −13 dB. It replaces the catalog only after all six analyses
and required outputs complete. Previous run directories remain on disk.

## Analyze a custom forest region

1. Open **Forests** and choose **Sentinel-1 · C-band** or **NISAR · L-band**.
2. Search for a location, then click **Draw a region** or press `S` and drag a rectangle.
3. For Sentinel-1, drawing starts the twelve-month **2025** analysis. For NISAR,
   drawing only selects the region: set the dates and HV threshold, then click
   **Analyze forest**. NISAR initially uses the last 90 days.
4. Wait for processing. Measurements stay pending until the run succeeds; errors
   are displayed without simulated fallback statistics. Sentinel-1 images can
   appear before all monthly measurements finish.
5. Use the timeline, playback, charts, and **Compare baseline**. Completed NISAR
   results include CSV and vegetation-mask GeoTIFF download links.

Forest and flood selections are kept separately.

### Sentinel-1 method

[pipeline.py](pipeline.py) selects Sentinel-1 IW observations containing VV and VH,
uses a consistent orbit direction, and forms monthly median composites. Forest
area is estimated using **VH > −15.5 dB**, summed with pixel areas at an **80 m**
analysis scale. Missing observations in any month cause an explicit failure.

January is the baseline. Net loss is January cover minus December cover; negative
loss means an estimated increase. The chart shows nonnegative decreases between
consecutive monthly estimates. These are changes in thresholded radar coverage,
not proof of forest clearing or illegal logging.

The browser requests **2025**. The API and command-line pipeline accept other
years, subject to observations being available for every month.

### NISAR vegetation method

[nisar_forest_pipeline.py](nisar_forest_pipeline.py) uses actual HH/HV acquisitions
from a consistent track, direction, frame, mode, and polarization. It averages
**4 × 4 pixels in linear power**, converts to dB, and applies
**HV gamma0 > the selected threshold**. Only land with valid HH and HV on every
acquisition contributes to the estimates.

The adjustable **−13 dB** starting value needs regional calibration. This is an
**exploratory vegetation-cover proxy**, not an official NISAR forest-disturbance
product. The [NISAR Science Users' Handbook](https://nisar.jpl.nasa.gov/documents/26/NISAR_FINAL_9-6-19.pdf)
discusses HV masks and a −13 dB threshold used in earlier ALOS experiments; that
value is not calibrated for the gamma0 GCOV observations used here. The
[ASF GCOV guide](https://nisar-docs.asf.alaska.edu/gcov/) describes GCOV normalization
and covariance terms.

The first acquisition is the baseline. The chart shows loss between acquisitions,
whose intervals can differ; **these are not monthly rates**. Cards show baseline
vegetation, net loss or gain, peak interval loss, and observation count. Reported
area covers common valid land in the selected frame and may be smaller than the
rectangle.

## Track floods with NISAR

1. Open **Floods** and draw a region, or choose a **Flood reference location** from
   the selector or numbered markers: Limpopo/Chókwè, Jamuna/Sirajganj, Indus/Sukkur,
   Mekong/Phnom Penh, or Mississippi/Vicksburg.
2. Set **Start date** and **End date**, then click **Analyze floods**. Selecting a
   reference area does not change the dates or start downloads.
3. Follow progress, then scrub or play actual acquisition dates. Compare against
   the first observation with **Compare baseline**.
4. Download the measured CSV, flood GeoTIFF, or flood-duration GeoTIFF.

Reference locations provide historical flood context and NASA source links. They
do not guarantee observations or flooding during the chosen period.

[flood_pipeline.py](flood_pipeline.py) averages 4 × 4 pixels in linear power before
converting to dB, then detects open water using **HH < −15 dB and HV < −24 dB**.
It masks ocean with Natural Earth land geometry, excludes baseline water and water
present throughout the series, and removes patches smaller than ten connected
pixels. Only common valid HH/HV land pixels are analyzed.

The result estimates **new open water relative to the first acquisition**, which
may already be flooded. It does not detect inundation beneath vegetation, and its
thresholds need regional calibration. Red indicates new open water, blue indicates
other detected water, and gray is HH radar backscatter. Duration exports count
flooded acquisitions, **not elapsed days**.

## NISAR dates and processing

Both NISAR modes require at least two aligned acquisitions. Dates are inclusive;
the end date must follow the start and cannot be in the future. Searches are
limited to dates on or after the July 30, 2025 launch. There are no 2024 NISAR
observations. A range spanning launch uses the actual first available acquisition
as its baseline.

Searches try validated, provisional, then beta GCOV collections without mixing
releases. Frequency A must contain genuine HH and HV on matching grids; proxy
polarizations are not synthesized. See the
[NISAR data access guide](https://nisar-docs.asf.alaska.edu/earthaccess/).

GCOV files can be several GB. The app streams HDF5 blocks needed for the region
with a bounded cache and reuses complete files in `.cache/nisar/`. Natural Earth
geometry is cached in `.cache/cartopy/`. Both caches are ignored by Git.

NISAR jobs run in isolated, cancellable processes. A run with no progress for
**120 seconds**, or more than **15 minutes** total, is stopped with an error.
Starting another run of the same NISAR mode in one browser replaces the previous
run. **Cancel analysis** stops the worker. Forest and flood workers use separate
browser identifiers. Smaller regions and shorter date ranges reduce resource use.

## Outputs and saved state

| Analysis | Output directory | Files |
| --- | --- | --- |
| Sentinel-1 forest | `public/data/<region>_<run-id>/` | Monthly PNGs, `metrics.json`, `metrics.csv` |
| NISAR forest | `public/data/forest_<region>_<run-id>/` | Acquisition PNGs, `metrics.json`, `metrics.csv`, `forest.tif` |
| NISAR flood | `public/data/flood_<region>_<run-id>/` | Acquisition PNGs, `metrics.json`, `metrics.csv`, `flood.tif`, `flood_duration.tif` |

NISAR display images are reprojected for Leaflet. Measurements and GeoTIFFs retain
the source projected, multilooked grid. `forest.tif` has one band per date: 1 above
the selected threshold, 0 below, and 255 outside common valid land. The forest CSV
includes nonnegative interval `loss_km2` and signed `net_change_km2`, where positive
means gain.

Job status is held in memory. Restarting the server loses active job status but
retains files. Arbitrary older runs are not automatically restored; saved forest
examples load directly from their catalog and do not depend on job memory.

## Display controls and shortcuts

**Display settings → Image view** offers original radar, enhanced radar, and simple
colors for forests. Processing runs locally in the browser and changes only the
display. Simple colors group radar patterns; they are not land-cover classes.
Flood colors are preserved. Original forest RGB uses VV−VH/VH/VV for Sentinel-1 and
HH−HV/HV/HH for NISAR; the legend changes with the selected source.

| Key | Action |
| --- | --- |
| `/` | Focus location search |
| `S` | Draw a region |
| `Space` | Play or pause |
| `←` / `→` | Step observations |
| `B` | Compare with baseline |
| `I` | Toggle analytics |
| `F` | Toggle fullscreen |
| `?` | Open help |
| `Esc` | Cancel drawing or close a menu |

## API and command line

Analysis requests return HTTP `202` with a unique `region`. Poll the status endpoint
with that identifier.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/analyze` | Sentinel-1 forest analysis |
| `POST` | `/api/forest/nisar/analyze` | NISAR vegetation analysis |
| `POST` | `/api/flood/analyze` | NISAR flood analysis |
| `GET` | `/api/analyze/status?region_name=<region>` | Progress, errors, images, and completed metrics |
| `POST` | `/api/nisar/cancel` | Cancel a matching NISAR job for a browser identifier |
| `POST` | `/api/flood/cancel` | Supported alias for NISAR cancellation |

Coordinates are `[west, south, east, north]` in degrees. Rectangles must have
increasing longitude and latitude and cannot cross the antimeridian. NISAR regions
must lie between 85°S and 85°N. Request examples:

**Sentinel-1 forest**

```json
{"bbox": [-63.15, -9.65, -63.03, -9.53], "year": 2025, "region_name": "custom_roi"}
```

The API accepts years from 2014 through the current year, subject to observations
being available for all twelve months.

**NISAR forest**

```json
{"bbox": [-63.15, -9.65, -63.03, -9.53], "start_date": "2026-09-01", "end_date": "2026-10-31", "hv_threshold_db": -13, "region_name": "custom_roi", "client_id": "forest_browser_session"}
```

**NISAR flood**

```json
{"bbox": [32.81, -24.70, 33.15, -24.36], "start_date": "2026-06-01", "end_date": "2026-07-31", "region_name": "custom_roi", "client_id": "flood_browser_session"}
```

**Cancel a NISAR job**

```json
{"client_id": "forest_browser_session", "region_name": "<region returned by the analysis request>"}
```

Status responses include `running`, `complete`, `error`, or `cancelled`, along with
`metrics_ready`, `metrics`, and `images`. NISAR progress includes a stage, message,
and elapsed time. Completed forest metrics contain `monthly_series` for Sentinel-1
or `acquisition_series` for NISAR; flood metrics also use `acquisition_series`.
NISAR completion includes download URLs. Errors do not publish fallback measurements.

To run the Sentinel-1 pipeline directly for another year or output location:

```bash
.venv/bin/python pipeline.py --bbox -63.15 -9.65 -63.03 -9.53 --year 2025 --name example --outdir public/data/example
```

## Tests

Run the Python and JavaScript checks without requesting new satellite observations:

```bash
.venv/bin/python -B -m unittest discover -s tests -v
node tests/satellite-ui.test.cjs
node tests/image-effects.test.cjs
```

The tests cover API validation/publication, HDF5 processing and geospatial exports,
worker cancellation/timeouts, source selection, stale responses, saved example
files, playback, and display-only effects. They use mocked service responses, small
local HDF5 fixtures, and committed example outputs. They do not independently
validate scientific accuracy or live service authentication.

## Troubleshooting and server behavior

| Problem | Check |
| --- | --- |
| New analysis fails on a static host | Run `server.py`; `python3 -m http.server` can show the UI and saved examples but cannot process analysis requests. |
| Sentinel-1 cannot initialize | Authenticate Earth Engine and configure an enabled project under the same account/environment as the server. |
| Sentinel-1 reports a missing month | Choose another region or year with observations in all twelve months for the selected orbit. |
| NISAR authentication fails | Configure Earthdata credentials or persistent login, then restart the server. |
| No consistent NISAR stack | Widen the dates or select another region with at least two matching HH/HV acquisitions. |
| A NISAR job stalls or exceeds limits | Draw a smaller region or shorten the dates. |
| An analysis is no longer active | The server may have restarted; rerun the analysis or open a saved example. |
| A saved example cannot load | Keep `public/forest-examples.js` and its referenced `public/data/` directories together. |
| Basemap or search is unavailable | Check internet access and the external tile, CDN, or geocoding service. |

The bundled server is intended for local development. It serves the project
directory, binds to all interfaces, and has no application authentication. Direct
`file://` browsing is not supported for analysis or loading saved example JSON.

## Project structure

```text
├── server.py                       # Static hosting, API, job registry and publication
├── pipeline.py                     # Sentinel-1 monthly forest estimates through Earth Engine
├── nisar_forest_pipeline.py         # NISAR vegetation estimates, images and mask exports
├── flood_pipeline.py               # NISAR stack access, regional reads and flood analysis
├── flood_jobs.py                   # Shared isolated NISAR workers and supervision
├── requirements.txt                # Python dependencies
├── scripts/build_forest_examples.py # Rebuild all six saved forest examples
├── tests/                          # Python and Node.js regression checks
├── test.ipynb                      # Archived Sentinel-1 Amazon/Florida image exporter
├── index.html                      # Forwarder to the application
└── public/
    ├── index.html                  # Application markup
    ├── app.js                      # Map, source controls, requests, examples and playback
    ├── image-effects.js            # Browser-only radar display processing
    ├── forest-examples.js          # Saved forest example catalog
    ├── style.css                   # Workspace styling
    ├── assets/                     # Frontend assets
    └── data/                       # Saved analyses, exports and archived imagery
```

`server (2).py` is a legacy FastAPI alternative; use `server.py` for the current
application. The archived `test.ipynb` and Amazon/Florida manifest imagery are not
required to run the live pipelines. No notebook execution is needed.

## Data attribution

- **Sentinel-1 SAR:** ESA and the European Commission's Copernicus programme,
  accessed through Google Earth Engine.
- **NISAR:** the NASA–ISRO mission, with GCOV access through NASA Earthdata and ASF.
- **Reference land geometry:** Natural Earth, accessed through Cartopy.
- **Basemaps:** Esri and its imagery providers, CARTO, OpenStreetMap contributors,
  and NASA EOSDIS GIBS.
- **Location search:** OpenStreetMap Nominatim.
