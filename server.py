#!/usr/bin/env python3
"""
AERO-WATCH Multi-Threaded Platform & Universal SAR Deforestation Server
Uses http.server.ThreadingHTTPServer so static files (index.html, JS, CSS)
never block or hang, even while heavy Earth Engine computations are running.
"""

import http.server
import json
import math
import os
import re
import calendar
import datetime
import sys
import threading
import time
from urllib.parse import parse_qs, urlparse
from flood_jobs import AnalysisCancelled, run_flood_process

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
ANALYSIS_JOBS = {}
ANALYSIS_JOBS_LOCK = threading.Lock()


def cancel_flood_analysis(client_id, region_name=None):
    if not isinstance(client_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", client_id):
        raise ValueError("A valid browser analysis identifier is required.")
    cancelled = []
    with ANALYSIS_JOBS_LOCK:
        for region, job in ANALYSIS_JOBS.items():
            if (job.get("client_id") == client_id and job["status"] == "running"
                    and (region_name is None or region_name == region)):
                job["cancel_event"].set()
                job.update(status="cancelled", error=None, metrics=None,
                           progress=dict(stage="cancelled", message="NISAR analysis cancelled."))
                cancelled.append(region)
    return {"status": "cancelled", "regions": cancelled}


def start_flood_analysis(bbox, start_date, end_date, requested_region_name, client_id=None):
    return start_nisar_analysis(bbox, start_date, end_date, requested_region_name, client_id)


def start_nisar_forest_analysis(bbox, start_date, end_date, requested_region_name,
                                client_id=None, hv_threshold_db=-13):
    if (isinstance(hv_threshold_db, bool) or not isinstance(hv_threshold_db, (int, float))
            or not math.isfinite(hv_threshold_db) or not -40 <= hv_threshold_db <= 0):
        raise ValueError("Choose an HV threshold between −40 and 0 dB.")
    return start_nisar_analysis(bbox, start_date, end_date, requested_region_name,
                                client_id, mission="forest", hv_threshold_db=hv_threshold_db)


def start_nisar_analysis(bbox, start_date, end_date, requested_region_name, client_id=None,
                         mission="flood", hv_threshold_db=None):
    # Validation stays lightweight so POST returns before the science imports.
    if (not isinstance(bbox, list) or len(bbox) != 4
            or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in bbox)
            or not (-180 <= bbox[0] < bbox[2] <= 180 and -85 <= bbox[1] < bbox[3] <= 85)):
        raise ValueError("Draw a valid region between 85°S and 85°N without crossing the date line.")
    try:
        start, end = datetime.date.fromisoformat(start_date), datetime.date.fromisoformat(end_date)
    except (TypeError, ValueError):
        raise ValueError("Enter valid start and end dates as YYYY-MM-DD.") from None
    if start >= end:
        raise ValueError("End date must be after start date.")
    if end.isoformat() < "2025-07-30":
        raise ValueError("NISAR launched on July 30, 2025. Choose a period after launch; there are no 2024 NISAR observations.")
    if end > datetime.datetime.now(datetime.timezone.utc).date():
        raise ValueError("End date cannot be in the future.")
    slug = re.sub(r"[^a-z0-9_]", "_", str(requested_region_name).lower())[:80] or "custom_roi"
    region_name = f"{mission}_{slug}_{time.time_ns()}"
    if client_id is not None:
        cancel_flood_analysis(client_id)
    response = dict(success=True, mission=mission, source="NISAR_L2_GCOV", region=region_name,
                    bbox=bbox, start_date=start_date, end_date=end_date,
                    status="running", metrics_ready=False, acquisition_series=[])
    if mission == "forest":
        response["hv_threshold_db"] = hv_threshold_db
    with ANALYSIS_JOBS_LOCK:
        ANALYSIS_JOBS[region_name] = dict(status="running", error=None, started_at=time.time(),
                                         metrics=None, bbox=bbox, mission=mission,
                                         start_date=start_date, end_date=end_date,
                                         client_id=client_id, cancel_event=threading.Event(),
                                         updated_at=time.time(),
                                         progress=dict(stage="starting", message="Starting NISAR region analysis…"))
    target = background_nisar_forest_pipeline if mission == "forest" else background_nisar_flood_pipeline
    args = (bbox, start_date, end_date, region_name)
    if mission == "forest":
        args += (hv_threshold_db,)
    threading.Thread(target=target, args=args, daemon=True).start()
    return response


