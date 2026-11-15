"""Create three measured, saved forest examples for each radar source.

Start server.py first, then run with the project's Python environment. The
catalog is replaced only after all six jobs and their output files are ready.
"""
import argparse
import datetime
import json
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
AREAS = [
    dict(id="amazon", name="Amazon · Rondônia, Brazil", bbox=[-63.15, -9.65, -63.03, -9.53]),
    dict(id="congo", name="Congo · Mai-Ndombe, DR Congo", bbox=[18.30, -2.40, 18.42, -2.28]),
    dict(id="borneo", name="Borneo · Central Kalimantan, Indonesia", bbox=[114.20, -1.10, 114.32, -0.98]),
]


def request(base, path, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(base + path, data=body,
        headers={"Content-Type": "application/json"} if body else {})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def build(base, timeout=900):
    catalog = {"sentinel1": [], "nisar": []}
    pending = []
    state_file = ROOT / ".cache" / "forest-examples-build.json"
    state_file.parent.mkdir(parents=True, exist_ok=True)
    for source in catalog:
        for area in AREAS:
            example = dict(area, id=f"{source}_{area['id']}", source=source)
            payload = dict(bbox=area["bbox"], region_name=f"example_{area['id']}")
            if source == "sentinel1":
                example["year"] = payload["year"] = 2025
                endpoint = "/api/analyze"
            else:
                example.update(start_date="2026-09-01", end_date="2026-10-31", hv_threshold_db=-13)
                payload.update(start_date=example["start_date"], end_date=example["end_date"],
                    hv_threshold_db=-13, client_id=f"examples_{area['id']}_{time.time_ns()}")
                endpoint = "/api/forest/nisar/analyze"
            response = request(base, endpoint, payload)
            example["region"] = response["region"]
            example["metrics_url"] = f"/public/data/{response['region']}/metrics.json"
            catalog[source].append(example)
            pending.append(example)
            state_file.write_text(json.dumps(catalog, indent=2) + "\n")
            print(f"Started {example['id']}: {example['region']}", flush=True)
    started = time.monotonic()
    stages = {}
    while pending:
        if time.monotonic() - started > timeout:
            raise TimeoutError(f"Example generation exceeded {timeout} seconds; job identifiers are in {state_file}.")
        for example in pending[:]:
            status = request(base, f"/api/analyze/status?region_name={example['region']}")
            stage = status.get("progress") or {}
            message = stage.get("message", status["status"])
            if stages.get(example["id"]) != message:
                print(f"{example['id']}: {message}", flush=True)
                stages[example["id"]] = message
            if status["status"] in ("error", "cancelled"):
                raise RuntimeError(f"{example['id']}: {status.get('error') or status['status']}")
            if status["status"] != "complete":
                continue
            metrics = status["metrics"]
            out = ROOT / "public" / "data" / example["region"]
            series = metrics.get("monthly_series") if example["source"] == "sentinel1" else metrics.get("acquisition_series")
            expected = "COPERNICUS/S1_GRD" if example["source"] == "sentinel1" else "NISAR_L2_GCOV"
            if (not status["metrics_ready"] or metrics.get("source") != expected
                    or metrics.get("bbox") != example["bbox"] or not series
                    or (example["source"] == "sentinel1" and len(series) != 12)
                    or (example["source"] == "nisar" and len(series) < 2)
                    or any(not (out / row["image"]).is_file() for row in series)):
                raise RuntimeError(f"Incomplete measured example: {example['id']}")
            if example["source"] == "nisar" and not (out / "forest.tif").is_file():
                raise RuntimeError(f"Missing vegetation GeoTIFF: {example['id']}")
            example["observation_count"] = len(series)
            example["saved_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            pending.remove(example)
            print(f"READY {example['id']}: {len(series)} observations", flush=True)
        if pending:
            time.sleep(3)
    content = "/* Saved, measured forest examples. Rebuild with scripts/build_forest_examples.py. */\n"
    content += "globalThis.ForestExamples = " + json.dumps(catalog, indent=2, ensure_ascii=False) + ";\n"
    path = ROOT / "public" / "forest-examples.js"
    temporary = path.with_suffix(".js.tmp")
    temporary.write_text(content)
    temporary.replace(path)
    state_file.write_text(json.dumps(catalog, indent=2) + "\n")
    print(f"Saved all six examples to {path}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()
    build(args.base_url.rstrip("/"), args.timeout)
