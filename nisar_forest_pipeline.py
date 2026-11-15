"""Exploratory NISAR HV vegetation-cover estimates on a common observed land grid.

This is a configurable gamma0 threshold experiment, not the official NISAR
forest-disturbance product or a calibrated forest/non-forest classifier.
"""
import csv
import json
import math
import os
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.transform import array_bounds
from rasterio.warp import calculate_default_transform, transform_bounds, reproject, Resampling

import flood_pipeline as nisar


def validate_threshold(value):
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or not -40 <= value <= 0):
        raise ValueError("Choose an HV threshold between −40 and 0 dB.")


def measure_cover(hh, hv, land, pixel_km2, threshold):
    validate_threshold(threshold)
    if hh.shape != hv.shape or hv.ndim != 3 or len(hv) < 2:
        raise ValueError("Forest tracking requires at least two aligned HH/HV acquisitions.")
    valid = np.isfinite(hh).all(axis=0) & np.isfinite(hv).all(axis=0) & land
    if not valid.any():
        raise ValueError("No common valid land pixels exist across all acquisitions.")
    cover = (hv > threshold) & valid
    areas = cover.sum(axis=(1, 2)) * pixel_km2
    return cover, valid, areas


def export_results(hh, hv, cover, valid, areas, grid, dates, bbox, region_name,
                   start_date, end_date, output_dir, collection, selection, threshold):
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    transform, epsg = grid["transform"], grid["epsg"]
    pixel_km2 = abs(transform.a * transform.e) / 1e6
    bounds = array_bounds(*grid["shape"], transform)
    web_transform, width, height = calculate_default_transform(
        epsg, 3857, grid["shape"][1], grid["shape"][0], *bounds)
    if max(width, height) > 1600:
        scale = max(width, height) / 1600
        width, height = max(1, round(width / scale)), max(1, round(height / scale))
        web_transform = rasterio.transform.from_bounds(
            *transform_bounds(epsg, 3857, *bounds), width, height)
    west, south, east, north = transform_bounds(
        3857, 4326, *array_bounds(height, width, web_transform))
    leaflet_bounds = [[south, west], [north, east]]
    with rasterio.open(out / "forest.tif", "w", driver="GTiff", count=len(dates),
                       height=grid["shape"][0], width=grid["shape"][1],
                       crs=f"EPSG:{epsg}", transform=transform,
                       dtype="uint8", nodata=255, compress="deflate") as dst:
        for index, date in enumerate(dates):
            dst.write(np.where(valid, cover[index], 255).astype("uint8"), index + 1)
            dst.set_band_description(index + 1, date)
        dst.update_tags(method="Exploratory HV gamma0 threshold", hv_threshold_db=str(threshold))
    series = []
    for index, date in enumerate(dates):
        # RGB mirrors the forest composite structure, using genuine HH/HV.
        channels = [(hh[index] - hv[index] - 2) / 10,
                    (hv[index] + 25) / 15, (hh[index] + 18) / 14]
        rgb = np.stack([np.clip(np.nan_to_num(c), 0, 1) * 255 for c in channels], axis=-1)
        rgba = np.concatenate([rgb, (valid * 255)[..., None]], axis=-1).astype("uint8")
        projected = np.zeros((4, height, width), dtype="uint8")
        for band in range(4):
            reproject(rgba[:, :, band], projected[band], src_transform=transform,
                      src_crs=f"EPSG:{epsg}", dst_transform=web_transform,
                      dst_crs="EPSG:3857", resampling=Resampling.nearest)
        filename = f"forest_{date}.png"
        Image.fromarray(projected.transpose(1, 2, 0)).save(out / (filename + ".tmp"), format="PNG")
        os.replace(out / (filename + ".tmp"), out / filename)
        change = float(areas[index - 1] - areas[index]) if index else 0.0
        series.append(dict(date=date, forest_area_km2=round(float(areas[index]), 4),
                           loss_km2=round(max(0, change), 4),
                           net_change_km2=round(-change, 4),
                           image=filename, bounds=leaflet_bounds))
    baseline = float(areas[0])
    loss = float(areas[0] - areas[-1])
    peak = max(series, key=lambda row: row["loss_km2"])
    summary = dict(success=True, region=region_name, source="NISAR_L2_GCOV", mission="forest",
        collection=collection, bbox=bbox, start_date=start_date, end_date=end_date,
        metrics_ready=True, hv_threshold_db=threshold, baseline_date=dates[0], acquisition_count=len(dates),
        total_region_area_km2=round(float(valid.sum() * pixel_km2), 4),
        baseline_forest_km2=round(baseline, 4), final_forest_km2=round(float(areas[-1]), 4),
        total_forest_lost_km2=round(loss, 4),
        net_loss_percentage=round(loss / baseline * 100, 2) if baseline > 0 else None,
        peak_loss_km2=peak["loss_km2"], peak_loss_date=peak["date"] if peak["loss_km2"] > 0 else None,
        track=selection["track"], direction=selection["direction"], frame=selection["frame"],
        mode=selection["mode"], footprint_coverage=selection["coverage"],
        method=dict(name="Exploratory HV gamma0 vegetation threshold", hv_threshold_db=threshold,
            backscatter="gamma0", multilook=4, pixel_area_m2=pixel_km2 * 1e6,
            interpretation="Exploratory vegetation-cover proxy; needs regional calibration. Not an official NISAR forest-disturbance product. Acquisition intervals are irregular."),
        acquisition_series=series)
    with open(out / "metrics.json.tmp", "w") as handle:
        json.dump(summary, handle, indent=2, allow_nan=False)
    os.replace(out / "metrics.json.tmp", out / "metrics.json")
    with open(out / "metrics.csv", "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["date", "forest_area_km2", "loss_km2", "net_change_km2"])
        writer.writeheader()
        writer.writerows({key: row[key] for key in writer.fieldnames} for row in series)
    return summary


def analyze_forest_region(bbox, start_date, end_date, region_name, output_dir,
                          cache_dir, hv_threshold_db=-13, progress=None):
    nisar.validate_selection(bbox, start_date, end_date)
    validate_threshold(hv_threshold_db)
    progress = progress or (lambda *args, **kwargs: None)
    paths, selected, collection = nisar.fetch_stack(bbox, start_date, end_date, cache_dir, progress)
    grid = None
    hh, hv = [], []
    for index, path in enumerate(paths):
        date = selected[index]["date"]
        progress("reading", f"Reading NISAR forest acquisition {index+1} of {len(paths)} ({date})…",
                 completed=index, total=len(paths))
        def rows_ready(polarization, done, total):
            progress("reading", f"Acquisition {index+1} of {len(paths)} · {polarization[:2]}: {done:,} / {total:,} rows",
                     completed=index, total=len(paths))
        with nisar.open_acquisition(path) as handle:
            if grid is None:
                grid = nisar.read_grid(handle, bbox)
                if len(paths) * np.prod(grid["shape"]) > 40_000_000:
                    raise ValueError("Draw a smaller region or shorten the dates to reduce NISAR memory use.")
            hh.append(nisar.read_multilooked(handle, grid, "HHHH", rows_ready))
            hv.append(nisar.read_multilooked(handle, grid, "HVHV", rows_ready))
    hh, hv = np.stack(hh), np.stack(hv)
    progress("masking", "Comparing vegetation estimates on land observed at every date…")
    pixel_km2 = abs(grid["transform"].a * grid["transform"].e) / 1e6
    cover, valid, areas = measure_cover(hh, hv, nisar.land_mask(grid, bbox), pixel_km2, hv_threshold_db)
    progress("exporting", "Preparing forest radar images, measured CSV, and GeoTIFF…")
    return export_results(hh, hv, cover, valid, areas, grid, [row["date"] for row in selected],
        bbox, region_name, start_date, end_date, output_dir, collection, selected[0], hv_threshold_db)
