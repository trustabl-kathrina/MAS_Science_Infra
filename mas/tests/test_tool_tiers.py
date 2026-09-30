"""lite and pro tool-agent tiers. Network is mocked."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("SCIENCE_INFRA_TOOL_KERNEL", "1")

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
for _p in (str(ROOT), str(REPO)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from tools.pro_tools import run_pro, select_titles  # noqa: E402
from tools.search import _parse_bing_html  # noqa: E402
from tools.tool_agents import TOOL_AGENTS, effective_tier, validate_tool_args  # noqa: E402
from tools.wikipedia import wikipedia_search  # noqa: E402
from workflow.spec import MASSpec  # noqa: E402
from workflow.templates import load_template_workflow  # noqa: E402


class _Resp:
    def __init__(self, payload, status=200):
        self.status_code = status
        self._payload = payload

    def json(self):
        return self._payload


class TestToolTiers(unittest.TestCase):
    def test_missing_template_tier_stays_lite(self):
        spec = MASSpec.model_validate(load_template_workflow("centralized"))
        wiki = next(agent for agent in spec.agents if agent.id == "wikipedia_search")
        self.assertNotEqual(wiki.profile.get("tier"), "pro")
        self.assertEqual(effective_tier(wiki.profile.get("tier")), "lite")

    def test_kernel_switch_forces_lite(self):
        self.assertEqual(effective_tier("pro"), "lite")
        saved = os.environ.pop("SCIENCE_INFRA_TOOL_KERNEL", None)
        try:
            self.assertEqual(effective_tier("pro"), "pro")
            self.assertEqual(effective_tier(None), "lite")
        finally:
            if saved is not None:
                os.environ["SCIENCE_INFRA_TOOL_KERNEL"] = saved

    def test_lite_wikipedia_includes_url_and_skips_landing_pages(self):
        calls = []

        def fake_get(url, **_kwargs):
            calls.append(url)
            if "api.php" in url:
                return _Resp({"query": {"search": [{"title": "Ada Lovelace", "snippet": "math"}]}})
            if "/page/summary/" in url:
                return _Resp({"extract": "Mathematician"})
            raise AssertionError(url)

        with patch("tools.wikipedia.requests.get", fake_get):
            text = wikipedia_search("Ada Lovelace")
        self.assertIn("https://en.wikipedia.org/wiki/Ada_Lovelace", text)
        self.assertTrue(calls)
        self.assertTrue(all("api.php" in url or "/page/summary/" in url for url in calls))
        self.assertFalse(any(url.rstrip("/").endswith("/wiki/Ada_Lovelace") for url in calls))

    def test_pro_wikipedia_keeps_selected_page_url(self):
        def fake_get(url, **_kwargs):
            if "api.php" in url:
                return _Resp({"query": {"search": [
                    {"title": "Ada Lovelace", "snippet": "math"},
                    {"title": "Potato", "snippet": "food"},
                ]}})
            if "Potato" in url:
                raise AssertionError(url)
            if "/page/summary/" in url:
                return _Resp({"extract": "Mathematician"})
            raise AssertionError(url)

        with patch("requests.get", fake_get):
            text = run_pro("wikipedia_search", {"query": "Ada Lovelace"}, lambda _args: "lite")
        self.assertTrue(text.startswith("tier=pro"))
        self.assertNotIn("pro_fallback", text)
        self.assertIn("https://en.wikipedia.org/wiki/Ada_Lovelace", text)
        self.assertNotIn("Potato", text)
        self.assertEqual(select_titles("Ada Lovelace", ["Ada Lovelace", "Potato"]), ["Ada Lovelace"])

    def test_pro_google_fetches_two_pages(self):
        organic = [
            {"title": "One", "link": "https://one.example", "snippet": "s1"},
            {"title": "Two", "link": "https://two.example", "snippet": "s2"},
            {"title": "Three", "link": "https://three.example", "snippet": "s3"},
        ]
        fetched = []

        def fake_fetch(url, max_chars=2000):
            fetched.append((url, max_chars))
            return f"abstract of {url}"

        with patch("tools.search.search_organic", return_value=(organic, "")), patch(
            "tools.search.fetch_page", side_effect=fake_fetch,
        ):
            text = run_pro("google_search", {"query": "q"}, lambda _args: "lite serp")
        self.assertTrue(text.startswith("tier=pro"))
        self.assertNotIn("pro_fallback", text)
        self.assertEqual([item[0] for item in fetched], ["https://one.example", "https://two.example"])
        self.assertIn("snippet: s1", text)
        self.assertIn("abstract of https://one.example", text)

    def test_pro_google_fallback_keeps_serp(self):
        organic = [{"title": "One", "link": "https://one.example", "snippet": "kept snippet"}]

        def fake_fetch(url, max_chars=2000):
            return "fetch_unavailable: down"

        with patch("tools.search.search_organic", return_value=(organic, "")), patch(
            "tools.search.fetch_page", side_effect=fake_fetch,
        ):
            text = run_pro("google_search", {"query": "q"}, lambda _args: "lite serp")
        self.assertIn("pro_fallback", text)
        self.assertIn("https://one.example", text)
        self.assertIn("kept snippet", text)

    def test_pro_python_does_not_call_hive_backend(self):
        agent = TOOL_AGENTS["python_coder"]
        saved_env = os.environ.pop("SCIENCE_INFRA_TOOL_KERNEL", None)
        saved_llm = agent._llm_invoke

        def _boom(_args):
            raise AssertionError("hive backend")

        agent._llm_invoke = _boom
        try:
            text = agent.invoke({"code": "result = 6 * 7"}, tier="pro")
        finally:
            agent._llm_invoke = saved_llm
            if saved_env is not None:
                os.environ["SCIENCE_INFRA_TOOL_KERNEL"] = saved_env
        self.assertTrue(text.startswith("tier=pro"))
        self.assertIn("42", text)


_BING = """
<ol>
  <li class="b_algo"><h2><a href="https://example.com/ada">Ada Lovelace</a></h2><p>first programmer</p></li>
  <li class="b_algo"><h2><a href="https://example.com/two">Second</a></h2><p>another hit</p></li>
  <li class="b_algo"><h2><a href="https://example.com/three">Third</a></h2><p>third hit</p></li>
