"""NISAR science and API regressions using small, local HDF5 observations."""
import datetime as dt
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import h5py
import numpy as np
from PIL import Image
from pyproj import Transformer
import rasterio

import flood_pipeline as flood
import server


def granule(date, frame="165", track="114", bbox=(32.5, -25.5, 33.8, -24.0)):
    west, south, east, north = bbox
    name = f"NISAR_L2_PR_GCOV_001_{track}_A_{frame}_4005_DHDH_A_{date}T000000"
    return {"meta": {"native-id": name}, "umm": {"SpatialExtent": {"HorizontalSpatialDomain": {
        "Geometry": {"GPolygons": [{"Boundary": {"Points": [
            {"Longitude": x, "Latitude": y} for x, y in
            [(west, south), (east, south), (east, north), (west, north)]]}}]}}}}}


class FloodPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="nisar-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_dates_and_bbox_are_validated_before_processing(self):
        good = [32.5, -25.5, 33.8, -24]
        for start, end in [(None, None), ("2025-10-02", "2025-10-01"),
                           ("2025-10-01", "2025-10-01"), ("2025-02-30", "2025-03-01"),
                           ("2025-10-01", "2999-01-01")]:
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                flood.validate_selection(good, start, end)
        for bbox in [[0, 0, 0, 1], [170, 0, -170, 1], [0, 85, 1, 89], [float('nan'), 0, 1, 1]]:
            with self.subTest(bbox=bbox), self.assertRaises(ValueError):
                flood.validate_selection(bbox, "2025-10-01", "2025-11-01")

    def test_stack_deduplicates_dates_without_mixing_frames(self):
        rows = [granule("20251013"), granule("20251001"), granule("20251001"),
                granule("20251025", frame="166")]
        selected = flood.choose_stack(rows, [32.6, -25.4, 33, -24.5])
        self.assertEqual([r["date"] for r in selected], ["2025-10-01", "2025-10-13"])
        self.assertEqual({r["frame"] for r in selected}, {"165"})
        with self.assertRaisesRegex(ValueError, "at least two"):
            flood.choose_stack([granule("20251001")], [32.6, -25.4, 33, -24.5])

    def test_stack_selection_rejects_single_polarization_before_remote_access(self):
        single = []
        for date in ['20251001', '20251013', '20251025']:
            row = granule(date, track='001')
            row['meta']['native-id'] = row['meta']['native-id'].replace('DHDH', 'SHNA')
            single.append(row)
        chosen = flood.choose_stack(single + [granule('20251001'), granule('20251013')],
                                    [32.6, -25.4, 33, -24.5])
        self.assertEqual({row['track'] for row in chosen}, {'114'})
        self.assertTrue(all(row['polarization'] == 'DHDH' for row in chosen))

    def test_new_water_uses_valid_baseline_and_excludes_ocean_and_noise(self):
        hh = np.full((3, 12, 12), -8., dtype='float32')
        hv = np.full_like(hh, -16.)
        # Existing water, a new 16-pixel patch, a 1-pixel noise patch, ocean.
        for a in (hh, hv):
            a[:, 0:2, 0:2] = -30
            a[1:, 4:8, 4:8] = -30
            a[1:, 10, 10] = -30
            a[1:, 0:4, 8:12] = -30
            a[0, 4, 4] = np.nan
        land = np.ones((12, 12), dtype=bool)
        land[:4, 8:12] = False
        water, detected, valid = flood.detect_flood(hh, hv, land)
        self.assertEqual(detected[0].sum(), 0)
        self.assertEqual(detected[1].sum(), 15)
        self.assertFalse(detected[1, 10, 10])
        self.assertFalse(valid[4, 4])
        self.assertFalse(detected[:, :4, 8:12].any())
        self.assertTrue(water[0, 0, 0])
        self.assertFalse(detected[:, :2, :2].any())

    def make_hdf(self, index, *, shifted=False, hv=True):
        path = self.root / f"acquisition-{index}.h5"
        with h5py.File(path, 'w') as handle:
            group = handle.create_group(flood.GRP)
            group['projection'] = 32736
            group['xCoordinates'] = 500005 + np.arange(64) * 10 + (10 if shifted else 0)
            group['yCoordinates'] = 7300635 - np.arange(64) * 10
            hh_power = np.full((64, 64), .1, dtype='float32')
            hv_power = np.full((64, 64), .02, dtype='float32')
            if index:
                hh_power[16:40, 16:40] = .001
                hv_power[16:40, 16:40] = .001
            group['HHHH'] = hh_power
            if hv:
                group['HVHV'] = hv_power
        return path

    def test_end_to_end_hdf_to_georeferenced_maps_and_measured_areas(self):
        paths = [self.make_hdf(i) for i in range(2)]
        to_ll = Transformer.from_crs(32736, 4326, always_xy=True)
        west, south = to_ll.transform(500000, 7300000)
        east, north = to_ll.transform(500640, 7300640)
        bbox = [west, south, east, north]
        selected = [dict(date=d, track='114', direction='A', frame='165', mode='4005', coverage=1)
                    for d in ['2025-10-01', '2025-10-13']]
        with patch.object(flood, 'fetch_stack', return_value=(paths, selected, 'fixture_GCOV')), \
             patch.object(flood, 'land_mask', side_effect=lambda grid, bbox: np.ones(grid['shape'], bool)):
            result = flood.analyze_flood_region(bbox, '2025-10-01', '2025-10-31', 'run', self.root / 'out', self.root / 'cache')
        self.assertAlmostEqual(result['peak_flood_km2'], 36 * .0016, places=4)
        self.assertEqual(result['acquisition_series'][0]['flood_area_km2'], 0)
        self.assertEqual(result['baseline_date'], '2025-10-01')
        self.assertEqual(result['peak_flood_date'], '2025-10-13')
        for row in result['acquisition_series']:
            with Image.open(self.root / 'out' / row['image']) as image:
                self.assertEqual(image.mode, 'RGBA')
                if row['flood_area_km2']:
                    self.assertTrue(np.any(np.all(np.asarray(image)[:, :, :3] == [245, 88, 67], axis=-1)))
            self.assertLess(row['bounds'][0][0], row['bounds'][1][0])
        with rasterio.open(self.root / 'out' / 'flood.tif') as dataset:
            self.assertEqual(dataset.crs.to_epsg(), 32736)
            self.assertEqual(dataset.descriptions, ('2025-10-01', '2025-10-13'))
            self.assertEqual(dataset.read(2).sum(), 36)
        json.loads((self.root / 'out' / 'metrics.json').read_text())
        self.assertTrue((self.root / 'out' / 'metrics.csv').is_file())

    def test_land_mask_reads_coastline_and_clips_to_selected_region(self):
        import shapefile
        with shapefile.Writer(str(self.root / 'land')) as writer:
            writer.field('kind', 'C')
            writer.poly([[(32.5, -25.5), (32.5, -24), (33.8, -24), (33.8, -25.5), (32.5, -25.5)]])
            writer.record('land')
        path = self.make_hdf(0)
        to_ll = Transformer.from_crs(32736, 4326, always_xy=True)
        west, south = to_ll.transform(500000, 7300000)
        east, north = to_ll.transform(500640, 7300640)
        bbox = [west, south, east, north]
        grid = flood.read_grid(path, bbox)
        with patch('cartopy.io.shapereader.natural_earth', return_value=str(self.root / 'land.shp')):
            mask = flood.land_mask(grid, bbox)
        self.assertEqual(mask.shape, grid['shape'])
        self.assertTrue(mask.any())

    def test_catalog_fallback_selects_streams_without_full_file_downloads(self):
        rows = [granule('20251013'), granule('20251001')]
        import earthaccess
        progress = Mock()
        with patch.object(flood, 'login_earthdata'), \
             patch.object(earthaccess, 'search_data', side_effect=[[], rows]) as search, \
             patch.object(earthaccess, 'download') as download:
            found, selected, collection = flood.fetch_stack([32.6, -25.4, 33, -24.5],
                '2024-01-01', '2025-10-31', self.root / 'cache', progress)
        self.assertEqual(collection, 'NISAR_L2_GCOV_PROVISIONAL_V1')
        self.assertTrue(all(isinstance(item, flood.RemoteAcquisition) for item in found))
        self.assertEqual([row['date'] for row in selected], ['2025-10-01', '2025-10-13'])
        self.assertEqual(search.call_args.kwargs['temporal'], ('2025-07-30', '2025-10-31'))
        self.assertEqual(search.call_args.kwargs['bounding_box'], (32.6, -25.4, 33, -24.5))
        download.assert_not_called()
        self.assertEqual(progress.call_args_list[0].args[0], 'authenticating')

    def test_remote_region_read_closes_stream_and_uses_bounded_block_cache(self):
        path = self.make_hdf(0)
        stream = open(path, 'rb')
        import earthaccess
        with patch.object(earthaccess, 'open', return_value=[stream]) as remote:
            with flood.open_acquisition(flood.RemoteAcquisition(granule('20251001'))) as handle:
                self.assertEqual(handle[flood.GRP + 'HHHH'].shape, (64, 64))
                self.assertEqual(handle[flood.GRP + 'HHHH'][0:4, 0:4].shape, (4, 4))
        self.assertTrue(stream.closed)
        self.assertEqual(remote.call_args.kwargs['open_kwargs']['cache_type'], 'blockcache')
        self.assertEqual(remote.call_args.kwargs['open_kwargs']['cache_options']['maxblocks'], 8)

    def test_multilooking_averages_linear_power_before_db(self):
        path = self.make_hdf(0)
        with h5py.File(path, 'r+') as handle:
            values = handle[flood.GRP + 'HHHH'][:]
            values[:4, :4] = np.tile([1., 1., .01, .01], (4, 1))
            handle[flood.GRP + 'HHHH'][:] = values
        grid = dict(shape=(1, 1), multilook=4, rows=4, cols=4, row0=0, col0=0,
                    epsg=32736, x=500005 + np.arange(64)*10, y=7300635 - np.arange(64)*10)
        actual = flood.read_multilooked(path, grid, 'HHHH')
        self.assertAlmostEqual(float(actual[0, 0]), 10 * np.log10(.505), places=5)
        with self.assertRaisesRegex(ValueError, 'different grids'):
            flood.read_multilooked(self.make_hdf(1, shifted=True), grid, 'HHHH')
        with self.assertRaisesRegex(ValueError, 'real HH and HV'):
            flood.read_multilooked(self.make_hdf(2, hv=False), grid, 'HVHV')

    def test_background_authentication_never_prompts(self):
        client = Mock()
        client.login.return_value.authenticated = False
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(RuntimeError, 'Earthdata login'):
            flood.login_earthdata(client)
        client.login.assert_called_once_with(strategy='netrc')


class FloodAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='flood-api-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root_patch = patch.object(server, 'DIRECTORY', self.temp.name)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.bbox = [32.5, -25.5, 33.8, -24.0]
        server.ANALYSIS_JOBS.clear()

    def start(self):
        with patch.object(server.threading, 'Thread'):
            return server.start_flood_analysis(self.bbox, '2025-10-01', '2025-10-31', 'Custom ROI')

    def test_rejects_invalid_dates_before_starting_worker(self):
        with patch.object(server.threading, 'Thread') as thread:
            with self.assertRaisesRegex(ValueError, 'End date'):
                server.start_flood_analysis(self.bbox, '2025-10-31', '2025-10-01', 'region')
            thread.assert_not_called()

    def test_api_returns_202_with_region_and_dates_and_no_fabricated_metrics(self):
        handler = object.__new__(server.ThreadingObservatoryHandler)
        payload = json.dumps(dict(bbox=self.bbox, start_date='2025-10-01', end_date='2025-10-31')).encode()
        handler.path = '/api/flood/analyze'
        handler.headers = {'Content-Length': str(len(payload))}
        handler.rfile, handler.wfile = io.BytesIO(payload), io.BytesIO()
        handler.send_response, handler.send_header, handler.end_headers = Mock(), Mock(), Mock()
        with patch.object(server.threading, 'Thread'):
            handler.do_POST()
        handler.send_response.assert_called_once_with(202)
        result = json.loads(handler.wfile.getvalue())
        self.assertEqual(result['source'], 'NISAR_L2_GCOV')
        self.assertFalse(result['metrics_ready'])
        self.assertEqual(result['acquisition_series'], [])
        self.assertEqual(result['start_date'], '2025-10-01')

    def test_complete_run_publishes_web_urls_and_error_does_not_fallback(self):
        pending = self.start()
        region = pending['region']
        out = self.root / 'public' / 'data' / region
        out.mkdir(parents=True)
        rows = []
        for date in ['2025-10-01', '2025-10-13']:
            filename = f'flood_{date}.png'
            (out / filename).write_bytes(b'image-fixture')
            rows.append(dict(date=date, image=filename))
        metrics = dict(pending, acquisition_series=rows)
        with patch.object(server, 'run_flood_process', return_value=metrics):
            server.background_nisar_flood_pipeline(self.bbox, pending['start_date'], pending['end_date'], region)
        status = server.analysis_status(region)
        self.assertEqual(status['status'], 'complete')
        self.assertTrue(status['metrics_ready'])
        self.assertTrue(status['metrics']['acquisition_series'][0]['image_url'].startswith('/public/data/'))
        self.assertTrue(status['metrics']['downloads']['geotiff'].endswith('/flood.tif'))
        pending = self.start()
        with patch.object(server, 'run_flood_process', side_effect=RuntimeError('No NISAR observations')):
            server.background_nisar_flood_pipeline(self.bbox, pending['start_date'], pending['end_date'], pending['region'])
        status = server.analysis_status(pending['region'])
        self.assertEqual(status['status'], 'error')
        self.assertFalse(status['metrics_ready'])
        self.assertIsNone(status['metrics'])

    def test_retry_cancels_only_the_previous_run_for_that_browser(self):
        with patch.object(server.threading, 'Thread'):
            old = server.start_flood_analysis(self.bbox, '2025-10-01', '2025-10-31', 'one', 'browser-one')
            other = server.start_flood_analysis(self.bbox, '2025-10-01', '2025-10-31', 'two', 'browser-two')
            latest = server.start_flood_analysis(self.bbox, '2025-10-01', '2025-10-31', 'three', 'browser-one')
        self.assertEqual(server.analysis_status(old['region'])['status'], 'cancelled')
        self.assertTrue(server.ANALYSIS_JOBS[old['region']]['cancel_event'].is_set())
        self.assertEqual(server.analysis_status(other['region'])['status'], 'running')
        self.assertEqual(server.analysis_status(latest['region'])['status'], 'running')
        server.cancel_flood_analysis('browser-one', latest['region'])
        self.assertEqual(server.analysis_status(latest['region'])['status'], 'cancelled')
        self.assertEqual(server.analysis_status(other['region'])['status'], 'running')

    def test_cancellation_wins_over_a_late_worker_result(self):
        with patch.object(server.threading, 'Thread'):
            pending = server.start_flood_analysis(self.bbox, '2025-10-01', '2025-10-31', 'one', 'browser-one')
        server.cancel_flood_analysis('browser-one')
        with patch.object(server, 'run_flood_process', side_effect=TimeoutError('late timeout')):
            server.background_nisar_flood_pipeline(self.bbox, pending['start_date'], pending['end_date'], pending['region'])
        self.assertEqual(server.analysis_status(pending['region'])['status'], 'cancelled')
        self.assertIsNone(server.analysis_status(pending['region'])['error'])

    def test_prelaunch_only_dates_are_rejected_without_spawning_a_worker(self):
        with patch.object(server.threading, 'Thread') as thread:
            with self.assertRaisesRegex(ValueError, 'no 2024'):
                server.start_flood_analysis(self.bbox, '2024-01-01', '2024-12-31', 'region')
            thread.assert_not_called()

    def test_wrong_period_cannot_publish_flood_measurements(self):
        pending = self.start()
        metrics = dict(pending, start_date='2025-09-01', acquisition_series=[{}, {}])
        with patch.object(server, 'run_flood_process', return_value=metrics):
            server.background_nisar_flood_pipeline(self.bbox, pending['start_date'], pending['end_date'], pending['region'])
        self.assertEqual(server.analysis_status(pending['region'])['status'], 'error')


if __name__ == '__main__':
    unittest.main()
