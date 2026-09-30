"""Unit tests for the AgentMessage envelope + payload schemas (phase 1)."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
for _p in (str(ROOT), str(REPO)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from workflow.protocol import (  # noqa: E402
    AgentMessage,
    commit_to_fact,
    make_message,
    validate_json_schema,
    validate_payload,
)


class TestEnvelope(unittest.TestCase):
    def test_round_trip_serialization(self):
        msg = make_message(
            task_id="t1", turn=1, src="planner", dst="route_exec",
            kind="plan_step",
            payload={"next": "python_coder", "args": {"query": "q"}, "sub_goal": "g", "done": False},
        )
        dumped = msg.model_dump()
        loaded = AgentMessage.model_validate(dumped)
        self.assertEqual(loaded.msg_id, msg.msg_id)
        self.assertEqual(loaded.payload["next"], "python_coder")

    def test_trace_ref_causal_chain(self):
        m1 = make_message(task_id="t", turn=1, src="planner", dst="r",
                          kind="plan_step",
                          payload={"next": "python_coder", "args": {}, "sub_goal": "g", "done": False})
        m2 = make_message(task_id="t", turn=1, src="r", dst="python_coder",
                          kind="tool_invoke", payload={"query": "q"}, trace_ref=m1.msg_id)
        m3 = make_message(task_id="t", turn=1, src="python_coder", dst="verifier",
                          kind="tool_result",
                          payload={"output": "42", "ok": True, "evidence_type": "DIRECT"},
                          trace_ref=m2.msg_id)
        self.assertEqual(m2.trace_ref, m1.msg_id)
        self.assertEqual(m3.trace_ref, m2.msg_id)
        self.assertNotEqual(m1.msg_id, m2.msg_id)

    def test_chain_to_helper(self):
        m1 = make_message(task_id="t", turn=1, src="planner", dst="r", kind="plan_step",
                          payload={"next": "x", "args": {}, "sub_goal": "g", "done": False})
        m2 = AgentMessage(task_id="t", turn=1, src="r", dst="x", kind="tool_invoke", payload={"query": "q"})
        m1.chain_to(m2)
        self.assertEqual(m2.trace_ref, m1.msg_id)

    def test_payload_digest_stable(self):
        m = make_message(task_id="t", turn=1, src="p", dst="r", kind="plan_step",
                         payload={"next": "x", "args": {"a": 1}, "sub_goal": "g", "done": False})
        self.assertEqual(m.payload_digest(), m.payload_digest())


class TestPayloadValidation(unittest.TestCase):
    def test_plan_step_ok_single(self):
        ok, _ = validate_payload("plan_step", {"next": "python_coder", "args": {"query": "q"}, "sub_goal": "g", "done": False})
        self.assertTrue(ok)

    def test_plan_step_ok_multi(self):
        ok, _ = validate_payload("plan_step", {"next": ["a", "b"], "args": [{"query": "q"}, {"query": "r"}], "sub_goal": "g", "done": False})
        self.assertTrue(ok)

    def test_plan_step_missing_done(self):
        ok, reason = validate_payload("plan_step", {"next": "x", "args": {}, "sub_goal": "g"})
        self.assertFalse(ok)
        self.assertIn("done", reason)

    def test_tool_result_bad_evidence(self):
        ok, reason = validate_payload("tool_result", {"output": "x", "ok": True, "evidence_type": "BOGUS"})
        self.assertFalse(ok)
        self.assertIn("evidence_type", reason)

    def test_verify_bad_step_conclusion(self):
        ok, reason = validate_payload("verify", {"ok": True, "reason": "r", "step_conclusion": "DONE", "slot_updates": []})
        self.assertFalse(ok)
        self.assertIn("step_conclusion", reason)

    def test_verify_ok(self):
        ok, _ = validate_payload("verify", {"ok": True, "reason": "r", "step_conclusion": "COMPLETE", "slot_updates": [{"slot": "s", "value": "v", "filled": True}]})
        self.assertTrue(ok)

    def test_unknown_kind(self):
        ok, _ = validate_payload("bogus", {})
        self.assertFalse(ok)

    def test_make_message_raises(self):
        with self.assertRaises(ValueError):
            make_message(task_id="t", turn=1, src="p", dst="r", kind="plan_step", payload={"next": "x"})


class TestJsonSchema(unittest.TestCase):
    def test_default_output_contract_ok(self):
        ok, _ = validate_json_schema({"output": "hi"}, None)
        self.assertTrue(ok)

    def test_default_output_contract_missing(self):
        ok, reason = validate_json_schema({"output": 1}, None)
        self.assertFalse(ok)

    def test_custom_schema_ok(self):
        schema = {"type": "object", "properties": {"output": {"type": "string"}, "confidence": {"type": "number"}}, "required": ["output"]}
        ok, _ = validate_json_schema({"output": "x", "confidence": 0.8}, schema)
        self.assertTrue(ok)

    def test_custom_schema_wrong_type(self):
        schema = {"type": "object", "properties": {"output": {"type": "string"}}, "required": ["output"]}
        ok, reason = validate_json_schema({"output": 5}, schema)
        self.assertFalse(ok)

    def test_additional_properties_rejected(self):
        schema = {"type": "object", "properties": {"output": {"type": "string"}}, "required": ["output"], "additionalProperties": False}
        ok, reason = validate_json_schema({"output": "x", "extra": 1}, schema)
        self.assertFalse(ok)

    def test_array_items(self):
        schema = {"type": "array", "items": {"type": "string"}}
        ok, _ = validate_json_schema(["a", "b"], schema)
        self.assertTrue(ok)
        ok, reason = validate_json_schema(["a", 1], schema)
        self.assertFalse(ok)


class TestCommitGate(unittest.TestCase):
    def test_complete_direct_filled_commits(self):
        self.assertTrue(commit_to_fact(
            {"ok": True, "reason": "r", "step_conclusion": "COMPLETE", "evidence_type": "DIRECT",
             "slot_updates": [{"slot": "s", "value": "v", "filled": True}]},
            {"output": "o", "ok": True, "evidence_type": "DIRECT"},
        ))

    def test_incomplete_rejected(self):
        self.assertFalse(commit_to_fact(
            {"ok": True, "reason": "r", "step_conclusion": "INCOMPLETE", "slot_updates": []},
            {"output": "o", "ok": True, "evidence_type": "DIRECT"},
        ))

    def test_absence_rejected(self):
        self.assertFalse(commit_to_fact(
            {"ok": True, "reason": "r", "step_conclusion": "COMPLETE", "evidence_type": "ABSENCE", "slot_updates": []},
            {"output": "o", "ok": True, "evidence_type": "ABSENCE"},
        ))

    def test_unfilled_slot_rejected(self):
        self.assertFalse(commit_to_fact(
            {"ok": True, "reason": "r", "step_conclusion": "COMPLETE", "evidence_type": "DIRECT",
             "slot_updates": [{"slot": "s", "value": None, "filled": False}]},
            {"output": "o", "ok": True, "evidence_type": "DIRECT"},
        ))


if __name__ == "__main__":
    unittest.main()