def background_nisar_forest_pipeline(bbox, start_date, end_date, region_name, hv_threshold_db):
    background_nisar_flood_pipeline(bbox, start_date, end_date, region_name,
                                    mission="forest", hv_threshold_db=hv_threshold_db)


def background_nisar_flood_pipeline(bbox, start_date, end_date, region_name,
                                     mission="flood", hv_threshold_db=None):
    def progress(stage, message, **counts):
        with ANALYSIS_JOBS_LOCK:
            job = ANALYSIS_JOBS[region_name]
            if job["status"] != "running":
                return
            job.update(progress=dict(stage=stage, message=message, **counts), updated_at=time.time())
        print(f"[NISAR] {region_name}: {stage}: {message}", flush=True)
    try:
        out_dir = os.path.join(DIRECTORY, "public", "data", region_name)
        kwargs = dict(
            bbox=bbox, start_date=start_date, end_date=end_date, region_name=region_name,
            output_dir=out_dir, cache_dir=os.path.join(DIRECTORY, ".cache", "nisar"))
        if mission == "forest":
            kwargs.update(analysis_kind="forest", hv_threshold_db=hv_threshold_db)
        metrics = run_flood_process(kwargs, progress, ANALYSIS_JOBS[region_name]["cancel_event"])
        if (metrics.get("region") != region_name or metrics.get("bbox") != bbox
                or metrics.get("source") != "NISAR_L2_GCOV"
                or metrics.get("start_date") != start_date or metrics.get("end_date") != end_date
                or len(metrics.get("acquisition_series", [])) < 2):
            raise ValueError(f"NISAR returned incomplete or mismatched {mission} measurements.")
        if mission == "forest" and (metrics.get("mission") != "forest"
                or metrics.get("method", {}).get("hv_threshold_db") != hv_threshold_db):
            raise ValueError("NISAR forest measurements do not match the selected method.")
        dates = []
        for row in metrics["acquisition_series"]:
            date = datetime.date.fromisoformat(row["date"]).isoformat()
            if not start_date <= date <= end_date:
                raise ValueError("NISAR returned an acquisition outside the requested dates.")
            dates.append(date)
            filename = row["image"]
            if os.path.basename(filename) != filename or not filename.endswith(".png"):
                raise ValueError("NISAR returned an invalid image filename.")
            if not os.path.isfile(os.path.join(out_dir, filename)):
                raise ValueError(f"A NISAR {mission} map could not be exported.")
            if mission == "forest" and any(not isinstance(row.get(key), (int, float))
                    or not math.isfinite(row[key]) for key in ("forest_area_km2", "loss_km2")):
                raise ValueError("NISAR returned invalid forest measurements.")
            row["image_url"] = f"/public/data/{region_name}/{filename}"
        if dates != sorted(set(dates)):
            raise ValueError("NISAR acquisition dates must be unique and chronological.")
        metrics.update(status="complete", metrics_ready=True)
        exports = (("csv", "metrics.csv"), ("geotiff", "forest.tif")) if mission == "forest" else (
            ("csv", "metrics.csv"), ("geotiff", "flood.tif"), ("duration", "flood_duration.tif"))
        metrics["downloads"] = {key: f"/public/data/{region_name}/{name}" for key, name in exports}
        with ANALYSIS_JOBS_LOCK:
            job = ANALYSIS_JOBS[region_name]
            if job["status"] == "running":
                job.update(status="complete", metrics=metrics, error=None)
    except Exception as exc:
        message = ("NISAR dependencies are missing. Install requirements.txt and restart server.py."
                   if isinstance(exc, ImportError) else str(exc))
        print(f"[NISAR] Analysis failed for {region_name}: {message}")
        with ANALYSIS_JOBS_LOCK:
            job = ANALYSIS_JOBS[region_name]
            if job["status"] == "running":
                job.update(status="cancelled" if isinstance(exc, AnalysisCancelled) else "error",
                           error=None if isinstance(exc, AnalysisCancelled) else message, metrics=None)


def calculate_geodetic_area_km2(bbox):
    """Approximate selected rectangle area; this is not a forest measurement."""
    min_lon, min_lat, max_lon, max_lat = bbox
    radius_km = 6371.0
    height = math.radians(max_lat - min_lat) * radius_km
    width = math.radians(max_lon - min_lon) * radius_km * math.cos(
        math.radians((min_lat + max_lat) / 2.0))
    return round(height * width, 2)


