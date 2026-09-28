"""Assemble one group's real executions without changing rollout scheduling."""

from __future__ import annotations

from pathlib import Path

from .contracts import ExecutionTrace, RolloutTree, RolloutTreeEdge, RolloutTreeNode
from .execution_recording import attempt_directory
from .rollout_results import TERMINAL
from .rollout_tree import stable_id


def read_trace(root: Path, rollout_id: str, attempt_id: str, *,
               cache: dict[Path, tuple[int, int, ExecutionTrace]] | None = None) -> ExecutionTrace | None:
    path = attempt_directory(root, rollout_id, attempt_id) / "index.json"
    try:
        stat = path.stat()
        saved = cache.get(path) if cache is not None else None
        if saved and saved[:2] == (stat.st_mtime_ns, stat.st_size):
            return saved[2]
        with path.open("rb") as stream:
            raw = stream.read(4 * 1024 * 1024 + 1)
    except FileNotFoundError:
        return None
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("Execution index exceeds the read limit")
    trace = ExecutionTrace.model_validate_json(raw)
    if (trace.rollout_id, trace.attempt_id) != (rollout_id, attempt_id):
        raise ValueError("Execution index belongs to another attempt")
    for node in trace.nodes:
        if (node.rollout_id, node.attempt_id, node.kind) != (rollout_id, attempt_id, "execution"):
            raise ValueError("Execution node belongs to another attempt")
    if cache is not None:
        cache[path] = (stat.st_mtime_ns, stat.st_size, trace)
    return trace


def assemble_executions(tree: RolloutTree, root: Path, *,
                        cache: dict[Path, tuple[int, int, ExecutionTrace]] | None = None) -> bool:
    """Rebuild small metadata only; never read node message bodies."""
    before = (tree.nodes, tree.edges, tree.issues)
    query = tree.nodes[0]
    nodes = [query]
    edges: list[RolloutTreeEdge] = []
    issues: list[str] = []
    traces: dict[tuple[str, str], ExecutionTrace] = {}
    records: list[RolloutTreeNode] = []
    for record in tree.rollouts:
        for previous in record.previous_attempts:
            attempt_id = previous["attempt_id"]
            result_id = "outcome:" + stable_id(record.node_id, attempt_id)
            historical = record.model_copy(update={
                "attempt_id": attempt_id, "store_status": previous.get("store_status"),
                "status": "failed" if previous.get("execution_error") else previous.get("store_status"),
                "result_node_id": result_id, "previous_attempts": [],
            })
            records.append(historical)
            if previous.get("outcome") is not None:
                tree.outcomes[result_id] = previous["outcome"]
        if record.attempt_id:
            records.append(record)
    for record in records:
        trace = read_trace(root, record.node_id, record.attempt_id, cache=cache)
        if trace:
            traces[(record.node_id, record.attempt_id)] = trace
            nodes.extend(trace.nodes)
            edges.extend(trace.edges)
            issues.extend(trace.errors)
        elif record.store_status in TERMINAL:
            issues.append(f"Execution details unavailable: {record.node_id}/{record.attempt_id}")

    for record in records:
        trace = traces.get((record.node_id, record.attempt_id))
        source_ids = [query.node_id] if record.origin != "branch" else []
        if record.origin == "branch" and trace:
            resume = trace.resume
            source = traces.get((resume.get("source_rollout_id"), resume.get("source_attempt_id")))
            window = source.windows.get(resume.get("window_id")) if source else None
            if (trace.resume_applied and resume.get("source_rollout_id") == record.parent_id
                    and window and window.get("snapshot_ref")
                    and window["snapshot_ref"] == resume.get("snapshot_ref")
                    and window.get("prefix_hash") and window["prefix_hash"] == resume.get("prefix_hash")
                    and window["fork_node_ids"] == resume.get("fork_node_ids")):
                source_ids = window["fork_node_ids"]
            else:
                issues.append(f"Unconfirmed execution prefix: {record.node_id}/{record.attempt_id}")
        if trace:
            for source_id in source_ids:
                for target_id in trace.entry_ids:
                    edges.append(RolloutTreeEdge(
                        source_node_id=source_id, target_node_id=target_id,
                        kind="branch" if record.origin == "branch" else "sequence",
                        window_id=trace.resume.get("window_id") if record.origin == "branch" else None,
                        snapshot_ref=trace.resume.get("snapshot_ref") if record.origin == "branch" else None,
                        site_id=record.site_id,
                    ))
        if record.store_status in TERMINAL and record.result_node_id:
            result = record.model_copy(update={
                "node_id": record.result_node_id, "kind": "outcome", "parent_id": None,
                "rollout_id": record.node_id, "detail_ref": None, "previous_attempts": [],
            })
            nodes.append(result)
            for tail in trace.tail_ids if trace and trace.tail_ids else source_ids:
                edges.append(RolloutTreeEdge(source_node_id=tail, target_node_id=result.node_id))
        elif record.store_status not in TERMINAL and not trace:
            # The rollout record remains visible as queued; no fabricated Agent node.
            continue
    tree.nodes, tree.edges, tree.issues = nodes, edges, list(dict.fromkeys(issues))
    return before != (tree.nodes, tree.edges, tree.issues)
