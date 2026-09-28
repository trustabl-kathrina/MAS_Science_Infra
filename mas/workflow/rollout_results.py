"""Attempt-scoped rollout results and merges, independent of Store and UI."""

from __future__ import annotations

import json
from typing import Any, Literal, Sequence

from pydantic import BaseModel, Field

from .contracts import ExecutionFailure, RolloutTree, RolloutTreeNode

RESULT_ATTRIBUTE = "tir.rollout_result"
TERMINAL = {"succeeded", "failed", "cancelled"}
STATUS_ORDER = {"queuing": 0, "preparing": 1, "running": 2,
                "succeeded": 3, "failed": 3, "cancelled": 3, "requeuing": 4}
STATUS_VIEW = {"queuing": "enqueued", "requeuing": "enqueued", "preparing": "enqueued",
               "running": "running", "succeeded": "succeeded", "failed": "failed", "cancelled": "cancelled"}


class RunnerResult(BaseModel):
    schema_version: Literal[1] = 1
    rollout_id: str
    attempt_id: str
    answer: str | None = Field(default=None, max_length=4000)
    answer_truncated: bool = False
    format_ok: bool
    execution_error: Literal["execution_error"] | None = None
    error_details: ExecutionFailure | None = None
    reward: float = Field(allow_inf_nan=False)
    archive_id: str | None = None

    model_config = {"extra": "forbid"}


def result_annotation(rollout_id: str, attempt_id: str, answer: str | None,
                      reward: float, format_ok: bool, failed: bool,
                      archive_id: str | None = None, *,
                      error_details: ExecutionFailure | None = None) -> str:
    return RunnerResult(
        rollout_id=rollout_id, attempt_id=attempt_id,
        answer=answer[:4000] if answer is not None else None,
        answer_truncated=answer is not None and len(answer) > 4000,
        reward=reward, format_ok=format_ok,
        execution_error="execution_error" if failed else None,
        archive_id=archive_id or None,
        error_details=error_details,
    ).model_dump_json()


def read_results(spans: list[Any], rollout_id: str, attempt_id: str) -> list[RunnerResult]:
    results = []
    for span in spans:
        raw = (span.attributes or {}).get(RESULT_ATTRIBUTE)
        if raw is None:
            continue
        result = RunnerResult.model_validate_json(raw)
        if result.rollout_id != rollout_id or result.attempt_id != attempt_id:
            raise ValueError("Runner result does not belong to the queried rollout/attempt")
        results.append(result)
    return results


def add_issue(node: RolloutTreeNode, message: str) -> None:
    if message not in node.record_issues:
        node.record_issues.append(message)


def merge_observation(
    tree: RolloutTree, node: RolloutTreeNode, *, attempt_id: str | None,
    sequence: int, store_status: str, attempt_status: str | None = None,
    started_at: float | None = None, ended_at: float | None = None,
    results: Sequence[RunnerResult] = (), reward: float | None = None,
    training_status: str | None = None,
) -> bool:
    result_key = node.result_node_id or node.node_id
    before = (node.model_dump_json(), json.dumps(tree.outcomes.get(result_key), sort_keys=True))
    if sequence < node.attempt_sequence:
        return False
    if sequence == node.attempt_sequence and node.attempt_id not in (None, attempt_id):
        add_issue(node, "Conflicting attempt identity at the same sequence")
        return before[0] != node.model_dump_json()
    if sequence > node.attempt_sequence:
        if node.attempt_id:
            node.previous_attempts.append({
                "attempt_id": node.attempt_id, "sequence": node.attempt_sequence,
                "store_status": node.store_status, "execution_error": node.execution_error,
                "training_status": node.training_status, "record_issues": list(node.record_issues),
                "outcome": tree.outcomes.pop(result_key, None),
                "judgments": list(node.judgments), "credit": node.reward, "verdict": node.verdict,
            })
        node.record_issues = []
        node.judgments = []
        node.reward = node.verdict = None
        node.execution_error = node.training_status = None
        node.store_status = node.attempt_status = None
        node.started_at = node.ended_at = None
    node.attempt_id, node.attempt_sequence = attempt_id, sequence
    if tree.schema_version == 3 and attempt_id:
        from .rollout_tree import stable_id

        result_key = "outcome:" + stable_id(node.node_id, attempt_id)
        node.result_node_id = result_key
    if store_status not in STATUS_ORDER:
        add_issue(node, f"Unrecognized Store status: {store_status}")
    elif STATUS_ORDER[store_status] >= STATUS_ORDER.get(node.store_status, -1):
        if node.store_status in TERMINAL and store_status in TERMINAL and node.store_status != store_status:
            add_issue(node, "Conflicting terminal Store statuses")
        else:
            node.store_status = store_status
            node.status = STATUS_VIEW[store_status]
            node.attempt_status = attempt_status
            if started_at is not None:
                node.started_at = started_at
            if ended_at is not None:
                node.ended_at = ended_at
    outcome = dict(tree.outcomes.get(result_key) or {})

    def put(key: str, value: Any) -> None:
        if value is None:
            return
        if key in outcome and outcome[key] != value:
            add_issue(node, f"Conflicting result field: {key}")
        else:
            outcome[key] = value

    for result in results:
        if result.rollout_id != node.node_id or result.attempt_id != attempt_id:
            add_issue(node, "Result identity mismatch")
            continue
        for key in ("answer", "answer_truncated", "format_ok", "reward", "archive_id", "execution_error"):
            put(key, getattr(result, key))
        if result.error_details is not None:
            put("error_details", result.error_details.model_dump())
        put("result_source", "runner_annotation_v1")
    if reward is not None:
        put("reward", reward)
    elif "reward" in outcome and "reward_source" not in outcome:
        outcome["reward_source"] = "runner_emitted_reward"
    # Identical values from the adapter strengthen provenance without a conflict.
    if reward is not None and outcome.get("reward") == reward:
        outcome["reward_source"] = "adapter_reward"
    if outcome:
        outcome["attempt_id"] = attempt_id
        tree.outcomes[result_key] = outcome
    node.execution_error = outcome.get("execution_error") or (
        node.attempt_status if node.attempt_status in ("timeout", "unresponsive", "failed") else None
    )
    if node.execution_error and node.store_status != "requeuing":
        node.status = "failed"
    if training_status and not (node.training_status == "accepted" and training_status == "adapted"):
        node.training_status = training_status
    return before != (node.model_dump_json(), json.dumps(tree.outcomes.get(result_key), sort_keys=True))


def merge_judgments(node: RolloutTreeNode, judgments: list[dict[str, Any]], step: int) -> bool:
    before = node.model_dump_json()
    for item in judgments:
        entry = {key: item.get(key) for key in ("action_key", "window_id", "site_id", "scheme", "verdict")}
        entry.update(step=step, attempt_id=node.attempt_id, source="training_batch")
        if entry not in node.judgments:
            node.judgments.append(entry)
    values = {entry["verdict"] for entry in node.judgments}
    node.verdict = next(iter(values)) if len(values) == 1 and values <= {"validate", "invalidate", "abstain"} else None
    if len(values) > 1:
        add_issue(node, "Multiple verdicts; inspect action/window judgments")
    node.training_status = "accepted"
    return before != node.model_dump_json()
