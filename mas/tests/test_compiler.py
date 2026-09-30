"""Unit tests for centralized topology compilation (phase 3)."""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
for _p in (str(ROOT), str(REPO)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from workflow.compiler import compile_spec, trainable_agents  # noqa: E402
from workflow.spec import MASSpec, _normalize_schema03  # noqa: E402


def _centralized() -> MASSpec:
    return MASSpec.model_validate({
        "schema_version": "0.3",
        "topology": "centralized",
        "entry_agent": "planner",
        "tools": ["python_coder"],
        "agents": [
            {"id": "planner", "kind": "planner", "tools": ["python_coder"]},
            {"id": "python_coder", "kind": "tool", "trainable": False},
            {"id": "verifier", "kind": "verifier"},
        ],
        "routers": [{"id": "route_exec", "candidates": ["python_coder"], "strategy": "llm_choice"}],
        "edges": [
            {"from": "planner", "to": "route_exec", "kind": "route"},
            {"from": "route_exec", "to": "verifier", "kind": "message"},
            {"from": "verifier", "to": "planner", "kind": "feedback"},
        ],
    })


class TestCompileCentralized(unittest.TestCase):
    def test_route_out_contains_router(self):
        c = compile_spec(_centralized())
        self.assertTrue(c.ok, c.reason)
        self.assertEqual(c.route_out.get("planner"), "route_exec")
        self.assertIn("route_exec", c.routers)
        self.assertEqual(c.message_out.get("route_exec"), "verifier")
        self.assertIn("route_exec", c.fan_out.get("planner", []))

    def test_implicit_router_when_none_declared(self):
        spec = MASSpec.model_validate({
            "topology": "centralized",
            "entry_agent": "planner",
            "tools": ["python_coder", "think"],
            "agents": [
                {"id": "planner", "kind": "planner", "tools": ["python_coder", "think"]},
                {"id": "python_coder", "kind": "tool"},
                {"id": "think", "kind": "tool"},
            ],
        })
        c = compile_spec(spec)
        self.assertTrue(c.ok, c.reason)
        self.assertIn("_implicit_route", c.routers)
        self.assertEqual(c.route_out.get("planner"), "_implicit_route")
        self.assertEqual(c.routers["_implicit_route"].strategy, "from_plan")
        self.assertEqual(sorted(c.routers["_implicit_route"].candidates), ["python_coder", "think"])

    def test_multi_router_fan_out(self):
        spec = MASSpec.model_validate({
            "topology": "centralized",
            "entry_agent": "planner",
            "tools": ["python_coder", "think"],
            "agents": [
                {"id": "planner", "kind": "planner", "tools": ["python_coder", "think"]},
                {"id": "python_coder", "kind": "tool"},
                {"id": "think", "kind": "tool"},
                {"id": "verifier", "kind": "verifier"},
            ],
            "routers": [
                {"id": "route_a", "candidates": ["python_coder"], "strategy": "llm_choice"},
                {"id": "route_b", "candidates": ["think"], "strategy": "llm_choice"},
            ],
            "edges": [
                {"from": "planner", "to": "route_a", "kind": "route"},
                {"from": "planner", "to": "route_b", "kind": "route"},
                {"from": "route_a", "to": "verifier", "kind": "message"},
                {"from": "route_b", "to": "verifier", "kind": "message"},
                {"from": "verifier", "to": "planner", "kind": "feedback"},
            ],
        })
        c = compile_spec(spec)
        self.assertTrue(c.ok, c.reason)
        self.assertEqual(sorted(c.fan_out.get("planner", [])), ["route_a", "route_b"])

    def test_illegal_candidate_fails(self):
        spec = MASSpec.model_validate({
            "topology": "graph",
            "entry_agent": "planner",
            "agents": [{"id": "planner", "kind": "planner"}],
            "routers": [{"id": "r", "candidates": ["ghost"], "strategy": "llm_choice"}],
            "edges": [{"from": "planner", "to": "r", "kind": "route"}],
        })
        c = compile_spec(spec)
        self.assertFalse(c.ok)
        self.assertTrue(any("ghost" in i for i in c.issues))

    def test_tool_to_blank_message_allowed(self):
        spec = MASSpec.model_validate({
            "topology": "centralized",
            "entry_agent": "planner",
            "tools": ["python_coder"],
            "agents": [
                {"id": "planner", "kind": "planner", "tools": ["python_coder"]},
                {"id": "python_coder", "kind": "tool"},
                {"id": "summarizer", "kind": "blank"},
                {"id": "verifier", "kind": "verifier"},
            ],
            "routers": [{"id": "route_exec", "candidates": ["python_coder"]}],
            "edges": [
                {"from": "planner", "to": "route_exec", "kind": "route"},
                {"from": "python_coder", "to": "summarizer", "kind": "message"},
                {"from": "summarizer", "to": "verifier", "kind": "message"},
                {"from": "verifier", "to": "planner", "kind": "feedback"},
            ],
        })
        c = compile_spec(spec)
        self.assertTrue(c.ok, c.reason)
        self.assertEqual(c.message_out.get("python_coder"), "summarizer")
        self.assertEqual(c.message_out.get("summarizer"), "verifier")

    def test_trainable_agents_excludes_tools(self):
        spec = _centralized()
        names = trainable_agents(spec)
        self.assertIn("planner", names)
        self.assertNotIn("python_coder", names)
        spec.agents[1].trainable = True
        self.assertNotIn("python_coder", trainable_agents(spec))

    def test_pool_edges_collapse_onto_router(self):
        spec = MASSpec.model_validate({
            "topology": "centralized",
            "entry_agent": "planner",
            "agents": [
                {"id": "planner", "kind": "planner"},
                {"id": "python_coder", "kind": "tool", "trainable": True},
                {"id": "verifier", "kind": "verifier"},
            ],
            "routers": [{"id": "route_exec", "candidates": ["python_coder"], "strategy": "from_plan"}],
            "edges": [
                {"from": "planner", "to": "route_exec", "kind": "route"},
                {"from": "route_exec", "to": "pool_route_exec", "kind": "route", "meta": {"members": ["python_coder"]}},
                {"from": "pool_route_exec", "to": "verifier", "kind": "message"},
                {"from": "verifier", "to": "planner", "kind": "feedback"},
            ],
        })
        compiled = compile_spec(spec)
        self.assertTrue(compiled.ok, compiled.reason)
        self.assertEqual(compiled.message_out.get("route_exec"), "verifier")
        self.assertNotIn("python_coder", trainable_agents(spec))

    def test_centralized_template_pool_matches_collapsed_edges(self):
        from workflow.templates import load_template_workflow

        raw = load_template_workflow("centralized")
        collapsed = compile_spec(MASSpec.model_validate(raw))
        self.assertTrue(collapsed.ok, collapsed.reason)
        pooled = copy.deepcopy(raw)
        edges = []
        for edge in pooled["edges"]:
            if edge.get("kind") == "message" and edge.get("to") == "verifier" and str(edge.get("from") or "").startswith("route"):
                router_id = edge["from"]
                members = next(r["candidates"] for r in pooled["routers"] if r["id"] == router_id)
                edges.append({
                    "from": router_id,
                    "to": f"pool_{router_id}",
                    "kind": "route",
                    "meta": {"members": list(members)},
                })
                edges.append({"from": f"pool_{router_id}", "to": "verifier", "kind": "message"})
            else:
                edges.append(edge)
        pooled["edges"] = edges
        compiled = compile_spec(MASSpec.model_validate(pooled))
        self.assertTrue(compiled.ok, compiled.reason)
        self.assertEqual(compiled.message_out.get("route_exec"), "verifier")
        self.assertEqual(
            list(compiled.routers["route_exec"].candidates),
            list(collapsed.routers["route_exec"].candidates),
        )
        mismatched = copy.deepcopy(pooled)
        for edge in mismatched["edges"]:
            members = (edge.get("meta") or {}).get("members")
            if members:
                edge["meta"] = {"members": ["think"]}
        failed = compile_spec(MASSpec.model_validate(mismatched))
        self.assertFalse(failed.ok)
        self.assertIn("must equal pool members", failed.reason)

    def test_hub_yaml_folds_into_planner(self):
        raw = {
            "topology": "centralized",
            "agents": [{"id": "hub", "kind": "hub", "system_prompt": "keep"}],
        }
        _normalize_schema03(raw)
        self.assertEqual(raw["agents"][0]["id"], "planner")
        self.assertEqual(raw["agents"][0]["system_prompt"], "keep")


if __name__ == "__main__":
    unittest.main()