def pending_analysis(bbox, year, region_name):
    """Return dates and selection geometry, without inventing forest metrics."""
    series = []
    for month in range(1, 13):
        first = datetime.date(year, month, 1)
        last = datetime.date(year, month, calendar.monthrange(year, month)[1])
        series.append({
            "month_num": month,
            "month_label": first.strftime("%b %Y"),
            "start_date": first.isoformat(),
            "end_date": last.isoformat(),
            "forest_area_km2": None,
            "loss_speed_km2_month": None,
            "image": f"{region_name}_{year}_{month:02d}.png",
            "image_url": None,
            "bounds": [[bbox[1], bbox[0]], [bbox[3], bbox[2]]]
        })
    return {
        "success": True, "status": "running", "metrics_ready": False,
        "source": "COPERNICUS/S1_GRD", "region": region_name,
        "bbox": bbox, "year": year, "orbit_pass": None,
        "total_region_area_km2": calculate_geodetic_area_km2(bbox),
        "baseline_jan_forest_km2": None, "final_dec_forest_km2": None,
        "total_forest_lost_km2": None, "net_loss_percentage": None,
        "peak_logging_month": None, "peak_monthly_loss_km2": None,
        "monthly_series": series
    }


def start_analysis(bbox, year, requested_region_name):
    if (not isinstance(bbox, list) or len(bbox) != 4
            or any(isinstance(v, bool) or not isinstance(v, (int, float))
                   or not math.isfinite(v) for v in bbox)):
        raise ValueError("Select a valid geographic rectangle.")
    west, south, east, north = bbox
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("The selected rectangle is outside valid geographic bounds.")
    if not 2014 <= year <= datetime.date.today().year:
        raise ValueError("Choose a year covered by Sentinel-1 (2014 to the current year).")
    slug = re.sub(r"[^a-z0-9_]", "_", str(requested_region_name).lower())[:100] or "custom_roi"
    region_name = f"{slug}_{time.time_ns()}"
    response = pending_analysis(bbox, year, region_name)
    with ANALYSIS_JOBS_LOCK:
        ANALYSIS_JOBS[region_name] = {
            "status": "running", "error": None, "started_at": time.time(),
            "metrics": None, "bbox": bbox, "year": year
        }
    # Keep previous runs intact: another tab may still be displaying them.
    threading.Thread(
        target=background_earth_engine_pipeline,
        args=(bbox, year, region_name), daemon=True
    ).start()
    return response


def background_earth_engine_pipeline(bbox, year, region_name):
    """Publish measurements and thumbnails from the same Earth Engine run."""
    try:
        import pipeline
        out_dir = os.path.join(DIRECTORY, "public", "data", region_name)
        os.makedirs(out_dir, exist_ok=True)
        metrics = pipeline.analyze_forest_region(
            bbox=bbox, year=year, region_name=region_name,
            output_dir=out_dir, quiet=True
        )
        metrics = dict(metrics)
        if (metrics.get("region") != region_name or metrics.get("bbox") != bbox
                or metrics.get("year") != year
                or metrics.get("source") != "COPERNICUS/S1_GRD"
                or len(metrics.get("monthly_series", [])) != 12):
            raise ValueError("Satellite analysis returned incomplete or mismatched measurements.")
        for record in metrics["monthly_series"]:
            filename = record["image"]
            record["image_url"] = (
                f"/public/data/{region_name}/{filename}"
                if os.path.isfile(os.path.join(out_dir, filename)) else None
            )
        metrics.update({"metrics_ready": True, "status": "complete"})
        # Browser responses contain web URLs, never filesystem paths.
        metrics.pop("metrics_json_path", None)
        metrics.pop("metrics_csv_path", None)
        with ANALYSIS_JOBS_LOCK:
            ANALYSIS_JOBS[region_name].update(
                status="complete", error=None, metrics=metrics)
    except Exception as exc:
        print(f"[Background GEE] Analysis failed for {region_name}: {exc}")
        with ANALYSIS_JOBS_LOCK:
            ANALYSIS_JOBS[region_name].update(
                status="error", error=str(exc), metrics=None)


