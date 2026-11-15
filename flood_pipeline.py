"""NISAR GCOV open-water change tracking, adapted from nisar_flood_pipeline.ipynb.

The first acquisition is the reference. This maps new open water, not flooding
beneath vegetation. All dates use the same track, frame, grid and valid pixels.
"""
import csv
from contextlib import closing, contextmanager
import datetime as dt
import json
import os
from pathlib import Path
import warnings

import h5py
import numpy as np
from PIL import Image
from pyproj import Transformer
import rasterio
from rasterio import features
from rasterio.transform import from_origin, array_bounds
from rasterio.warp import calculate_default_transform, reproject, Resampling, transform_bounds
from scipy import ndimage
from shapely.geometry import Polygon, box, mapping

GRP = "/science/LSAR/GCOV/grids/frequencyA/"
COLLECTIONS = ("NISAR_L2_GCOV_V1", "NISAR_L2_GCOV_PROVISIONAL_V1", "NISAR_L2_GCOV_BETA_V1")
NISAR_LAUNCH_DATE = "2025-07-30"


def validate_selection(bbox, start_date, end_date):
    if (not isinstance(bbox, list) or len(bbox) != 4
            or any(isinstance(v, bool) or not isinstance(v, (int, float))
                   or not np.isfinite(v) for v in bbox)):
        raise ValueError("Draw a valid geographic rectangle.")
    west, south, east, north = bbox
    if not (-180 <= west < east <= 180 and -85 <= south < north <= 85):
        raise ValueError("Select a region between 85°S and 85°N without crossing the date line.")
    try:
        start, end = dt.date.fromisoformat(start_date), dt.date.fromisoformat(end_date)
    except (TypeError, ValueError):
        raise ValueError("Enter valid start and end dates as YYYY-MM-DD.") from None
    if start >= end:
        raise ValueError("End date must be after start date.")
    if end.isoformat() < NISAR_LAUNCH_DATE:
        raise ValueError("NISAR launched on July 30, 2025. Choose a period after launch; there are no 2024 NISAR observations.")
    if end > dt.datetime.now(dt.timezone.utc).date():
        raise ValueError("End date cannot be in the future.")
    return start.isoformat(), end.isoformat()


def parse_name(name):
    parts = Path(name).name.split("_")
    if len(parts) < 12 or len(parts[11]) < 8:
        raise ValueError("Unrecognized NISAR granule identifier.")
    date = dt.datetime.strptime(parts[11][:8], "%Y%m%d").date().isoformat()
    return dict(track=parts[5], direction=parts[6], frame=parts[7], mode=parts[8],
                polarization=parts[9], date=date)


def footprint(granule):
    geometry = granule["umm"]["SpatialExtent"]["HorizontalSpatialDomain"]["Geometry"]
    polygons = []
    for polygon in geometry.get("GPolygons", []):
        points = polygon["Boundary"]["Points"]
        polygons.append(Polygon([(p["Longitude"], p["Latitude"]) for p in points]))
    if not polygons:
        raise ValueError("NISAR granule has no polygon footprint.")
    from shapely.ops import unary_union
    return unary_union(polygons)


def choose_stack(results, bbox):
    """Keep one frame/mode/orbit and one granule per date; favour AOI coverage."""
    aoi = box(*bbox)
    groups = {}
    for granule in results:
        try:
            fields = parse_name(granule["meta"]["native-id"])
            # The notebook's thresholds require measured HH and HV, both in band A.
            # The product name identifies DH (HH/HV) and QP (quad-pol) acquisitions.
            if fields["polarization"][:2] not in ("DH", "QP"):
                continue
            coverage = footprint(granule).intersection(aoi).area / aoi.area
        except (KeyError, ValueError, TypeError):
            continue
        if coverage <= 0:
            continue
        key = tuple(fields[k] for k in ("track", "direction", "frame", "mode", "polarization"))
        dates = groups.setdefault(key, {})
        candidate = dict(fields, granule=granule, coverage=coverage)
        if fields["date"] not in dates or coverage > dates[fields["date"]]["coverage"]:
            dates[fields["date"]] = candidate
    candidates = [sorted(dates.values(), key=lambda item: item["date"])
                  for dates in groups.values() if len(dates) >= 2]
    if not candidates:
        raise ValueError("No consistent NISAR track/frame has at least two acquisition dates for this region and period. Widen the dates or draw another region.")
    return max(candidates, key=lambda rows: (min(r["coverage"] for r in rows) >= .98,
                                           min(r["coverage"] for r in rows), len(rows)))


