"""HIVE-style retrieval for tool-agents marked tier=pro.

Uses the existing HTTP kernels. Does not import HIVE tool classes: those call
``sys.exit`` without an API key and pull page RAG, embeddings, and extra models.
"""

from __future__ import annotations

import os
import re
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import quote

Kernel = Optional[Callable[[Dict[str, Any]], str]]


def _offline() -> bool:
    return os.getenv("TIR_OFFLINE_SEARCH", "").strip().lower() in ("1", "true", "yes")


def _terms(text: str) -> set:
    return set(re.findall(r"[a-z0-9]+", (text or "").lower()))


def select_titles(query: str, titles: List[str], limit: int = 3) -> List[str]:
    """Pick titles that share terms with the query. Empty overlap keeps the first title."""
    scored = []
    query_terms = _terms(query)
    for index, title in enumerate(titles):
        scored.append((len(query_terms & _terms(title)), -index, title))
    scored.sort(reverse=True)
    picked = [title for score, _index, title in scored if score > 0][:limit]
    if not picked and titles:
        return titles[:1]
    return picked


def wiki_page_url(title: str) -> str:
    return "https://en.wikipedia.org/wiki/" + quote((title or "").replace(" ", "_"))


def _lite(kernel: Kernel, args: Dict[str, Any]) -> str:
    if kernel is None:
        return ""
    try:
        return str(kernel(args))
    except Exception as exc:  # noqa: BLE001
        return f"lite error: {exc}"


def _fallback(kernel: Kernel, args: Dict[str, Any], body: str = "") -> str:
    lite = body or _lite(kernel, args)
    return f"tier=pro pro_fallback\n{lite}".rstrip()


def _wikipedia_pro(query: str, kernel: Kernel, args: Dict[str, Any]) -> str:
    if _offline():
        return _fallback(kernel, args)
    try:
        import requests
        from .search import proxy_candidates
    except Exception as exc:  # noqa: BLE001
        return _fallback(kernel, args, f"pro setup failed: {exc}")

    headers = {"User-Agent": "tir-agent/1.0 (agent-lightning; educational)"}
    hits: List[Dict[str, Any]] = []
    used = None
    last_err = "no proxy candidate"
    for proxies in proxy_candidates():
        label = (proxies or {}).get("http") or "direct"
        try:
            resp = requests.get(
                "https://en.wikipedia.org/w/api.php",
                params={
                    "action": "query",
                    "list": "search",
                    "srsearch": query,
                    "srlimit": 5,
                    "format": "json",
                },
                headers=headers,
                timeout=15,
                proxies=proxies,
            )
            if resp.status_code >= 400:
                last_err = f"{label}: HTTP {resp.status_code}"
                continue
            hits = list(resp.json().get("query", {}).get("search", []) or [])
            used = proxies
            if hits:
                break
            last_err = f"{label}: 0 hits"
        except Exception as exc:  # noqa: BLE001
            last_err = f"{label}: {type(exc).__name__}: {exc}"
    if not hits:
        return _fallback(kernel, args, f"search_unavailable: {last_err}")

    titles = [str(hit.get("title") or "") for hit in hits if hit.get("title")]
    chosen = set(select_titles(query, titles, 3))
    parts: List[str] = []
    for hit in hits:
        title = str(hit.get("title") or "")
        if title not in chosen:
            continue
        snippet = str(hit.get("snippet") or "").replace('<span class="searchmatch">', "").replace("</span>", "")
        extract = ""
        try:
            summary = requests.get(
                f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title)}",
                headers=headers,
                timeout=15,
                proxies=used,
            )
            if summary.status_code < 400:
                extract = str(summary.json().get("extract") or "")
        except Exception:
            extract = ""
        parts.append(f"{title}\n{wiki_page_url(title)}\n{extract or snippet}")
    if not parts:
        return _fallback(kernel, args, f"search_unavailable: {last_err}")
    return "tier=pro\n" + "\n\n".join(parts)


def _google_pro(query: str, kernel: Kernel, args: Dict[str, Any]) -> str:
    if _offline():
        return _fallback(kernel, args)
    try:
        from .search import _format_organic, fetch_page, search_organic
    except Exception as exc:  # noqa: BLE001
        return _fallback(kernel, args, f"pro setup failed: {exc}")
    organic, err = search_organic(query, 5)
    if not organic:
        return _fallback(kernel, args, err)
    blocks: List[str] = []
    for item in organic:
        if len(blocks) >= 2:
            break
        link = item.get("link") or ""
        page = fetch_page(link, max_chars=800) if link else ""
        if not page or page.startswith(("fetch_unavailable", "Error", "search_unavailable")):
            continue
        blocks.append(
            f"{item.get('title')}\n{link}\nsnippet: {item.get('snippet')}\nabstract: {page}"
        )
    if not blocks:
        return _fallback(kernel, args, _format_organic(organic))
    return "tier=pro\n" + "\n\n".join(blocks)


def _web_pro(query: str, url: str, kernel: Kernel, args: Dict[str, Any]) -> str:
    if _offline():
        return _fallback(kernel, args)
    try:
        from .search import fetch_page
    except Exception as exc:  # noqa: BLE001
        return _fallback(kernel, args, f"pro setup failed: {exc}")
    page = fetch_page(url, max_chars=4000)
    if not page or page.startswith(("fetch_unavailable", "Error", "search_unavailable")):
        return _fallback(kernel, args, page)
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", page) if part.strip()]
    query_terms = _terms(query)
    matches = [sentence for sentence in sentences if query_terms & _terms(sentence)][:5]
    body = page
    if matches:
        body = page + "\n\nquery_matches:\n" + "\n".join(matches)
    return f"tier=pro\n{body}"


def run_pro(name: str, args: Dict[str, Any], kernel: Kernel) -> str:
    """Run the strengthened tool. Failures keep the lite text and say pro_fallback."""
    payload = args if isinstance(args, dict) else {}
    try:
        if name == "wikipedia_search":
            query = str(payload.get("query") or "")
            if not query.strip():
                return _fallback(kernel, payload, "Error: empty wikipedia query.")
            return _wikipedia_pro(query, kernel, payload)
        if name == "google_search":
            query = str(payload.get("query") or "")
            if not query.strip():
                return _fallback(kernel, payload, "Error: empty search query.")
            return _google_pro(query, kernel, payload)
        if name == "web_search":
            return _web_pro(str(payload.get("query") or ""), str(payload.get("url") or ""), kernel, payload)
        if name == "python_coder":
            lite = _lite(kernel, payload)
            return f"tier=pro\n{lite}".rstrip()
        if name == "think":
            text = str(payload.get("text") or payload.get("query") or payload.get("input") or "")
            return f"tier=pro\n{text}".rstrip()
    except Exception as exc:  # noqa: BLE001
        return _fallback(kernel, payload, f"pro error: {exc}")
    return _fallback(kernel, payload, f"unknown tool-agent {name}")
