"""Functional contracts: offline diagnosers and registry consume fan-out."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
for p in (str(ROOT), str(REPO)):
    if p not in sys.path:
        sys.path.insert(0, p)


def _error_traj(message: str):
    from workflow.contracts import EventKind, ExecutionEvent, Trajectory

    return Trajectory(
        final_reward=0.0,
        format_ok=False,
        events=[ExecutionEvent(kind=EventKind.ERROR, payload={"error": message})],
    )


class TestOfflineDiagnosers(unittest.TestCase):
    def test_four_plugins_on_fixtures(self):
        from workflow.contracts import Trajectory
        from workflow.harness import (
            CognitiveConvergenceDiagnoser,
            LogErrorDiagnoser,
            LossVolatilityDiagnoser,
            RewardHackingDiagnoser,
        )

        logged = LogErrorDiagnoser().diagnose({"trajectory": _error_traj("tool exploded")})
        self.assertEqual(logged[0].plugin, "log_error")
        self.assertIn("exploded", logged[0].message)

        volatile = LossVolatilityDiagnoser().diagnose({"rewards": [0.1, 0.9, 0.0, 1.0]})
        self.assertTrue(volatile)
        self.assertEqual(volatile[0].plugin, "loss_volatility")

        repeated = CognitiveConvergenceDiagnoser().diagnose(
            {"trajectories": [_error_traj("timeout 12"), _error_traj("timeout 99")]}
        )
        self.assertTrue(repeated)
        self.assertEqual(repeated[0].plugin, "cognitive_convergence")

        hacked = RewardHackingDiagnoser().diagnose(
            {"trajectory": Trajectory(final_reward=1.0, format_ok=False, final_answer=None)}
        )
        self.assertEqual(hacked[0].plugin, "reward_hacking")


class _Silent:
    name = "silent"

    def diagnose(self, ctx):
        del ctx
        return []


class TestRegistryConsume(unittest.TestCase):
    def test_fanout_and_missing_consume(self):
        from workflow.harness import default_harness

        registry = default_harness()
        registry.register(_Silent())
        errors = registry.consume({"kind": "error", "payload": {"error": "boom"}})
        self.assertTrue(any(hit.plugin == "log_error" and "boom" in hit.message for hit in errors))

        hit = None
        for value in (0.1, 0.9, 0.1, 0.95):
            streamed = registry.consume({"event": "loss", "payload": {"metrics": {"r": value}}})
            if streamed:
                hit = streamed[-1]
        self.assertIsNotNone(hit)
        self.assertEqual(hit.plugin, "loss_volatility")

        tree = {
            "nodes": [
                {"node_id": "root", "parent_id": None, "reward": None},
                {"node_id": "a", "parent_id": "root", "reward": 0.2},
                {"node_id": "b", "parent_id": "root", "reward": 0.2},
                {"node_id": "c", "parent_id": "root", "reward": 1.0},
            ]
        }
        anomalies = registry.consume({"event": "outcome", "payload": {"tree": tree}})
        self.assertTrue(any(item.plugin == "reward_hacking_monitor" for item in anomalies))
        self.assertEqual(registry.consume({"event": "tick"}), [])
