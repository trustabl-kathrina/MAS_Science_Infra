"""Functional contracts: SSE drain, cross-thread events, train status, monitor isolation."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import psutil

ROOT = Path(__file__).resolve().parents[2]
TIR = Path(__file__).resolve().parents[1]
for p in (str(ROOT), str(TIR)):
    if p not in sys.path:
        sys.path.insert(0, p)


class TestEventBusThread(unittest.TestCase):
    def test_publish_from_watcher_thread_reaches_subscriber(self):
        from science_infra.control.events import EventBus

        bus = EventBus()

        async def main():
            bus.bind_loop(asyncio.get_running_loop())
            agen = bus.subscribe("fn-bus").__aiter__()

            def publish() -> None:
                time.sleep(0.05)
                bus.publish("fn-bus", "train_done", {"run_id": "r1"})

            threading.Thread(target=publish, daemon=True).start()
            item = await asyncio.wait_for(agen.__anext__(), timeout=2)
            self.assertEqual(item["type"], "train_done")
            self.assertEqual(item["data"]["run_id"], "r1")

        asyncio.run(main())


class TestControlRuntime(unittest.TestCase):
    def test_tree_frames_drain_without_other_bus_events(self):
        from science_infra.control.app import create_app
        from science_infra.control.process_manager import ManagedProcess

        experiment_id = "fn-sse"
        log_path = Path("/tmp") / f"{experiment_id}-stdout.log"
        log_path.write_text(
            json.dumps({"__rollout_tree_event__": {"event": "node_added", "tree_id": "t1"}}) + "\n",
            encoding="utf-8",
        )
        process = ManagedProcess(
            run_id="fn-sse-run",
            kind="train",
            experiment_id=experiment_id,
            popen=None,
            pid=1,
            pid_create_time=0,
            pgid=None,
            command_hash="x",
            cwd="/tmp",
            log_path=log_path,
            state="running",
        )
        async def first_sse_body() -> bytes:
            app = create_app()
            chunks: list[bytes] = []
            found = asyncio.Event()

            async def receive() -> dict:
                await found.wait()
                return {"type": "http.disconnect"}

            async def send(message: dict) -> None:
                if message["type"] == "http.response.body" and message.get("body"):
                    chunks.append(message["body"])
                    if b"rollout_tree" in b"".join(chunks) and b"node_added" in b"".join(chunks):
                        found.set()

            scope = {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": "GET",
                "scheme": "http",
                "path": "/api/events",
                "raw_path": b"/api/events",
                "query_string": f"experiment_id={experiment_id}".encode(),
                "headers": [],
                "client": ("127.0.0.1", 123),
                "server": ("test", 80),
                "root_path": "",
            }
            async with app.router.lifespan_context(app):
                task = asyncio.create_task(app(scope, receive, send))
                try:
                    await asyncio.wait_for(found.wait(), timeout=3)
                finally:
                    found.set()
                    task.cancel()
                    try:
                        await task
                    except (asyncio.CancelledError, Exception):
                        pass
            return b"".join(chunks)

        with patch("science_infra.control.app.PROCS.active", side_effect=lambda kind: process if kind == "train" else None):
            body = asyncio.run(first_sse_body())
        text = body.decode("utf-8", errors="replace")
        self.assertIn("rollout_tree", text)
        self.assertIn("node_added", text)
        log_path.unlink(missing_ok=True)

    def test_activity_follows_train_state(self):
        from fastapi.testclient import TestClient

        from science_infra.control.app import create_app
        from science_infra.control.process_manager import PROCS, ManagedProcess

        experiment_id = "fn-train-state"
        run_id = "fn-train-state-run"
        current = psutil.Process(os.getpid())
        process = ManagedProcess(
            run_id=run_id,
            kind="train",
            experiment_id=experiment_id,
            popen=None,
            pid=current.pid,
            pid_create_time=current.create_time(),
            pgid=None,
            command_hash="x",
            cwd="/tmp",
            log_path=Path("/tmp") / f"{run_id}.log",
            state="preparing",
        )
        PROCS._procs[run_id] = process
        PROCS._by_kind["train"] = run_id
        try:
            with TestClient(create_app()) as client:
                preparing = client.get(f"/api/rl/activity?experiment_id={experiment_id}")
                self.assertEqual(preparing.status_code, 200, preparing.text)
                self.assertEqual(preparing.json()["run"]["state"], "preparing")
                process.state = "running"
                running = client.get(f"/api/rl/activity?experiment_id={experiment_id}")
                self.assertEqual(running.json()["run"]["state"], "running")
                self.assertTrue(running.json()["run"]["running"])
                process.state = "succeeded"
                process.returncode = 0
                done = client.get(f"/api/rl/activity?experiment_id={experiment_id}")
                self.assertEqual(done.json()["run"]["state"], "succeeded")
                process.state = "failed"
                process.returncode = 1
                process.message = "boom"
                failed = client.get(f"/api/rl/activity?experiment_id={experiment_id}")
                self.assertEqual(failed.json()["run"]["state"], "failed")
                self.assertEqual(failed.json()["run"]["message"], "boom")
                process.pid = 2**22
                process.pid_create_time = 0
                with patch.object(PROCS, "_disk_runs", return_value=[]):
                    idle = client.get(f"/api/rl/activity?experiment_id={experiment_id}")
                self.assertIsNone(idle.json()["run"])
        finally:
            PROCS._procs.pop(run_id, None)
            if PROCS._by_kind.get("train") == run_id:
                PROCS._by_kind.pop("train", None)

    def test_monitor_rewards_stay_on_their_experiment(self):
        from fastapi.testclient import TestClient

        from science_infra.control.app import create_app
        from science_infra.control.experiments import collect_path, ensure_experiment, exp_dir
        from workflow import Collector

        ids = ("fn-mon-a", "fn-mon-b")
        try:
            for exp_id, answer in zip(ids, ("2", "9")):
                ensure_experiment(exp_id)
                batch = Collector(mock=True, n=1).collect(
                    [{"id": exp_id, "question": "1+1", "answer": "2", "source": "gsm8k", "_mock_answer": answer}]
                )
                collect_path(exp_id).write_text(
                    json.dumps({"batch": batch.model_dump(mode="json")}, ensure_ascii=False),
                    encoding="utf-8",
                )
            with patch("science_infra.control.services.fetch_agl_training_metrics", return_value={}):
                with TestClient(create_app()) as client:
                    left = client.get("/api/monitor/fn-mon-a")
                    right = client.get("/api/monitor/fn-mon-b")
            self.assertEqual(left.status_code, 200, left.text)
            self.assertEqual(right.status_code, 200, right.text)
            left_reward = left.json()["rewards"][0]["reward"]
            right_reward = right.json()["rewards"][0]["reward"]
            self.assertNotEqual(left_reward, right_reward)
            self.assertEqual(left.json()["experiment_id"], "fn-mon-a")
            self.assertEqual(right.json()["experiment_id"], "fn-mon-b")
        finally:
            for exp_id in ids:
                shutil.rmtree(exp_dir(exp_id), ignore_errors=True)
