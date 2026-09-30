"""Design-time Sampling capability projection backed by Adapter registry."""

from __future__ import annotations

from typing import Any

from workflow.contracts import BranchSite
from workflow.sampling.compat import selector_from_anchor, selector_key
from workflow.sampling.registry import sampling_adapters
from workflow.spec import MASSpec


def _opportunity_index(spec: MASSpec, strategy: str):
    adapter = sampling_adapters.resolve(strategy)
    return adapter, {
        selector_key(opportunity.selector): opportunity
        for opportunity in adapter.opportunities(spec)
    }


def site_capability(
    site: BranchSite,
    spec: MASSpec,
    *,
    strategy: str | None = None,
) -> tuple[str, str]:
    strategy = strategy or spec.sampling.mode
    _, opportunities = _opportunity_index(spec, strategy)
    selector = selector_from_anchor(site.anchor)
    opportunity = opportunities.get(selector_key(selector))
    if opportunity is None:
        return "error", f"当前策略 {strategy} 不支持此采样窗口。"
    if site.fork.resume_mode != "messages":
        return "error", "当前执行器仅支持 messages Snapshot 续跑。"
    if site.gate.type not in opportunity.allowed_gates:
        return "error", f"当前策略不支持 Gate {site.gate.type}。"
    if site.when not in ("first", "every", "nth") or (
        site.when == "nth" and site.nth < 1
    ):
        return "error", "Apply on 必须是 first、every 或正整数 nth。"
    return "pass", opportunity.message


_ANCHOR_KIND = {
    "tool_result": "after_tool",
    "agent_complete": "after_agent_turn",
    "verification_complete": "after_verifier",
    "router_decision": "after_agent_turn",
    "edge": "on_edge",
    "token": "on_token",
}


def _outgoing_edge(spec: MASSpec, owner: str | None):
    """First route, message, or feedback edge leaving this agent or router."""
    if not owner:
        return None
    matches = [
        (index, edge)
        for index, edge in enumerate(spec.edges)
        if edge.source == owner and edge.kind in ("route", "message", "feedback")
    ]
    concrete = [item for item in matches if not str(item[1].target).startswith("pool_")]
    if concrete:
        return concrete[0]
    return matches[0] if matches else None


def sampling_preview(workflow: dict[str, Any]) -> dict[str, Any]:
    spec = MASSpec.model_validate(workflow)
    sampling = spec.sampling
    adapter, supported = _opportunity_index(spec, sampling.mode)
    configured = {
        selector_key(selector_from_anchor(site.anchor)): site
        for site in sampling.sites
    }
    opportunities: list[dict[str, Any]] = []
    for key, opportunity in supported.items():
        selector = opportunity.selector
        tool_id = selector.interaction.get("tool_id")
        site = configured.get(key)
        owner = selector.owner_agent_id
        outgoing = _outgoing_edge(spec, owner)
        edge_target = outgoing[1].target if outgoing else owner
        edge_id = (
            f"e-{outgoing[1].source}-{outgoing[1].target}-{outgoing[0]}"
            if outgoing else None
        )
        opportunities.append(
            {
                "id": key,
                "node_id": owner,
                "edge_id": edge_id,
                "edge_source": owner,
                "edge_target": edge_target,
                "selector": selector.model_dump(mode="json"),
                "anchor": {
                    "kind": _ANCHOR_KIND.get(selector.kind.value, selector.kind.value),
                    "agent_id": owner,
                    "tool_id": tool_id,
                    "edge_id": selector.interaction.get("edge_id"),
                },
                "label": opportunity.message or f"{owner} 窗口结束后",
                "support": opportunity.support,
                "message": opportunity.message,
                "runtime_event": selector.kind.value,
                "prefix": "messages" if opportunity.resumable else None,
                "allowed_gates": list(opportunity.allowed_gates),
                "configured": site is not None,
                "enabled": bool(site and site.enabled),
                "site_id": site.id if site else None,
            }
        )

    diagnostics: list[dict[str, Any]] = []
    legacy_sites: list[dict[str, Any]] = []
    for site in sampling.sites:
        selector = selector_from_anchor(site.anchor)
        key = selector_key(selector)
        status, message = site_capability(site, spec, strategy=sampling.mode)
        diagnostics.append(
            {
                "site_id": site.id,
                "status": status,
                "message": message,
                "opportunity_id": key if key in supported else None,
            }
        )
        if key not in supported:
            legacy_sites.append(
                {
                    "site_id": site.id,
                    "enabled": site.enabled,
                    "selector": selector.model_dump(mode="json"),
                    "message": message,
                }
            )

    group_n = max(1, int(sampling.group_n))
    initial = max(1, min(int(sampling.initial_rollouts), group_n))
    return {
        "strategy": {
            "id": adapter.id,
            "source_mode": sampling.mode,
        },
        "policy": {
            "mode": sampling.mode,
            "group_n": group_n,
            "initial_rollouts": initial,
            "remaining_budget": max(0, group_n - initial),
            "beam_size": max(1, int(sampling.beam_size)),
            "max_branch_depth": max(1, int(sampling.max_branch_depth)),
        },
        "opportunities": opportunities,
        "legacy_sites": legacy_sites,
        "diagnostics": diagnostics,
        "legacy": (
            {
                "barriers": list(sampling.barriers),
                "count": len(sampling.barriers),
                "message": "旧 barrier 尚未绑定明确 Tool Result Window；请转换为显式 Site。",
            }
            if not sampling.sites and sampling.barriers
            else None
        ),
    }
