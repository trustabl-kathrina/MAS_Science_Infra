"""Validate batch prerequisites without fabricating samples or changing rewards."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from itertools import islice
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agentlightning.types import RolloutLegacy

logger = logging.getLogger(__name__)


def require_training_samples(rollouts: Mapping[str, RolloutLegacy], agent_match: str | None) -> None:
    triplet_count = 0
    for rollout in rollouts.values():
        for triplet in rollout.triplets or []:
            triplet_count += 1
            prompt = triplet.prompt.get("token_ids")
            response = triplet.response.get("token_ids")
            if prompt and response:
                return
    message = (
        f"No usable training samples: {len(rollouts)} rollouts, {triplet_count} triplets; "
        f"agent_match={agent_match!r}. Training stopped before batch construction. "
        "Check episode errors, model-call spans, token IDs and Agent selection. "
        f"Rollout IDs: {', '.join(islice(rollouts, 5)) or '<none>'}"
    )
    logger.error(message)
    raise RuntimeError(message)
