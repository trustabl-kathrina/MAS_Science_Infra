"""Unit tests for router strategies (phase 4)."""

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

from workflow.protocol import make_message  # noqa: E402
from workflow.router import reset_round_robin, select  # noqa: E402
from workflow.spec import RouterSpec  # noqa: E402


def _plan(next_val, args=None, done=False):
    return make_message(
        task_id="t", turn=1, src="planner", dst="r", kind="plan_step",
        payload={"next": next_val, "args": args or {}, "sub_goal": "g", "done": done},
    )


class TestFromPlan(unittest.TestCase):
    def test_alias_llm_choice_is_from_plan(self):
        r = RouterSpec(id="r", candidates=["python_coder"], strategy="from_plan")
        res = select(r, _plan("python_coder", {"code": "1"}), r.candidates)
        self.assertTrue(res.ok, res.reason)
        self.assertEqual(res.strategy, "from_plan")
        alias = RouterSpec(id="r", candidates=["python_coder"], strategy="llm_choice")
        res2 = select(alias, _plan("python_coder", {"code": "1"}), alias.candidates)
        self.assertTrue(res2.ok, res2.reason)
        self.assertEqual(res2.strategy, "from_plan")


class TestLlmChoice(unittest.TestCase):
    def test_single_select_ok(self):
        r = RouterSpec(id="r", candidates=["python_coder", "think"], strategy="llm_choice")
        res = select(r, _plan("python_coder", {"query": "q"}), r.candidates)
        self.assertTrue(res.ok, res.reason)
        self.assertEqual(res.selected, ["python_coder"])
        self.assertEqual(res.args_list, [{"query": "q"}])

    def test_multi_select_ok(self):
        r = RouterSpec(id="r", candidates=["python_coder", "think"], strategy="llm_choice")
        res = select(r, _plan(["python_coder", "think"], [{"query": "q"}, {"text": "t"}]), r.candidates)
        self.assertTrue(res.ok, res.reason)
        self.assertEqual(res.selected, ["python_coder", "think"])
        self.assertEqual(res.args_list, [{"query": "q"}, {"text": "t"}])

    def test_next_out_of_candidates_rejected(self):
        r = RouterSpec(id="r", candidates=["python_coder"], strategy="llm_choice")
        res = select(r, _plan("ghost"), r.candidates)
        self.assertFalse(res.ok)
        self.assertIn("not in candidates", res.reason)

    def test_empty_next_rejected(self):
        r = RouterSpec(id="r", candidates=["python_coder"], strategy="llm_choice")
        res = select(r, _plan(""), r.candidates)
        self.assertFalse(res.ok)

    def test_no_candidates(self):
        r = RouterSpec(id="r", candidates=[], strategy="llm_choice")
        res = select(r, _plan("x"), r.candidates)
        self.assertFalse(res.ok)

    def test_nonstrict_filters_to_this_router(self):
        r = RouterSpec(id="r", candidates=["python_coder"], strategy="llm_choice")
        res = select(r, _plan(["python_coder", "think"], [{}, {"text": "t"}]), r.candidates, strict=False)
        self.assertTrue(res.ok, res.reason)
        self.assertEqual(res.selected, ["python_coder"])


class TestRoundRobin(unittest.TestCase):
    def setUp(self):
        reset_round_robin()

    def test_rotation(self):
        r = RouterSpec(id="rr", candidates=["a", "b", "c"], strategy="round_robin")
        picks = [select(r, None, r.candidates).selected[0] for _ in range(4)]
        self.assertEqual(picks, ["a", "b", "c", "a"])


class TestScore(unittest.TestCase):
    def test_highest_score_wins(self):
        r = RouterSpec(id="s", candidates=["a", "b"], strategy="score", scorer="judge")

        def scorer(cand, ctx):
            return cand, {"a": 0.2, "b": 0.9}[cand]

        res = select(r, None, r.candidates, scorer_runner=scorer)
        self.assertTrue(res.ok)
        self.assertEqual(res.selected, ["b"])
        self.assertEqual(res.metrics["scores"]["a"], 0.2)

    def test_no_scorer_fails(self):
        r = RouterSpec(id="s", candidates=["a"], strategy="score", scorer="judge")
        res = select(r, None, r.candidates)
        self.assertFalse(res.ok)


if __name__ == "__main__":
    unittest.main()