</ol>
"""


class TestEachToolAgent(unittest.TestCase):
    def test_lite_invoke_prefixes_every_agent(self):
        samples = {
            "wikipedia_search": {"query": "Ada"},
            "google_search": {"query": "Ada"},
            "web_search": {"query": "Ada", "url": "https://example.com/ada"},
            "python_coder": {"code": "result = 1"},
            "think": {"text": "reason here"},
        }
        for name, args in samples.items():
            agent = TOOL_AGENTS[name]
            if name == "google_search":
                with patch("tools.search.search_organic", return_value=(_parse_bing_html(_BING, 5), "")), patch(
                    "tools.search.fetch_page", side_effect=AssertionError("lite must not open a page"),
                ):
                    text = agent.invoke(args, tier="pro")
            elif name == "web_search":
                with patch("tools.search.fetch_page", return_value="Ada Lovelace wrote notes."):
                    text = agent.invoke(args)
            elif name == "wikipedia_search":
                def fake_get(url, **_kwargs):
                    if "api.php" in url:
                        return _Resp({"query": {"search": [{"title": "Ada", "snippet": "s"}]}})
                    return _Resp({"extract": "extract"})
                with patch("tools.wikipedia.requests.get", fake_get):
                    text = agent.invoke(args)
            else:
                text = agent.invoke(args, tier="pro")
            self.assertTrue(str(text).startswith("tier=lite"), name)
        self.assertIn("42", TOOL_AGENTS["python_coder"].invoke({"code": "result = 6 * 7"}) )
        self.assertIn("reason here", TOOL_AGENTS["think"].invoke({"text": "reason here"}))

    def test_google_lite_parses_bing_without_opening_pages(self):
        fetched = []

        def _request(method, url, **_kwargs):
            return _BING, ""

        def _fetch(url, max_chars=2000):
            fetched.append(url)
            return "should not run"

        with patch("tools.search._request", side_effect=_request), patch("tools.search.fetch_page", side_effect=_fetch):
            text = TOOL_AGENTS["google_search"].invoke({"query": "Ada Lovelace"})
        self.assertTrue(text.startswith("tier=lite"))
        self.assertIn("https://example.com/ada", text)
        self.assertIn("first programmer", text)
        self.assertNotIn("abstract:", text)
        self.assertEqual(fetched, [])

    def test_google_empty_query_and_offline_pro(self):
        lite = run_pro("google_search", {"query": "  "}, lambda _args: "unused")
        self.assertIn("pro_fallback", lite)
        self.assertIn("empty search query", lite)
        with patch.dict(os.environ, {"TIR_OFFLINE_SEARCH": "1"}):
            text = run_pro(
                "google_search",
                {"query": "Ada"},
                lambda _args: "search_unavailable: TIR_OFFLINE_SEARCH=1",
            )
        self.assertIn("pro_fallback", text)
        self.assertIn("TIR_OFFLINE_SEARCH", text)

    def test_google_pro_uses_parsed_serp_then_two_abstracts(self):
        def _request(method, url, **_kwargs):
            return _BING, ""

        fetched = []

        def _fetch(url, max_chars=2000):
            fetched.append((url, max_chars))
            if "three" in url:
                raise AssertionError(url)
            return f"Ada page body from {url}."

        with patch("tools.search._request", side_effect=_request), patch("tools.search.fetch_page", side_effect=_fetch):
            text = run_pro("google_search", {"query": "Ada"}, lambda _args: "lite serp")
        self.assertTrue(text.startswith("tier=pro\n"))
        self.assertNotIn("pro_fallback", text)
        self.assertEqual([item[0] for item in fetched], ["https://example.com/ada", "https://example.com/two"])
        self.assertTrue(all(item[1] == 800 for item in fetched))
        self.assertIn("snippet: first programmer", text)
        self.assertIn("abstract: Ada page body", text)
        self.assertNotIn("https://example.com/three", text)

    def test_web_python_and_think_pro(self):
        ok, reason = validate_tool_args("web_search", {"query": "Ada"})
        self.assertFalse(ok)
        self.assertIn("url", reason)

        def _fetch(url, max_chars=2000):
            self.assertEqual(max_chars, 4000)
            return "Ada Lovelace published notes. Unrelated sentence."

        with patch("tools.search.fetch_page", side_effect=_fetch):
            web = run_pro("web_search", {"query": "Ada", "url": "https://example.com/ada"}, lambda _args: "lite page")
        self.assertTrue(web.startswith("tier=pro"))
        self.assertIn("query_matches:", web)
        self.assertIn("Ada Lovelace published notes.", web)

        python = run_pro("python_coder", {"code": "print('hi')\nresult = 2"}, TOOL_AGENTS["python_coder"]._kernel)
        self.assertTrue(python.startswith("tier=pro"))
        self.assertIn("stdout:", python)
        self.assertIn("hi", python)
        self.assertIn("result = 2", python)

        think = run_pro("think", {"text": "only the input"}, None)
        self.assertEqual(think, "tier=pro\nonly the input")

        with patch("tools.search.fetch_page", return_value="fetch_unavailable: down"):
            failed = run_pro("web_search", {"query": "Ada", "url": "https://example.com"}, lambda _args: "lite page")
        self.assertIn("pro_fallback", failed)
        self.assertIn("fetch_unavailable", failed)


if __name__ == "__main__":
    unittest.main()
