"""Exercise real isolated workers without Earthdata/network access."""
from concurrent.futures import ThreadPoolExecutor
import threading
import time
import unittest

from flood_jobs import AnalysisCancelled, run_flood_process


def fast_worker(connection, kwargs):
    connection.send(dict(kind='progress', stage='reading', message='Reading selected region'))
    connection.send(dict(kind='result', metrics={'region': kwargs['region']}))
    connection.close()


def stalled_worker(connection, kwargs):
    connection.send(dict(kind='progress', stage='searching', message='Searching catalog'))
    time.sleep(20)


def dead_worker(connection, kwargs):
    connection.close()


class FloodWorkerTests(unittest.TestCase):
    def test_worker_reports_progress_and_returns_results(self):
        messages = []
        result = run_flood_process({'region': 'one'}, lambda **data: messages.append(data),
                                   threading.Event(), idle_timeout=5, worker=fast_worker)
        self.assertEqual(result['region'], 'one')
        self.assertEqual(messages[0]['stage'], 'reading')

    def test_stalled_worker_is_terminated_with_a_stage_specific_timeout(self):
        with self.assertRaisesRegex(TimeoutError, 'searching stopped responding'):
            run_flood_process({}, lambda **data: None, threading.Event(),
                              idle_timeout=.5, total_timeout=5, worker=stalled_worker)

    def test_cancelled_worker_is_terminated_promptly(self):
        event = threading.Event()
        timer = threading.Timer(.5, event.set)
        timer.start()
        try:
            with self.assertRaises(AnalysisCancelled):
                run_flood_process({}, lambda **data: None, event, worker=stalled_worker)
        finally:
            timer.cancel()

    def test_stalled_run_does_not_block_another_analysis(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            stalled = pool.submit(run_flood_process, {}, lambda **data: None,
                                  threading.Event(), idle_timeout=1, worker=stalled_worker)
            fresh = pool.submit(run_flood_process, {'region': 'fresh'}, lambda **data: None,
                                threading.Event(), idle_timeout=5, worker=fast_worker)
            self.assertEqual(fresh.result(timeout=5)['region'], 'fresh')
            with self.assertRaises(TimeoutError):
                stalled.result(timeout=5)

    def test_worker_crash_does_not_leave_analysis_running(self):
        with self.assertRaisesRegex(RuntimeError, 'stopped before returning'):
            run_flood_process({}, lambda **data: None, threading.Event(), worker=dead_worker)


if __name__ == '__main__':
    unittest.main()
