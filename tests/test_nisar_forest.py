"""NISAR forest estimates, exports, and API routing without network access."""
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image
from pyproj import Transformer
import rasterio

import flood_jobs
import nisar_forest_pipeline as forest
import server
import test_flood_analysis as flood_fixtures


class NisarForestPipelineTests(unittest.TestCase):
    def test_cover_uses_selected_threshold_and_common_observed_land(self):
        hh = np.full((3, 3, 3), -8., dtype='float32')
        hv = np.full_like(hh, -10.)
        hv[1:, 1, 1] = -20
        hv[0, 0, 0] = np.nan
        land = np.ones((3, 3), dtype=bool)
        land[2, 2] = False
        cover, valid, areas = forest.measure_cover(hh, hv, land, .0016, -13)
        np.testing.assert_allclose(areas, np.array([7, 6, 6]) * .0016)
        self.assertFalse(valid[0, 0])
        self.assertFalse(cover[:, 2, 2].any())
        _, _, strict = forest.measure_cover(hh, hv, land, .0016, -9)
        self.assertTrue((strict == 0).all())

    def test_invalid_threshold_or_no_common_pixels_are_rejected(self):
        for threshold in [True, None, 'wrong', float('nan'), -41, 1]:
            with self.subTest(threshold=threshold), self.assertRaises(ValueError):
                forest.validate_threshold(threshold)
        values = np.full((2, 2, 2), np.nan)
        with self.assertRaisesRegex(ValueError, 'common valid land'):
            forest.measure_cover(values, values, np.ones((2, 2), bool), .0016, -13)
        with self.assertRaisesRegex(ValueError, 'at least two'):
            forest.measure_cover(values[:1], values[:1], np.ones((2, 2), bool), .0016, -13)

    def test_hdf_processing_exports_actual_dates_native_masks_and_projected_images(self):
        with tempfile.TemporaryDirectory(prefix='nisar-forest-') as directory:
            root = Path(directory)
            fixtures = flood_fixtures.FloodPipelineTests()
            fixtures.root = root
            paths = [fixtures.make_hdf(i) for i in range(2)]
            project = Transformer.from_crs(32736, 4326, always_xy=True)
            west, south = project.transform(500000, 7300000)
            east, north = project.transform(500640, 7300640)
            bbox = [west, south, east, north]
            selected = [dict(date=d, track='114', direction='A', frame='165', mode='4005', coverage=1)
                        for d in ['2025-10-01', '2025-10-13']]
            with patch.object(forest.nisar, 'fetch_stack', return_value=(paths, selected, 'fixture')), \
                 patch.object(forest.nisar, 'land_mask', side_effect=lambda grid, bbox: np.ones(grid['shape'], bool)):
                result = forest.analyze_forest_region(bbox, '2025-10-01', '2025-10-31',
                    'forest_run', root / 'out', root / 'cache', hv_threshold_db=-18)
            self.assertEqual(result['mission'], 'forest')
            self.assertEqual(result['source'], 'NISAR_L2_GCOV')
            self.assertEqual(result['baseline_date'], '2025-10-01')
            self.assertEqual(result['method']['hv_threshold_db'], -18)
            self.assertEqual(result['method']['backscatter'], 'gamma0')
            self.assertAlmostEqual(result['total_forest_lost_km2'], 36 * .0016, places=4)
            self.assertEqual(result['peak_loss_date'], '2025-10-13')
            self.assertEqual(result['acquisition_series'][0]['loss_km2'], 0)
            for row in result['acquisition_series']:
                with Image.open(root / 'out' / row['image']) as image:
                    self.assertEqual(image.mode, 'RGBA')
                self.assertLess(row['bounds'][0][0], row['bounds'][1][0])
            with rasterio.open(root / 'out' / 'forest.tif') as dataset:
                self.assertEqual(dataset.crs.to_epsg(), 32736)
                self.assertEqual(dataset.descriptions, ('2025-10-01', '2025-10-13'))
                self.assertEqual(int(dataset.read(1).sum() - dataset.read(2).sum()), 36)
            saved = json.loads((root / 'out' / 'metrics.json').read_text())
            self.assertEqual(saved['hv_threshold_db'], -18)
            self.assertIn('net_change_km2', (root / 'out' / 'metrics.csv').read_text())

    def test_zero_baseline_and_net_gain_have_defined_meanings(self):
        hh = np.full((2, 2, 2), -8.)
        hv = np.full_like(hh, -20.)
        hv[1] = -10
        _, _, areas = forest.measure_cover(hh, hv, np.ones((2, 2), bool), 1, -13)
        np.testing.assert_array_equal(areas, [0, 4])

    def test_worker_dispatches_to_forest_without_mutating_request(self):
        connection = Mock()
        request = {'analysis_kind': 'forest', 'bbox': [1, 2, 3, 4]}
        with patch.object(forest, 'analyze_forest_region', return_value={'mission': 'forest'}) as analyze:
            flood_jobs._worker(connection, request)
        self.assertEqual(analyze.call_args.kwargs['bbox'], [1, 2, 3, 4])
        self.assertNotIn('analysis_kind', analyze.call_args.kwargs)
        self.assertEqual(request['analysis_kind'], 'forest')
        self.assertEqual(connection.send.call_args.args[0]['kind'], 'result')


class NisarForestAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='forest-api-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        patcher = patch.object(server, 'DIRECTORY', self.temp.name)
        patcher.start()
        self.addCleanup(patcher.stop)
        server.ANALYSIS_JOBS.clear()
        self.bbox = [32.95, -24.56, 33.01, -24.50]

    def start(self, client='forest_browser'):
        with patch.object(server.threading, 'Thread'):
            return server.start_nisar_forest_analysis(self.bbox, '2025-10-01',
                '2025-10-31', 'custom_roi', client, -18)

    def test_api_queues_a_forest_worker_with_selected_threshold(self):
        handler = object.__new__(server.ThreadingObservatoryHandler)
        body = json.dumps(dict(bbox=self.bbox, start_date='2025-10-01',
            end_date='2025-10-31', hv_threshold_db=-18, client_id='forest_browser')).encode()
        handler.path = '/api/forest/nisar/analyze'
        handler.headers = {'Content-Length': str(len(body))}
        handler.rfile, handler.wfile = io.BytesIO(body), io.BytesIO()
        handler.send_response, handler.send_header, handler.end_headers = Mock(), Mock(), Mock()
        with patch.object(server.threading, 'Thread') as worker:
            handler.do_POST()
        handler.send_response.assert_called_once_with(202)
        data = json.loads(handler.wfile.getvalue())
        self.assertEqual(data['mission'], 'forest')
        self.assertFalse(data['metrics_ready'])
        self.assertEqual(data['acquisition_series'], [])
        self.assertEqual(worker.call_args.kwargs['target'], server.background_nisar_forest_pipeline)
        self.assertEqual(worker.call_args.kwargs['args'][-1], -18)

    def test_invalid_dates_or_threshold_never_start_workers(self):
        with patch.object(server.threading, 'Thread') as worker:
            for threshold in [True, float('inf'), -50, 'bad']:
                with self.assertRaises(ValueError):
                    server.start_nisar_forest_analysis(self.bbox, '2025-10-01', '2025-10-31', 'roi', hv_threshold_db=threshold)
            with self.assertRaisesRegex(ValueError, 'no 2024'):
                server.start_nisar_forest_analysis(self.bbox, '2024-01-01', '2024-12-31', 'roi')
            worker.assert_not_called()

    def metrics(self, pending):
        out = self.root / 'public' / 'data' / pending['region']
        out.mkdir(parents=True)
        rows = []
        for date in ['2025-10-01', '2025-10-13']:
            filename = f'forest_{date}.png'
            (out / filename).write_bytes(b'fixture')
            rows.append(dict(date=date, image=filename, forest_area_km2=10, loss_km2=0))
        return dict(pending, method={'hv_threshold_db': -18}, acquisition_series=rows)

    def test_background_publishes_only_forest_outputs(self):
        pending = self.start()
        metrics = self.metrics(pending)
        with patch.object(server, 'run_flood_process', return_value=metrics) as worker:
            server.background_nisar_forest_pipeline(self.bbox, pending['start_date'],
                pending['end_date'], pending['region'], -18)
        self.assertEqual(worker.call_args.args[0]['analysis_kind'], 'forest')
        status = server.analysis_status(pending['region'])
        self.assertEqual(status['status'], 'complete')
        self.assertTrue(status['metrics']['downloads']['geotiff'].endswith('/forest.tif'))
        self.assertNotIn('duration', status['metrics']['downloads'])
        self.assertIn('/public/data/', status['metrics']['acquisition_series'][0]['image_url'])

    def test_mismatched_threshold_or_failure_cannot_publish_results(self):
        for failed in [False, True]:
            pending = self.start()
            metrics = self.metrics(pending)
            metrics['method']['hv_threshold_db'] = -13
            with patch.object(server, 'run_flood_process', side_effect=RuntimeError('Earthdata unavailable') if failed else None, return_value=metrics):
                server.background_nisar_forest_pipeline(self.bbox, pending['start_date'],
                    pending['end_date'], pending['region'], -18)
            status = server.analysis_status(pending['region'])
            self.assertEqual(status['status'], 'error')
            self.assertIsNone(status['metrics'])

    def test_forest_retry_does_not_cancel_flood_and_cancellation_wins_late_result(self):
        with patch.object(server.threading, 'Thread'):
            flood = server.start_flood_analysis(self.bbox, '2025-10-01', '2025-10-31', 'roi', 'flood_browser')
        first, latest = self.start(), self.start()
        self.assertEqual(server.analysis_status(first['region'])['status'], 'cancelled')
        self.assertEqual(server.analysis_status(flood['region'])['status'], 'running')
        metrics = self.metrics(latest)
        server.cancel_flood_analysis('forest_browser', latest['region'])
        with patch.object(server, 'run_flood_process', return_value=metrics):
            server.background_nisar_forest_pipeline(self.bbox, latest['start_date'],
                latest['end_date'], latest['region'], -18)
        status = server.analysis_status(latest['region'])
        self.assertEqual(status['status'], 'cancelled')
        self.assertIsNone(status['metrics'])


if __name__ == '__main__':
    unittest.main()
