"""Unit tests for schema 0.3 kind convergence (phase 2)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
for _p in (str(ROOT), str(REPO)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from workflow.spec import (  # noqa: E402
    AgentNodeSpec,
    MASSpec,
    RouterSpec,
    _normalize_schema03,
    load_spec,
)


class TestKindConvergence(unittest.TestCase):
    def test_hub_kind_folds_into_planner(self):
        raw = {"agents": [{"id": "h", "kind": "hub", "system_prompt": "plan it"}]}
        _normalize_schema03(raw)
        self.assertFalse(any(a.get("kind") == "hub" or a.get("id") == "h" for a in raw["agents"]))
        planner = next(a for a in raw["agents"] if a.get("id") == "planner")
        self.assertEqual(planner["system_prompt"], "plan it")

    def test_executor_tools_join_router_candidates(self):
        raw = {
            "topology": "centralized",
            "entry_agent": "planner",
            "agents": [
                {"id": "planner", "kind": "planner"},
                {"id": "executor", "role": "executor", "tools": ["python_coder"]},
                {"id": "verifier", "kind": "verifier"},
            ],
            "edges": [
                {"from": "planner", "to": "executor", "kind": "route"},
                {"from": "executor", "to": "verifier", "kind": "message"},
                {"from": "verifier", "to": "planner", "kind": "feedback"},
            ],
        }
        _normalize_schema03(raw)
        self.assertFalse(any(a.get("id") == "executor" or a.get("kind") == "executor" for a in raw["agents"]))
        coder = next(a for a in raw["agents"] if a.get("id") == "python_coder")
        self.assertEqual(coder["kind"], "tool")
        self.assertFalse(coder["trainable"])
        router = raw["routers"][0]
        self.assertIn("python_coder", router["candidates"])
        pairs = {(e["from"], e["to"], e["kind"]) for e in raw["edges"]}
        self.assertIn(("planner", router["id"], "route"), pairs)
        self.assertIn((router["id"], "verifier", "message"), pairs)

    def test_orchestrator_role_folds_into_planner(self):
        raw = {"agents": [{"id": "h", "role": "orchestrator", "skills": ["plan"]}]}
        _normalize_schema03(raw)
        self.assertFalse(any(a.get("id") == "h" for a in raw["agents"]))
        planner = next(a for a in raw["agents"] if a.get("id") == "planner")
        self.assertEqual(planner["skills"], ["plan"])

    def test_execute_python_mapped(self):
        raw = {"tools": ["execute_python"], "agents": [{"id": "execute_python", "kind": "tool"}]}
        _normalize_schema03(raw)
        self.assertEqual(raw["tools"], ["python_coder"])
        self.assertEqual(raw["agents"][0]["id"], "python_coder")

    def test_memory_scope_default_none(self):
        n = AgentNodeSpec(id="x")
        self.assertEqual(n.memory_scope, "none")
        self.assertEqual(n.kind, "blank")
        self.assertEqual(MASSpec().hub.skills, [])

    def test_router_output_contract_default(self):
        r = RouterSpec(id="r")
        self.assertEqual(r.output_contract, "json")
        self.assertEqual(r.strategy, "from_plan")

    def test_topology_default_centralized(self):
        spec = MASSpec()
        self.assertEqual(spec.topology, "centralized")
        self.assertEqual(spec.entry_agent, "planner")
        self.assertEqual(spec.hub.role, "planner")

    def test_centralized_yaml_loads(self):
        spec = load_spec(str(ROOT / "specs" / "hub_react.yaml"))
        self.assertEqual(spec.topology, "centralized")
        self.assertEqual(spec.entry_agent, "planner")
        self.assertIn("python_coder", spec.tools)
        self.assertNotIn("execute_python", spec.tools)
        self.assertNotIn("hub", {a.id for a in spec.agents} | {spec.entry_agent})


if __name__ == "__main__":
    unittest.main()
