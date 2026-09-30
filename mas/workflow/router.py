"""Router strategies for the centralized MAS topology.

A router is a graph node whose downstream is an **agent set** (``candidates``).
It unpacks an upstream ``plan_step`` into one or more ``tool_invoke`` hops.

- ``from_plan`` (alias ``llm_choice``): parse ``plan_step.next`` (str or
  list[str]) and ``args``, validate against ``candidates``. A list next
  fans out to multiple downstream agents in parallel. The router does not
  call an LLM — the planner already produced the payload.
- ``score``: each candidate runs its own window and produces a score; the
  ``scorer`` agent picks the highest. Used for multi-expert blank-agent panels.
- ``round_robin``: deterministic rotation by call count (fixed-shape groups
  for training).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from .protocol import validate_payload
from .spec import RouterSpec


@dataclass
class RouteResult:
    selected: List[str] = field(default_factory=list)
    args_list: List[Dict[str, Any]] = field(default_factory=list)
    ok: bool = True
    reason: str = ""
    strategy: str = "from_plan"
    metrics: Dict[str, Any] = field(default_factory=dict)


# round-robin counters keyed by router id (module-level, training-stable)
_ROBIN_COUNTERS: Dict[str, int] = {}


def _normalize_next(next_val: Any) -> List[str]:
    if next_val is None:
        return []
    if isinstance(next_val, str):
        return [next_val] if next_val else []
    if isinstance(next_val, list):
        return [str(x) for x in next_val if x]
    return [str(next_val)]


def _normalize_args(args_val: Any, n: int) -> List[Dict[str, Any]]:
    if args_val is None:
        return [{} for _ in range(n)]
    if isinstance(args_val, dict):
        return [args_val for _ in range(n)]
    if isinstance(args_val, list):
        out = []
        for i in range(n):
            a = args_val[i] if i < len(args_val) else {}
            out.append(a if isinstance(a, dict) else {})
        return out
    return [{} for _ in range(n)]


def select(
    router_spec: RouterSpec,
    upstream_msg: Any,
    candidates: List[str],
    *,
    scorer_runner: Optional[Callable[[str, Dict[str, Any]], Tuple[str, float]]] = None,
    candidate_runner: Optional[Callable[[str, Dict[str, Any]], str]] = None,
    strict: bool = True,
) -> RouteResult:
    """Pick candidate(s) for the next hop per the router's strategy.

    ``upstream_msg`` is the planner's ``AgentMessage`` (kind=plan_step) for
    ``llm_choice``; the candidate window outputs for ``score``; ignored by
    ``round_robin``.
    """
    strategy = str(router_spec.strategy or "from_plan")
    if strategy == "llm_choice":
        strategy = "from_plan"
    cands = list(candidates or router_spec.candidates or [])
    if not cands:
        return RouteResult(ok=False, reason="router has no candidates", strategy=strategy)

    if strategy == "from_plan":
        return _select_from_plan(router_spec, upstream_msg, cands, strategy, strict=strict)
    if strategy == "round_robin":
        return _select_round_robin(router_spec, cands, strategy, upstream_msg)
    if strategy == "score":
        return _select_score(router_spec, cands, strategy, scorer_runner, candidate_runner)
    return RouteResult(ok=False, reason=f"unknown strategy {strategy!r}", strategy=strategy)


def _select_from_plan(router_spec, upstream_msg, cands, strategy, *, strict: bool = True) -> RouteResult:
    payload = getattr(upstream_msg, "payload", None)
    if not isinstance(payload, dict):
        return RouteResult(ok=False, reason="from_plan needs a plan_step upstream", strategy=strategy)
    ok, reason = validate_payload("plan_step", payload)
    if not ok:
        return RouteResult(ok=False, reason=f"invalid plan_step: {reason}", strategy=strategy)
    next_list = _normalize_next(payload.get("next"))
    if not next_list:
        return RouteResult(ok=False, reason="plan_step.next is empty", strategy=strategy)
    args_all = _normalize_args(payload.get("args"), len(next_list))
    selected: List[str] = []
    args_list: List[Dict[str, Any]] = []
    rejected: List[str] = []
    for n, a in zip(next_list, args_all):
        if n in cands:
            selected.append(n)
            args_list.append(a)
        else:
            rejected.append(n)
    if strict and rejected:
        return RouteResult(
            ok=False,
            reason=f"plan_step.next {rejected!r} not in candidates {cands!r}",
            strategy=strategy,
            metrics={"rejected": rejected},
        )
    if not selected:
        return RouteResult(
            ok=False,
            reason=f"plan_step.next {next_list!r} not in candidates {cands!r}",
            strategy=strategy,
            metrics={"rejected": rejected},
        )
    return RouteResult(
        selected=selected,
        args_list=args_list,
        ok=True,
        strategy=strategy,
        metrics={"candidates": cands, "strategy": strategy, "rejected": rejected, "sub_goal": payload.get("sub_goal")},
    )


def _select_round_robin(router_spec, cands, strategy, upstream_msg=None) -> RouteResult:
    rid = str(router_spec.id)
    i = _ROBIN_COUNTERS.get(rid, 0)
    pick = cands[i % len(cands)]
    _ROBIN_COUNTERS[rid] = i + 1
    payload = getattr(upstream_msg, "payload", None) if upstream_msg is not None else None
    args = {}
    if isinstance(payload, dict):
        raw = payload.get("args")
        if isinstance(raw, dict):
            args = raw
        elif isinstance(raw, list) and raw and isinstance(raw[0], dict):
            args = raw[0]
    return RouteResult(
        selected=[pick],
        args_list=[args],
        ok=True,
        strategy=strategy,
        metrics={"index": i, "candidates": cands},
    )


def _select_score(router_spec, cands, strategy, scorer_runner, candidate_runner) -> RouteResult:
    if scorer_runner is None:
        return RouteResult(ok=False, reason="score strategy needs a scorer_runner", strategy=strategy)
    scores: Dict[str, float] = {}
    outputs: Dict[str, str] = {}
    for c in cands:
        if candidate_runner is not None:
            try:
                outputs[c] = candidate_runner(c, {})
            except Exception as e:  # noqa: BLE001
                outputs[c] = ""
                scores[c] = float("-inf")
                continue
        try:
            _picked, score = scorer_runner(c, {"output": outputs.get(c, "")})
        except Exception:  # noqa: BLE001
            score = float("-inf")
        scores[c] = float(score)
    if not scores:
        return RouteResult(ok=False, reason="no candidate scored", strategy=strategy)
    best = max(scores, key=scores.get)
    return RouteResult(
        selected=[best],
        args_list=[{}],
        ok=True,
        strategy=strategy,
        metrics={"scores": scores, "candidates": cands},
    )


def reset_round_robin(router_id: Optional[str] = None) -> None:
    """Reset round-robin counters (test helper)."""
    if router_id is None:
        _ROBIN_COUNTERS.clear()
    else:
        _ROBIN_COUNTERS.pop(router_id, None)
