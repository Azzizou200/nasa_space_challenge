import json
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

try:
    import pipeline
except ModuleNotFoundError:
    pipeline = None


@unittest.skipIf(pipeline is None, "Run with .venv/bin/python for the pipeline dependencies")
class SatellitePipelineTests(unittest.TestCase):
    def fake_earth_engine(self, forest_areas, counts=None):
        earth = MagicMock()
        collection = earth.ImageCollection.return_value
        collection.filterBounds.return_value = collection
        collection.filter.return_value = collection
        collection.filterDate.return_value = collection
        collection.size.return_value.getInfo.side_effect = counts or [1] + [2] * 12
        composite = collection.median.return_value.clip.return_value
        composite.select.return_value = MagicMock()
        area = earth.Image.pixelArea.return_value.divide.return_value
        area.updateMask.return_value.reduceRegion.return_value.getInfo.side_effect = [
            {"area": value} for value in forest_areas
        ]
        area.clip.return_value.reduceRegion.return_value.getInfo.return_value = {"area": 100.0}
        earth.Image.rgb.return_value.getThumbURL.return_value = "https://example.test/thumbnail"
        return earth, collection

    def run_analysis(self, directory, forest_areas, counts=None):
        earth, collection = self.fake_earth_engine(forest_areas, counts)
        download = MagicMock(status_code=200, content=b"thumbnail-fixture")
        with patch.object(pipeline, "ee", earth), patch.object(pipeline, "init_earth_engine"), patch.object(pipeline.requests, "get", return_value=download):
            result = pipeline.analyze_forest_region(
                [-63.35, -9.85, -62.85, -9.35], 2024, "test_region",
                output_dir=directory, quiet=True,
            )
        return result, collection

    def test_output_metrics_follow_pixel_measurements_not_seasonal_assumptions(self):
        values = [80, 82, 73, 74, 72, 75, 70, 71, 69, 70, 68, 67]
        with tempfile.TemporaryDirectory(prefix="aero-pipeline-test-") as directory:
            result, collection = self.run_analysis(directory, values)
            self.assertEqual(result["source"], "COPERNICUS/S1_GRD")
            self.assertEqual(result["baseline_jan_forest_km2"], 80)
            self.assertEqual(result["total_forest_lost_km2"], 13)
            self.assertEqual(result["peak_logging_month"], "Mar 2024")
            self.assertEqual(result["peak_monthly_loss_km2"], 9)
            self.assertEqual(result["monthly_series"][1]["end_date"], "2024-02-29")
            self.assertEqual(result["monthly_series"][1]["scene_count"], 2)
            queried_dates = [args.args for args in collection.filterDate.call_args_list]
            self.assertIn(("2024-02-01", "2024-03-01"), queried_dates)
            self.assertIn(("2024-12-01", "2025-01-01"), queried_dates)
            with open(os.path.join(directory, "metrics.json")) as saved:
                self.assertEqual(json.load(saved)["peak_monthly_loss_km2"], 9)
            self.assertFalse(os.path.exists(os.path.join(directory, "metrics.json.tmp")))

    def test_missing_month_is_an_error_not_zero_forest(self):
        with tempfile.TemporaryDirectory(prefix="aero-pipeline-test-") as directory:
            with self.assertRaisesRegex(ValueError, "No Sentinel-1.*Jan 2024"):
                self.run_analysis(directory, [], [1, 0])
            self.assertFalse(os.path.exists(os.path.join(directory, "metrics.json")))

    def test_zero_baseline_produces_valid_json_and_no_invented_percentage(self):
        with tempfile.TemporaryDirectory(prefix="aero-pipeline-test-") as directory:
            result, _ = self.run_analysis(directory, [0] * 12)
            self.assertEqual(result["baseline_jan_forest_km2"], 0)
            self.assertIsNone(result["net_loss_percentage"])
            self.assertIsNone(result["peak_logging_month"])
            json.dumps(result, allow_nan=False)

    def test_background_authentication_never_opens_an_interactive_login(self):
        with patch.object(pipeline.ee, "Initialize", side_effect=RuntimeError("Not authenticated")), patch.object(pipeline.ee, "Authenticate") as authenticate, patch.object(pipeline.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "Authenticate the server"):
                pipeline.init_earth_engine(max_retries=1, interactive=False)
            authenticate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
