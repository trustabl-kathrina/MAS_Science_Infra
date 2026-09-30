"""Shared pytest fixtures for MAS workflow tests.

Provides a ``local_llm_endpoint`` fixture that probes the local vLLM-served
Qwen3-4B OpenAI-compatible endpoint and skips the test when it is not running,
so tests never fall back to a cloud API. The endpoint is started out-of-band
via ``scripts/serve_local_llm.sh``.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from typing import Optional

import pytest

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
for _p in (str(ROOT), str(REPO)):
    if _p not in sys.path:
        sys.path.insert(0, _p)


os.environ.setdefault("SCIENCE_INFRA_TOOL_KERNEL", "1")
LOCAL_LLM_HOST = os.environ.get("LOCAL_LLM_HOST", "localhost")
LOCAL_LLM_PORT = os.environ.get("LOCAL_LLM_PORT", "8000")
LOCAL_LLM_NAME = os.environ.get("LOCAL_LLM_NAME", "Qwen3-4B")
LOCAL_LLM_BASE = os.environ.get(
    "OPENAI_API_BASE", f"http://{LOCAL_LLM_HOST}:{LOCAL_LLM_PORT}/v1"
)


def _endpoint_up() -> bool:
    """True when the local vLLM endpoint responds with the served model."""
    try:
        import json
        import urllib.request

        req = urllib.request.Request(f"{LOCAL_LLM_BASE}/models")
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        for m in data.get("data", []) or []:
            if str(m.get("id") or "") == LOCAL_LLM_NAME:
                return True
        return False
    except Exception:
        return False


@pytest.fixture(scope="session")
def local_llm_endpoint():
    """Yield the local LLM endpoint config, or skip the test if down."""
    if not _endpoint_up():
        pytest.skip(f"local LLM not running at {LOCAL_LLM_BASE} (start scripts/serve_local_llm.sh)")
    return {
        "base_url": LOCAL_LLM_BASE,
        "model": LOCAL_LLM_NAME,
        "api_key": os.environ.get("OPENAI_API_KEY", "EMPTY"),
    }


@pytest.fixture(scope="session")
def local_llm_config(local_llm_endpoint):
    """Build a workflow.runtime.LLMConfig bound to the local endpoint."""
    from workflow.runtime import LLMConfig

    return LLMConfig(
        endpoint=local_llm_endpoint["base_url"],
        model=local_llm_endpoint["model"],
        api_key=local_llm_endpoint["api_key"],
    )


class LocalLLMRequired(unittest.TestCase):
    """Mixin: skip unittest-style cases when the local LLM is not up."""

    def setUp(self) -> None:  # noqa: D401
        if not _endpoint_up():
            self.skipTest(f"local LLM not running at {LOCAL_LLM_BASE}")
        super().setUp()
