"""Functional contracts: tool dispatch, sandbox, and LLM failure trajectories."""

from __future__ import annotations

import subprocess
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
for p in (str(ROOT), str(REPO)):
    if p not in sys.path:
        sys.path.insert(0, p)


class _FakeTool:
    def __init__(self, text: str, delay: float = 0.0) -> None:
        self.text = text
        self.delay = delay

    def invoke(self, args, prefer_llm: bool = False):
        del args, prefer_llm
        if self.delay:
            time.sleep(self.delay)
        return self.text


class _BoomLLM:
    def bind(self, **kwargs):
        del kwargs
        return self

    def invoke(self, messages):
        del messages
        raise RuntimeError("llm down")


def _bare_agent():
    from langchain_core.messages import HumanMessage

    from tir_agent import TirAgent, ToolAgentInvoker

    agent = TirAgent.__new__(TirAgent)
    agent.agent_id = "planner"
    agent.execution_recorder = None
    agent.routers = {}
    agent._router_by_tool = {}
    agent.max_turns = 4
    agent.max_tokens = 64
    agent.max_model_len = None
    agent.model_name = "m"
    agent.endpoint = "http://127.0.0.1:9"
    agent.entropy_tokens = 8
    agent.entropy_threshold = 0.15
    agent.system_prompt = "sys"
    agent.tool_agent_invoker = ToolAgentInvoker({})
    agent.tool_agent_invoker._agents = {}
    agent.tool_agent_invoker._blank_agents = {}
    agent.tool_agent_invoker._tool_map = {}
    agent._blank_adapters = {}
    agent._opening = HumanMessage
    return agent


class TestToolDispatch(unittest.TestCase):
    def test_unknown_tool_is_an_error_string(self):
        from langchain_core.messages import AIMessage

        agent = _bare_agent()
        state = agent.call_tools(
            {
                "messages": [
                    AIMessage(
                        content="",
                        tool_calls=[{"name": "missing_tool", "args": {}, "id": "c1", "type": "tool_call"}],
                    )
                ],
                "num_turns": 1,
                "turn_records": [],
                "n_search": 0,
                "n_python": 0,
            }
        )
        self.assertIn("Error: unknown tool missing_tool", state["messages"][-1].content)

    def test_parallel_tool_calls_keep_order_and_counts(self):
        from langchain_core.messages import AIMessage

        agent = _bare_agent()
        agent.tool_agent_invoker._agents = {
            "web_search": _FakeTool("search-obs", delay=0.08),
            "execute_python": _FakeTool("py-obs", delay=0.01),
        }
        state = agent.call_tools(
            {
                "messages": [
                    AIMessage(
                        content="",
                        tool_calls=[
                            {"name": "web_search", "args": {"query": "a"}, "id": "s", "type": "tool_call"},
                            {"name": "execute_python", "args": {"code": "result=1"}, "id": "p", "type": "tool_call"},
                        ],
                    )
                ],
                "num_turns": 1,
                "turn_records": [],
                "n_search": 0,
                "n_python": 0,
            }
        )
        tool_messages = state["messages"][-2:]
        self.assertEqual(tool_messages[0].content, "search-obs")
        self.assertEqual(tool_messages[1].content, "py-obs")
        self.assertEqual(state["n_search"], 1)
        self.assertEqual(state["n_python"], 1)


class TestPythonSandbox(unittest.TestCase):
    def test_rejects_import_and_open(self):
        from python_tool import execute_python

        self.assertIn("Import statements are not allowed", execute_python("import os\nresult = 1"))
        self.assertIn("not allowed", execute_python("open('x')\nresult = 1"))
        self.assertIn("result = 3", execute_python("result = 1 + 2"))

    def test_timeout_returns_before_the_loop_finishes(self):
        script = (
            "import time\n"
            "from python_tool import execute_python\n"
            "started = time.perf_counter()\n"
            "out = execute_python('s=0\\nwhile s>=0:\\n s+=1\\n', timeout_seconds=0.2)\n"
            "assert 'timed out' in out, out\n"
            "assert time.perf_counter() - started < 1.5, time.perf_counter() - started\n"
        )
        completed = subprocess.run(
            [sys.executable, "-c", script],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)


class TestLlmFailureTrajectory(unittest.TestCase):
    def test_invoke_failure_is_an_episode_error(self):
        from workflow.archive import Archive
        from workflow.runtime import LLMConfig, run_episode

        import tir_agent

        real_init = tir_agent.TirAgent.__init__

        def boom_init(self, **kwargs):
            self.max_turns = int(kwargs.get("max_turns") or 4)
            self.max_tokens = int(kwargs.get("max_tokens") or 64)
            self.max_model_len = kwargs.get("max_model_len")
            self.model_name = kwargs.get("model_name") or "m"
            self.endpoint = kwargs.get("endpoint") or "http://127.0.0.1:9"
            self.entropy_tokens = 8
            self.entropy_threshold = 0.15
            self.system_prompt = kwargs.get("system_prompt") or "sys"
            self.agent_id = kwargs.get("agent_id") or "planner"
            self.execution_recorder = kwargs.get("execution_recorder")
            self.routers = dict(kwargs.get("routers") or {})
            self.routers.pop("__blank_specs__", None)
            self._router_by_tool = {}
            self.tool_agent_invoker = tir_agent.ToolAgentInvoker({})
            self._blank_adapters = {}
            self.llm = _BoomLLM()
            self.llm_finalize = _BoomLLM()

        tir_agent.TirAgent.__init__ = boom_init
        try:
            raw = run_episode(
                {"id": "fail", "question": "1+1", "answer": "2"},
                LLMConfig(endpoint="http://127.0.0.1:9", model="m", max_turns=2, max_tokens=32),
                Archive(),
            )
        finally:
            tir_agent.TirAgent.__init__ = real_init
        self.assertTrue(raw.error)
        self.assertIn("llm down", raw.error)
        self.assertNotEqual(raw.final_answer, "None")
        self.assertFalse(raw.format_ok)
        self.assertNotIn("<answer>None</answer>", str(raw.messages))