def login_earthdata(earthaccess):
    strategy = "environment" if (os.getenv("EARTHDATA_TOKEN") or
                                 os.getenv("EARTHDATA_USERNAME")) else "netrc"
    try:
        auth = earthaccess.login(strategy=strategy)
        if not auth.authenticated:
            raise RuntimeError("unauthenticated")
    except Exception:
        raise RuntimeError("Earthdata login unavailable. Configure EARTHDATA_USERNAME and EARTHDATA_PASSWORD, EARTHDATA_TOKEN, or a .netrc login, then restart server.py.") from None


class RemoteAcquisition:
    def __init__(self, granule):
        self.granule = granule


@contextmanager
def open_acquisition(source):
    if isinstance(source, h5py.File):
        yield source
    elif isinstance(source, RemoteAcquisition):
        import earthaccess
        streams = earthaccess.open([source.granule], show_progress=False,
            pqdm_kwargs={"n_jobs": 1}, open_kwargs={"block_size": 8*1024*1024,
                "cache_type": "blockcache", "cache_options": {"maxblocks": 8}})
        try:
            if len(streams) != 1:
                raise ValueError("NISAR did not return one readable HDF5 acquisition.")
            with h5py.File(streams[0], "r", rdcc_nbytes=4*1024*1024) as handle:
                yield handle
        finally:
            for stream in streams:
                stream.close()
    else:
        with h5py.File(source, "r") as handle:
            yield handle


def fetch_stack(bbox, start_date, end_date, cache_dir, progress):
    import earthaccess
    progress("authenticating", "Checking NASA Earthdata access…")
    login_earthdata(earthaccess)
    # Prefer a single release with a usable stack; do not mix calibration releases.
    for collection in COLLECTIONS:
        progress("searching", f"Searching {collection} for matching observations…")
        results = earthaccess.search_data(short_name=collection, bounding_box=tuple(bbox),
                                          temporal=(max(start_date, NISAR_LAUNCH_DATE), end_date), count=-1)
        try:
            selected = choose_stack(results, bbox)
        except ValueError:
            continue
        break
    else:
        raise ValueError("No consistent NISAR HH/HV stack with at least two dates covers this region and period. NISAR launched on July 30, 2025; 2024 observations do not exist. Try a recent date range or a different region.")
    sources = []
    for row in selected:
        native_id = Path(row["granule"]["meta"]["native-id"]).name
        cached = Path(cache_dir) / collection / (native_id.removesuffix(".h5") + ".h5")
        sources.append(cached if cached.is_file() else RemoteAcquisition(row["granule"]))
    progress("opening", f"Found {len(selected)} acquisitions ({selected[0]['date']} to {selected[-1]['date']}). Reading the selected region only.",
             completed=0, total=len(selected))
    return sources, selected, collection


