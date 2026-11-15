"""Run each NISAR analysis in an isolated, cancellable worker process."""
import multiprocessing
import time


class AnalysisCancelled(RuntimeError):
    pass


def _worker(connection, kwargs):
    try:
        connection.send({"kind": "progress", "stage": "starting",
                         "message": "Preparing NISAR region analysis…"})
        kwargs = dict(kwargs)
        analysis_kind = kwargs.pop("analysis_kind", "flood")
        if analysis_kind == "forest":
            from nisar_forest_pipeline import analyze_forest_region as analyze
        elif analysis_kind == "flood":
            from flood_pipeline import analyze_flood_region as analyze
        else:
            raise ValueError("Unknown NISAR analysis kind.")

        def progress(stage, message, **details):
            connection.send(dict(kind="progress", stage=stage, message=message, **details))

        metrics = analyze(**kwargs, progress=progress)
        connection.send({"kind": "result", "metrics": metrics})
    except Exception as exc:
        message = ("NISAR dependencies are missing. Install requirements.txt and restart server.py."
                   if isinstance(exc, ImportError) else str(exc))
        connection.send({"kind": "error", "error": message})
    finally:
        connection.close()


def run_flood_process(kwargs, progress, cancelled, idle_timeout=120, total_timeout=900, worker=_worker):
    """Bound stalls in native/network calls and terminate workers on cancellation.

    A separate process gives earthaccess its own authentication state. A slow or
    stopped transfer cannot hold a lock shared by other browser sessions.
    """
    context = multiprocessing.get_context("spawn")
    receive, send = context.Pipe(duplex=False)
    process = context.Process(target=worker, args=(send, kwargs), daemon=True)
    started = updated = time.monotonic()
    stage = "starting"
    try:
        process.start()
        send.close()
        while True:
            if cancelled.is_set():
                raise AnalysisCancelled("NISAR analysis cancelled.")
            now = time.monotonic()
            if now - updated > idle_timeout:
                raise TimeoutError(f"NISAR {stage} stopped responding for {idle_timeout:g} seconds. Try a shorter date range or another region.")
            if now - started > total_timeout:
                raise TimeoutError(f"NISAR analysis exceeded {total_timeout:g} seconds. Shorten the date range or draw a smaller region.")
            if receive.poll(.25):
                try:
                    message = receive.recv()
                except EOFError:
                    raise RuntimeError("NISAR worker stopped before returning measurements.") from None
                updated = time.monotonic()
                kind = message.pop("kind")
                if kind == "progress":
                    stage = message["stage"]
                    progress(**message)
                elif kind == "result":
                    return message["metrics"]
                else:
                    raise RuntimeError(message.get("error", "NISAR processing failed."))
            elif not process.is_alive():
                raise RuntimeError("NISAR worker stopped before returning measurements.")
    finally:
        receive.close()
        send.close()
        if process.pid is not None:
            if process.is_alive():
                process.terminate()
            process.join(timeout=2)
            if process.is_alive():
                process.kill()
                process.join(timeout=2)
            process.close()
