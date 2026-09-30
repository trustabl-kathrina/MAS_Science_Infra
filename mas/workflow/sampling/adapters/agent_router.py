"""Sampling opportunities after agents and routers, not inside a tool pool."""

from __future__ import annotations

from typing import Any, Iterable, Sequence

from workflow.sampling.contracts import (
    SamplingOpportunity,
    WindowKind,
    WindowSelector,
)
from workflow.spec import MASSpec


def _spec(workflow: Any) -> MASSpec:
    if isinstance(workflow, MASSpec):
        return workflow
    return MASSpec.model_validate(workflow)


def agent_router_opportunities(
    workflow: Any,
    *,
    allowed_gates: Sequence[str],
    message: str,
) -> Iterable[SamplingOpportunity]:
    """One optional window after each non-tool agent and each router."""
    spec = _spec(workflow)
    gates = list(allowed_gates)
    for agent in spec.agents:
        if str(agent.kind) == "tool":
            continue
        is_verifier = str(agent.kind) == "verifier" or agent.id == "verifier"
        kind = WindowKind.VERIFICATION_COMPLETE if is_verifier else WindowKind.AGENT_COMPLETE
        label = f"{agent.id} 核验结束后" if is_verifier else f"{agent.id} 窗口结束后"
        yield SamplingOpportunity(
            selector=WindowSelector(kind=kind, owner_agent_id=str(agent.id)),
            allowed_gates=gates,
            message=label or message,
        )
    for router in spec.routers or []:
        yield SamplingOpportunity(
            selector=WindowSelector(
                kind=WindowKind.AGENT_COMPLETE,
                owner_agent_id=str(router.id),
            ),
            allowed_gates=gates,
            message=f"{router.id} 路由结束后",
        )
