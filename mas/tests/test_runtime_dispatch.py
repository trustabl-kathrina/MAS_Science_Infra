"""Runtime kind-dispatch tests (phase 5)."""

from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault("SCIENCE_INFRA_TOOL_KERNEL", "1")

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
for _p in (str(ROOT), str(REPO)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from workflow.archive import Archive, register_archive  # noqa: E402
from workflow.centralized_runtime import MockWindowLLM  # noqa: E402
from workflow.compiler import compile_spec  # noqa: E402
from workflow.memory import MemoryStore  # noqa: E402
from workflow.runtime import run_compiled_episode  # noqa: E402
from workflow.spec import MASSpec  # noqa: E402


def _spec() -> MASSpec:
    return MASSpec.model_validate({
        "schema_version": "0.3",
        "topology": "centralized",
        "entry_agent": "planner",
        "tools": ["python_coder"],
        "agents": [
            {"id": "planner", "kind": "planner", "tools": ["python_coder"]},
            {"id": "python_coder", "kind": "tool", "trainable": False},
            {"id": "verifier", "kind": "verifier", "system_prompt": "verify"},
        ],
        "routers": [{"id": "route_exec", "candidates": ["python_coder"], "strategy": "llm_choice"}],
        "edges": [
            {"from": "planner", "to": "route_exec", "kind": "route"},
            {"from": "route_exec", "to": "verifier", "kind": "message"},
            {"from": "verifier", "to": "planner", "kind": "feedback"},
        ],
    })


class TestKindDispatch(unittest.TestCase):
    def test_run_compiled_episode_uses_centralized_path(self):
        spec = _spec()
        arch = register_archive(Archive())
        win = MockWindowLLM({
            "planner": [json.dumps({"next": "python_coder", "args": {"code": "result=2"}, "sub_goal": "g", "done": True})],
            "verifier": [json.dumps({"ok": True, "reason": "ok", "step_conclusion": "COMPLETE", "slot_updates": []})],
        })
        raw = run_compiled_episode(
            {"id": "d1", "question": "q"}, None, arch, spec, MemoryStore(),
            runner=None,  # type: ignore[arg-type]
            window_llm=win,
        )
        ids = [e.get("agent_id") for e in raw.window_events]
        self.assertEqual(ids[:4], ["planner", "route_exec", "python_coder", "verifier"])
        kinds = [m.get("kind") for m in raw.messages]
        self.assertEqual(kinds, ["plan_step", "tool_invoke", "tool_result", "verify"])
        self.assertNotIn("tool_calls", kinds)

    def test_router_window_has_own_agent_id(self):
        spec = _spec()
        compiled = compile_spec(spec)
        self.assertIn("route_exec", compiled.routers)
        arch = register_archive(Archive())
        win = MockWindowLLM({
            "planner": [json.dumps({"next": "python_coder", "args": {"code": "result=1"}, "sub_goal": "g", "done": True})],
            "verifier": [json.dumps({"ok": True, "reason": "ok", "step_conclusion": "COMPLETE", "slot_updates": []})],
        })
        raw = run_compiled_episode(
            {"id": "d2", "question": "q"}, None, arch, spec, MemoryStore(),
            runner=None,  # type: ignore[arg-type]
            window_llm=win,
        )
        router_ev = [e for e in raw.window_events if e.get("agent_id") == "route_exec"]
        self.assertTrue(router_ev)

    def test_verifier_fail_feedback_second_turn(self):
        spec = _spec()
        arch = register_archive(Archive())
        win = MockWindowLLM({
            "planner": [
                json.dumps({"next": "python_coder", "args": {"code": "result=1"}, "sub_goal": "g", "done": False}),
                json.dumps({"next": "python_coder", "args": {"code": "result=2"}, "sub_goal": "g", "done": True}),
            ],
            "verifier": [
                json.dumps({"ok": False, "reason": "retry", "step_conclusion": "INCOMPLETE", "slot_updates": []}),
                json.dumps({"ok": True, "reason": "ok", "step_conclusion": "COMPLETE", "slot_updates": []}),
            ],
        })
        raw = run_compiled_episode(
            {"id": "d3", "question": "q"}, None, arch, spec, MemoryStore(),
            runner=None,  # type: ignore[arg-type]
            window_llm=win,
        )
        verifies = [m for m in raw.messages if m.get("kind") == "verify"]
        self.assertEqual(len(verifies), 2)
        self.assertFalse(verifies[0]["payload"]["ok"])
        self.assertTrue(verifies[1]["payload"]["ok"])


if __name__ == "__main__":
    unittest.main()