def read_grid(path, bbox, multilook=4):
    with open_acquisition(path) as handle:
        group = handle[GRP]
        if "HHHH" not in group or "HVHV" not in group:
            raise ValueError("This NISAR stack does not contain both HH and HV in frequency A. Select another region or period; proxy polarizations are not used.")
        epsg = int(group["projection"][()])
        x, y = group["xCoordinates"][:], group["yCoordinates"][:]
    if len(x) < 2 or len(y) < 2 or x[1] <= x[0] or y[1] >= y[0]:
        raise ValueError("Unsupported NISAR coordinate grid.")
    dx, dy = float(x[1] - x[0]), float(y[0] - y[1])
    west, south, east, north = transform_bounds(4326, epsg, *bbox, densify_pts=21)
    col0 = max(0, int(np.floor((west - (x[0] - dx / 2)) / dx)))
    row0 = max(0, int(np.floor(((y[0] + dy / 2) - north) / dy)))
    col1 = min(len(x), int(np.ceil((east - (x[0] - dx / 2)) / dx)))
    row1 = min(len(y), int(np.ceil(((y[0] + dy / 2) - south) / dy)))
    rows, cols = (row1 - row0) // multilook * multilook, (col1 - col0) // multilook * multilook
    if rows < multilook or cols < multilook:
        raise ValueError("The selected region has too little overlap with the NISAR frame.")
    # Bound worker memory before allocating the time stack.
    if rows // multilook * (cols // multilook) > 4_000_000:
        raise ValueError("Draw a smaller region to keep NISAR processing within memory limits.")
    transform = from_origin(x[col0] - dx / 2, y[row0] + dy / 2, dx * multilook, dy * multilook)
    return dict(epsg=epsg, x=x, y=y, row0=row0, col0=col0, rows=rows, cols=cols,
                shape=(rows // multilook, cols // multilook), transform=transform, multilook=multilook)


def read_multilooked(path, grid, polarization, progress=None):
    ml = grid["multilook"]
    out = np.full(grid["shape"], np.nan, dtype="float32")
    with open_acquisition(path) as handle:
        group = handle[GRP]
        if (int(group["projection"][()]) != grid["epsg"]
                or not np.array_equal(group["xCoordinates"][:], grid["x"])
                or not np.array_equal(group["yCoordinates"][:], grid["y"])):
            raise ValueError("NISAR acquisitions use different grids; they cannot be compared without alignment.")
        if polarization not in group:
            raise ValueError("Every acquisition must contain real HH and HV observations.")
        dataset = group[polarization]
        for offset in range(0, grid["rows"], 2000):
            stop = min(offset + 2000, grid["rows"])
            values = dataset[grid["row0"] + offset:grid["row0"] + stop,
                             grid["col0"]:grid["col0"] + grid["cols"]].astype("float32")
            values[~np.isfinite(values) | (values <= 0)] = np.nan
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                averaged = np.nanmean(values.reshape((stop-offset)//ml, ml, grid["cols"]//ml, ml), axis=(1, 3))
            out[offset//ml:stop//ml] = averaged
            if progress:
                progress(polarization, stop, grid["rows"])
    with np.errstate(divide="ignore", invalid="ignore"):
        return 10 * np.log10(out)


def land_mask(grid, bbox):
    """Use the notebook's Natural Earth 10 m coastline and clip to the drawn AOI."""
    import cartopy
    import cartopy.io.shapereader as reader
    # Keep downloaded reference data outside public/ and the user's home config.
    cartopy.config["data_dir"] = str(Path(__file__).parent / ".cache" / "cartopy")
    path = reader.natural_earth("10m", "physical", "land")
    from shapely.ops import transform
    project = Transformer.from_crs(4326, grid["epsg"], always_xy=True).transform
    aoi = box(*bbox)
    shapes = []
    with closing(reader.Reader(path)) as source:
        for geometry in source.geometries():
            if geometry.intersects(aoi):
                clipped = geometry.intersection(aoi)
                if not clipped.is_empty:
                    shapes.append(mapping(transform(project, clipped)))
    if not shapes:
        raise ValueError("No land overlaps the selected NISAR area.")
    return features.rasterize(shapes, out_shape=grid["shape"], transform=grid["transform"],
                              fill=0, default_value=1, dtype="uint8").astype(bool)


def detect_flood(hh, hv, land, hh_threshold=-15, hv_threshold=-24, min_blob=10):
    if hh.shape != hv.shape or hh.ndim != 3 or hh.shape[0] < 2:
        raise ValueError("Flood tracking requires at least two aligned HH/HV acquisitions.")
    # Missing observations must never become a dry baseline or apparent new water.
    valid = np.isfinite(hh).all(axis=0) & np.isfinite(hv).all(axis=0) & land
    if not valid.any():
        raise ValueError("No common valid land pixels exist across all acquisitions.")
    water = (hh < hh_threshold) & (hv < hv_threshold) & valid
    flood = water & ~water[0] & ~water.all(axis=0)
    if min_blob:
        for index in range(len(flood)):
            labels, _ = ndimage.label(flood[index], structure=np.ones((3, 3)))
            keep = np.bincount(labels.ravel()) >= min_blob
            keep[0] = False
            flood[index] = keep[labels]
    return water, flood, valid


def export_results(hh, water, flood, valid, grid, dates, bbox, region_name,
                   start_date, end_date, output_dir, collection, selection):
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    transform, epsg = grid["transform"], grid["epsg"]
    pixel_km2 = abs(transform.a * transform.e) / 1e6
    bounds = array_bounds(*grid["shape"], transform)
    web_transform, width, height = calculate_default_transform(epsg, 3857, grid["shape"][1], grid["shape"][0], *bounds)
    # Bound display images; statistics and GeoTIFFs retain native multilooked resolution.
    if max(width, height) > 1600:
        scale = max(width, height) / 1600
        width, height = max(1, round(width / scale)), max(1, round(height / scale))
        web_transform = rasterio.transform.from_bounds(*transform_bounds(epsg, 3857, *bounds), width, height)
    web_bounds = transform_bounds(3857, 4326, *array_bounds(height, width, web_transform))
    leaflet_bounds = [[web_bounds[1], web_bounds[0]], [web_bounds[3], web_bounds[2]]]
    profile = dict(driver="GTiff", height=grid["shape"][0], width=grid["shape"][1],
                   crs=f"EPSG:{epsg}", transform=transform, compress="deflate", dtype="uint8", nodata=255)
    with rasterio.open(out / "flood.tif", "w", count=len(dates), **profile) as dst:
        for index, date in enumerate(dates):
            dst.write(np.where(valid, flood[index], 255).astype("uint8"), index+1)
            dst.set_band_description(index+1, date)
    duration = flood.sum(axis=0)
    with rasterio.open(out / "flood_duration.tif", "w", count=1,
                       **{**profile, "dtype": "uint16", "nodata": 65535}) as dst:
        dst.write(np.where(valid, duration, 65535).astype("uint16"), 1)
    series = []
    for index, date in enumerate(dates):
        gray = np.clip(np.nan_to_num((hh[index] + 25) / 25, nan=0), 0, 1) * 220 + 20
        rgba = np.stack([gray, gray, gray, valid * 255], axis=-1).astype("uint8")
        rgba[water[index] & ~flood[index], :3] = [58, 150, 205]
        rgba[flood[index], :3] = [245, 88, 67]
        projected = np.zeros((4, height, width), dtype="uint8")
        for band in range(4):
            reproject(rgba[:, :, band], projected[band], src_transform=transform,
                      src_crs=f"EPSG:{epsg}", dst_transform=web_transform, dst_crs="EPSG:3857",
                      resampling=Resampling.nearest)
        filename = f"flood_{date}.png"
        Image.fromarray(projected.transpose(1, 2, 0)).save(out / (filename + ".tmp"), format="PNG")
        os.replace(out / (filename + ".tmp"), out / filename)
        series.append(dict(date=date, water_area_km2=round(float(water[index].sum() * pixel_km2), 4),
                           flood_area_km2=round(float(flood[index].sum() * pixel_km2), 4),
                           image=filename, bounds=leaflet_bounds))
    peak = max(series, key=lambda row: row["flood_area_km2"])
    summary = dict(region=region_name, source="NISAR_L2_GCOV", collection=collection, mission="flood",
                   bbox=bbox, start_date=start_date, end_date=end_date, metrics_ready=True,
                   baseline_date=dates[0], acquisition_count=len(dates),
                   analyzed_land_area_km2=round(float(valid.sum() * pixel_km2), 4),
                   baseline_water_km2=series[0]["water_area_km2"],
                   peak_flood_km2=peak["flood_area_km2"], peak_flood_date=peak["date"],
                   latest_flood_km2=series[-1]["flood_area_km2"],
                   affected_area_km2=round(float(flood.any(axis=0).sum() * pixel_km2), 4),
                   track=selection["track"], direction=selection["direction"], frame=selection["frame"],
                   mode=selection["mode"], footprint_coverage=selection["coverage"],
                   method=dict(hh_threshold_db=-15, hv_threshold_db=-24, multilook=4, min_blob_pixels=10,
                               pixel_area_m2=pixel_km2*1e6,
                               interpretation="New open water relative to the first acquisition; not independently validated. Flooded vegetation is not mapped."),
                   acquisition_series=series)
    with open(out / "metrics.json.tmp", "w") as handle:
        json.dump(summary, handle, indent=2, allow_nan=False)
    os.replace(out / "metrics.json.tmp", out / "metrics.json")
    with open(out / "metrics.csv", "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["date", "water_area_km2", "flood_area_km2"])
        writer.writeheader()
        writer.writerows({key: row[key] for key in writer.fieldnames} for row in series)
    return summary


def analyze_flood_region(bbox, start_date, end_date, region_name, output_dir, cache_dir, progress=None):
    validate_selection(bbox, start_date, end_date)
    progress = progress or (lambda *args, **kwargs: None)
    paths, selected, collection = fetch_stack(bbox, start_date, end_date, cache_dir, progress)
    grid = None
    hh, hv = [], []
    for index, path in enumerate(paths):
        date = selected[index]["date"]
        progress("reading", f"Opening acquisition {index+1} of {len(paths)} ({date}) · selected region only…",
                 completed=index, total=len(paths))
        def rows_ready(polarization, done, total):
            progress("reading", f"Acquisition {index+1} of {len(paths)} ({date}) · {polarization[:2]}: {done:,} / {total:,} region rows read",
                     completed=index, total=len(paths))
        with open_acquisition(path) as handle:
            if grid is None:
                grid = read_grid(handle, bbox)
                if len(paths) * np.prod(grid["shape"]) > 40_000_000:
                    raise ValueError("This region and date range require too much memory. Draw a smaller region or shorten the dates.")
            hh.append(read_multilooked(handle, grid, "HHHH", rows_ready))
            hv.append(read_multilooked(handle, grid, "HVHV", rows_ready))
    progress("masking", "Masking ocean and comparing new open water with the first acquisition…")
    water, flood, valid = detect_flood(np.stack(hh), np.stack(hv), land_mask(grid, bbox))
    progress("exporting", "Preparing flood maps, time series, and GeoTIFF downloads…")
    return export_results(np.stack(hh), water, flood, valid, grid, [row["date"] for row in selected],
                          bbox, region_name, start_date, end_date, output_dir, collection, selected[0])