def analysis_status(region_name):
    """Return images and measured metrics for exactly the requested run."""
    if not re.fullmatch(r"[a-z0-9_]+", region_name):
        raise ValueError("Invalid analysis identifier.")
    with ANALYSIS_JOBS_LOCK:
        job = dict(ANALYSIS_JOBS.get(region_name, {}))
    if not job:
        return {
            "region": region_name, "status": "error", "metrics_ready": False,
            "error": "This analysis is no longer active. Select the region again.",
            "metrics": None, "images": []
        }
    region_dir = os.path.join(DIRECTORY, "public", "data", region_name)
    images = []
    if os.path.isdir(region_dir):
        for filename in sorted(os.listdir(region_dir)):
            file_path = os.path.join(region_dir, filename)
            if (filename.endswith(".png")
                    and os.path.getmtime(file_path) >= job["started_at"]):
                images.append({
                    "filename": filename,
                    "image_url": f"/public/data/{region_name}/{filename}"
                })
    metrics = job.get("metrics")
    return {
        "region": region_name, "status": job["status"], "error": job["error"],
        "metrics_ready": metrics is not None, "metrics": metrics,
        "images": images, "progress": job.get("progress"),
        "elapsed_seconds": round(time.time() - job["started_at"]),
        "stage_elapsed_seconds": round(time.time() - job.get("updated_at", job["started_at"])),
        "bbox": job.get("bbox"), "start_date": job.get("start_date"), "end_date": job.get("end_date")
    }


class ThreadingObservatoryHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/analyze/status':
            region_name = parse_qs(parsed.query).get('region_name', ['custom_roi'])[0]
            try:
                status = analysis_status(region_name)
            except ValueError as exc:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(exc)}).encode("utf-8"))
                return
            response_bytes = json.dumps(status).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response_bytes)))
            self.end_headers()
            self.wfile.write(response_bytes)
            return
        return super().do_GET()

    def do_POST(self):
        if self.path == '/api/forest/nisar/analyze':
            try:
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 16384:
                    raise ValueError("Invalid analysis request size.")
                data = json.loads(self.rfile.read(length).decode('utf-8'))
                result = start_nisar_forest_analysis(data.get('bbox'), data.get('start_date'),
                    data.get('end_date'), data.get('region_name', 'custom_roi'),
                    data.get('client_id'), data.get('hv_threshold_db', -13))
                payload = json.dumps(result).encode('utf-8')
                self.send_response(202)
            except (ValueError, TypeError, AttributeError) as exc:
                payload = json.dumps({"error": str(exc)}).encode('utf-8')
                self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path in ('/api/flood/cancel', '/api/nisar/cancel'):
            try:
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 16384:
                    raise ValueError("Invalid cancellation request size.")
                data = json.loads(self.rfile.read(length).decode('utf-8'))
                result = cancel_flood_analysis(data.get('client_id'), data.get('region_name'))
                payload = json.dumps(result).encode('utf-8')
                self.send_response(200)
            except (ValueError, TypeError, AttributeError) as exc:
                payload = json.dumps({"error": str(exc)}).encode('utf-8')
                self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path == '/api/flood/analyze':
            try:
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 16384:
                    raise ValueError("Invalid analysis request size.")
                data = json.loads(self.rfile.read(length).decode('utf-8'))
                result = start_flood_analysis(data.get('bbox'), data.get('start_date'),
                                              data.get('end_date'), data.get('region_name', 'custom_roi'), data.get('client_id'))
                payload = json.dumps(result).encode('utf-8')
                self.send_response(202)
            except (ValueError, TypeError, AttributeError) as exc:
                payload = json.dumps({"error": str(exc)}).encode('utf-8')
                self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path == '/api/analyze':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            
            try:
                data = json.loads(body.decode('utf-8'))
                bbox = data.get('bbox', [-63.35, -9.85, -62.85, -9.35])
                year = int(data.get('year', 2025))
                requested_region_name = data.get('region_name', 'custom_roi')
                results = start_analysis(bbox, year, requested_region_name)

                response_bytes = json.dumps(results, indent=2).encode('utf-8')
                self.send_response(202)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_bytes)))
                self.end_headers()
                self.wfile.write(response_bytes)
                return
            except Exception as e:
                err_bytes = json.dumps({"error": str(e)}).encode('utf-8')
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(err_bytes)
                return
        
        self.send_response(404)
        self.end_headers()


if __name__ == '__main__':
    PORT = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    # ThreadingHTTPServer handles every request on a separate thread
    server = http.server.ThreadingHTTPServer(("", PORT), ThreadingObservatoryHandler)
    server.daemon_threads = True
    print("=" * 65)
    print("  🛰️  AERO-WATCH: Multi-Threaded Observatory Server")
    print("=" * 65)
    print(f"  • Frontend App:     http://localhost:{PORT}/public/index.html")
    print(f"  • API Analyze:      http://localhost:{PORT}/api/analyze")
    print("  Press Ctrl+C to stop.")
    print("=" * 65)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer shutting down.")
