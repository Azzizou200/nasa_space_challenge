import io
import json
import os
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

import server


class SatelliteAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="aero-analysis-test-")
        self.addCleanup(self.directory.cleanup)
        self.root_patch = patch.object(server, "DIRECTORY", self.directory.name)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        server.ANALYSIS_JOBS.clear()
        self.bbox = [-63.35, -9.85, -62.85, -9.35]
        self.region = "amazon_1234567890123"

    def start_pending(self):
        with patch.object(server.threading, "Thread") as thread:
            data = server.start_analysis(self.bbox, 2025, "Amazon")
            thread.return_value.start.assert_called_once()
        self.region = data["region"]
        return data

    def measurements(self):
        data = server.pending_analysis(self.bbox, 2025, self.region)
        data.update({
            "metrics_ready": True, "baseline_jan_forest_km2": 1800.2,
            "final_dec_forest_km2": 1750.1, "total_forest_lost_km2": 50.1,
            "net_loss_percentage": 2.78, "peak_monthly_loss_km2": 8.4,
            "peak_logging_month": "Mar 2025", "orbit_pass": "ASCENDING",
            "method": {"vh_threshold_db": -15.5, "scale_m": 80},
        })
        for index, item in enumerate(data["monthly_series"]):
            item.update(forest_area_km2=1800.2 - index, loss_speed_km2_month=1)
        return data

    def test_pending_never_returns_invented_forest_metrics(self):
        data = self.start_pending()
        self.assertFalse(data["metrics_ready"])
        self.assertIsNone(data["baseline_jan_forest_km2"])
        self.assertIsNone(data["net_loss_percentage"])
        self.assertEqual(len(data["monthly_series"]), 12)
        self.assertTrue(all(row["forest_area_km2"] is None for row in data["monthly_series"]))
        leap = server.pending_analysis(self.bbox, 2024, self.region)
        self.assertEqual(leap["monthly_series"][1]["end_date"], "2024-02-29")

    def test_completed_run_publishes_real_metrics_and_http_image_paths(self):
        self.start_pending()
        metrics = self.measurements()
        output = os.path.join(self.directory.name, "public", "data", self.region)

        def analyze(**kwargs):
            self.assertEqual(kwargs["bbox"], self.bbox)
            self.assertEqual(kwargs["year"], 2025)
            with open(os.path.join(output, metrics["monthly_series"][0]["image"]), "wb") as image:
                image.write(b"thumbnail-fixture")
            metrics["metrics_json_path"] = os.path.join(output, "metrics.json")
            return metrics

        with patch.dict("sys.modules", {"pipeline": types.SimpleNamespace(analyze_forest_region=analyze)}):
            server.background_earth_engine_pipeline(self.bbox, 2025, self.region)
        status = server.analysis_status(self.region)
        self.assertEqual(status["status"], "complete")
        self.assertTrue(status["metrics_ready"])
        self.assertEqual(status["metrics"]["baseline_jan_forest_km2"], 1800.2)
        self.assertEqual(status["metrics"]["orbit_pass"], "ASCENDING")
        self.assertNotIn("metrics_json_path", status["metrics"])
        self.assertTrue(status["images"][0]["image_url"].startswith("/public/data/"))
        self.assertIsNone(status["metrics"]["monthly_series"][1]["image_url"])

    def test_pipeline_failure_returns_error_without_fallback(self):
        self.start_pending()
        analyze = Mock(side_effect=RuntimeError("Earth Engine authentication unavailable"))
        with patch.dict("sys.modules", {"pipeline": types.SimpleNamespace(analyze_forest_region=analyze)}):
            server.background_earth_engine_pipeline(self.bbox, 2025, self.region)
        status = server.analysis_status(self.region)
        self.assertEqual(status["status"], "error")
        self.assertIn("authentication", status["error"])
        self.assertFalse(status["metrics_ready"])
        self.assertIsNone(status["metrics"])

    def test_wrong_region_cannot_publish_measurements(self):
        self.start_pending()
        metrics = self.measurements()
        metrics["region"] = "another_region"
        analyze = Mock(return_value=metrics)
        with patch.dict("sys.modules", {"pipeline": types.SimpleNamespace(analyze_forest_region=analyze)}):
            server.background_earth_engine_pipeline(self.bbox, 2025, self.region)
        self.assertEqual(server.analysis_status(self.region)["status"], "error")
        self.assertIsNone(server.analysis_status(self.region)["metrics"])

    def test_status_rejects_filesystem_paths(self):
        with self.assertRaises(ValueError):
            server.analysis_status("../../private")
        self.assertEqual(server.analysis_status("expired_job")["status"], "error")

    def test_invalid_selection_does_not_start_processing(self):
        with patch.object(server.threading, "Thread") as thread:
            for bbox in [[1, 2, 1, 3], [-181, 0, 5, 10], [float("nan"), 0, 1, 1]]:
                with self.assertRaises(ValueError):
                    server.start_analysis(bbox, 2025, "region")
            thread.assert_not_called()

    def test_api_returns_accepted_without_waiting_for_earth_engine(self):
        handler = object.__new__(server.ThreadingObservatoryHandler)
        body = json.dumps({"bbox": self.bbox, "year": 2025, "region_name": "Amazon"}).encode()
        handler.path = "/api/analyze"
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = io.BytesIO(body)
        handler.wfile = io.BytesIO()
        handler.send_response = Mock()
        handler.send_header = Mock()
        handler.end_headers = Mock()
        with patch.object(server.threading, "Thread"):
            handler.do_POST()
        handler.send_response.assert_called_once_with(202)
        response = json.loads(handler.wfile.getvalue())
        self.assertIsNone(response["baseline_jan_forest_km2"])
        self.assertFalse(response["metrics_ready"])


if __name__ == "__main__":
    unittest.main()
