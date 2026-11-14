"""
Universal SAR Environmental Change Detection Pipeline
Sentinel-1 Synthetic Aperture Radar via Google Earth Engine

Region-agnostic engine that takes ANY bounding box and target year,
computes monthly forest canopy area, tracks illegal logging dynamics,
and quantifies tree dissipation speed (km2/month).
"""

import os
import sys
import time
import json
import argparse
import datetime
import requests
import numpy as np
import pandas as pd
from PIL import Image
import ee


def init_earth_engine(max_retries=5):
    """Initializes Earth Engine with automatic retry logic."""
    for attempt in range(max_retries):
        try:
            ee.Initialize()
            return True
        except Exception as e:
            time.sleep(2)
    try:
        ee.Authenticate()
        ee.Initialize()
        return True
    except Exception as e:
        raise RuntimeError(f"Could not initialize Google Earth Engine: {e}")


def analyze_forest_region(bbox, year=2025, region_name="custom_region",
                          output_dir=None, vh_threshold_db=-15.5,
                          img_size=800, scale=80, quiet=False):
    """
    Universal pipeline function:
    
    Parameters:
      bbox (list): [min_lon, min_lat, max_lon, max_lat]
      year (int): Target observation year (e.g. 2024, 2025)
      region_name (str): Identifier for naming outputs
      output_dir (str, optional): Target save folder. Defaults to data/<region_name>/
      vh_threshold_db (float): Radar canopy cutoff in dB (default -15.5 dB)
      img_size (int): Resolution of output PNGs (e.g. 800)
      scale (int): GEE reducer scale in meters (default 80m)
      quiet (bool): Suppress print statements if True
      
    Returns:
      dict: Complete structured analysis with monthly series, KPIs, and image paths.
    """
    init_earth_engine()
    
    if output_dir is None:
        output_dir = os.path.join("data", region_name)
    os.makedirs(output_dir, exist_ok=True)
    
    min_lon, min_lat, max_lon, max_lat = bbox
    geometry = ee.Geometry.BBox(min_lon, min_lat, max_lon, max_lat)
    
    if not quiet:
        print(f"[{region_name.upper()}] Starting analysis for year {year}...")
        print(f"Bounding Box: [{min_lon}, {min_lat}, {max_lon}, {max_lat}]")
        print(f"Output directory: {output_dir}")
        print("-" * 65)
        
    months = [
        (f"{year}-01-01", f"{year}-01-31", f"Jan {year}"),
        (f"{year}-02-01", f"{year}-02-28", f"Feb {year}"),
        (f"{year}-03-01", f"{year}-03-31", f"Mar {year}"),
        (f"{year}-04-01", f"{year}-04-30", f"Apr {year}"),
        (f"{year}-05-01", f"{year}-05-31", f"May {year}"),
        (f"{year}-06-01", f"{year}-06-30", f"Jun {year}"),
        (f"{year}-07-01", f"{year}-07-31", f"Jul {year}"),
        (f"{year}-08-01", f"{year}-08-31", f"Aug {year}"),
        (f"{year}-09-01", f"{year}-09-30", f"Sep {year}"),
        (f"{year}-10-01", f"{year}-10-31", f"Oct {year}"),
        (f"{year}-11-01", f"{year}-11-30", f"Nov {year}"),
        (f"{year}-12-01", f"{year}-12-31", f"Dec {year}")
    ]
    
    # Query Sentinel-1 collection over the bbox
    base_col = (ee.ImageCollection("COPERNICUS/S1_GRD")
                .filterBounds(geometry)
                .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
                .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
                .filter(ee.Filter.eq("instrumentMode", "IW")))
                
    # Detect dominant orbit pass for consistency
    desc_count = base_col.filterDate(f"{year}-01-01", f"{year}-12-31").filter(ee.Filter.eq("orbitProperties_pass", "DESCENDING")).size().getInfo()
    orbit_pass = "DESCENDING" if desc_count > 0 else "ASCENDING"
    col = base_col.filter(ee.Filter.eq("orbitProperties_pass", orbit_pass))
    
    records = []
    
    for m_idx, (s_date, e_date, m_label) in enumerate(months):
        sub = col.filterDate(s_date, e_date)
        count = sub.size().getInfo()
        
        # Fallback to slightly expanded window if single month has temporal offset
        if count == 0:
            exp_end = (datetime.datetime.strptime(e_date, "%Y-%m-%d") + datetime.timedelta(days=10)).strftime("%Y-%m-%d")
            sub = col.filterDate(s_date, exp_end)
            count = sub.size().getInfo()
            
        comp = sub.median().clip(geometry)
        vh = comp.select("VH")
        vv = comp.select("VV")
        
        # Measure forest area (VH > threshold dB)
        forest_mask = vh.gt(vh_threshold_db)
        pixel_area = ee.Image.pixelArea().divide(1e6)  # km2
        f_stats = pixel_area.updateMask(forest_mask).reduceRegion(ee.Reducer.sum(), geometry, scale, maxPixels=1e9).getInfo()
        t_stats = pixel_area.clip(geometry).reduceRegion(ee.Reducer.sum(), geometry, scale, maxPixels=1e9).getInfo()
        
        f_km2 = round(f_stats.get("area", 0.0) or 0.0, 2)
        t_km2 = round(t_stats.get("area", 0.0) or 0.0, 2)
        f_pct = round((f_km2 / t_km2 * 100.0) if t_km2 > 0 else 0.0, 2)
        
        # Generate False-Color RGB:
        # Red = VV - VH (soil/cleared land), Green = VH (canopy volume), Blue = VV (surface)
        diff = vv.subtract(vh).rename("diff")
        rgb = ee.Image.rgb(diff, vh, vv)
        
        url = rgb.getThumbURL({
            "region": geometry,
            "min": [2, -25, -18],
            "max": [12, -10, -4],
            "dimensions": f"{img_size}x{img_size}",
            "format": "png"
        })
        
        img_filename = f"{region_name}_{year}_{m_idx+1:02d}.png"
        img_path = os.path.join(output_dir, img_filename)
        
        try:
            resp = requests.get(url, timeout=60)
            if resp.status_code == 200:
                with open(img_path, "wb") as f:
                    f.write(resp.content)
        except Exception as e:
            if not quiet:
                print(f"Warning: Failed to download thumbnail for {m_label}: {e}")
                
        if not quiet:
            print(f"[{m_idx+1:02d}/12] {m_label}: Forest = {f_km2} km² ({f_pct}%) | Saved: {img_filename}")
            
        records.append({
            "month_num": m_idx + 1,
            "month_label": m_label,
            "start_date": s_date,
            "end_date": e_date,
            "total_area_km2": t_km2,
            "forest_area_km2": f_km2,
            "forest_pct": f_pct,
            "image": img_filename
        })
        
    df = pd.DataFrame(records)
    baseline_forest = df.loc[0, "forest_area_km2"]
    df["cumulative_loss_km2"] = round(baseline_forest - df["forest_area_km2"], 2)
    df["pct_loss_from_baseline"] = round((df["cumulative_loss_km2"] / baseline_forest) * 100.0, 2)
    
    # Calculate monthly loss speed (km2 lost per month)
    df["monthly_loss_speed_km2"] = round(-df["forest_area_km2"].diff(), 2)
    df.loc[0, "monthly_loss_speed_km2"] = 0.0
    df["loss_speed_km2_month"] = df["monthly_loss_speed_km2"].apply(lambda x: max(0.0, x))
    
    total_loss = round(baseline_forest - df["forest_area_km2"].iloc[-1], 2)
    peak_row = df.loc[df["loss_speed_km2_month"].idxmax()]
    
    summary = {
        "success": True,
        "region": region_name,
        "bbox": bbox,
        "year": year,
        "orbit_pass": orbit_pass,
        "total_region_area_km2": df["total_area_km2"].iloc[0],
        "baseline_jan_forest_km2": float(baseline_forest),
        "final_dec_forest_km2": float(df["forest_area_km2"].iloc[-1]),
        "total_forest_lost_km2": float(total_loss),
        "net_loss_percentage": round(float(total_loss / baseline_forest * 100.0) if baseline_forest > 0 else 0.0, 2),
        "peak_logging_month": peak_row["month_label"],
        "peak_monthly_loss_km2": float(peak_row["loss_speed_km2_month"]),
        "monthly_series": df.to_dict(orient="records")
    }
    
    # Save metrics JSON & CSV
    json_path = os.path.join(output_dir, "metrics.json")
    csv_path = os.path.join(output_dir, "metrics.csv")
    
    with open(json_path, "w") as f:
        json.dump(summary, f, indent=2)
    df.to_csv(csv_path, index=False)
    
    summary["metrics_json_path"] = json_path
    summary["metrics_csv_path"] = csv_path
    
    if not quiet:
        print("-" * 65)
        print(f"Analysis Complete! Peak logging month: {summary['peak_logging_month']} ({summary['peak_monthly_loss_km2']} km²/mo)")
        print(f"Results exported to: {json_path}")
        
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Universal SAR Forest Change Pipeline")
    parser.add_argument("--bbox", nargs=4, type=float, default=[-63.35, -9.85, -62.85, -9.35],
                        help="Bounding box: min_lon min_lat max_lon max_lat")
    parser.add_argument("--year", type=int, default=2025, help="Observation year (e.g. 2025)")
    parser.add_argument("--name", type=str, default="custom_region", help="Region identifier")
    parser.add_argument("--outdir", type=str, default=None, help="Output directory")
    
    args = parser.parse_args()
    analyze_forest_region(bbox=args.bbox, year=args.year, region_name=args.name, output_dir=args.outdir)
