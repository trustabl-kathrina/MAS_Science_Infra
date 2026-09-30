#!/usr/bin/env bash
# Serve the local Qwen3-4B weights as an OpenAI-compatible endpoint via vLLM.
# Used by MAS integration tests and runtime so the framework never calls a
# cloud API. The model id exposed to clients is "Qwen3-4B".
set -euo pipefail

MODEL="${LOCAL_LLM_MODEL:-/root/autodl-tmp/MAS_Science_Infra/LLM/Qwen3-4B}"
PORT="${LOCAL_LLM_PORT:-8000}"
NAME="${LOCAL_LLM_NAME:-Qwen3-4B}"
MAX_LEN="${LOCAL_LLM_MAX_LEN:-8192}"
GPU_UTIL="${LOCAL_LLM_GPU_UTIL:-0.9}"

if [ ! -f "$MODEL/config.json" ]; then
  echo "error: model weights not found at $MODEL" >&2
  exit 1
fi

exec vllm serve "$MODEL" \
  --served-model-name "$NAME" \
  --port "$PORT" \
  --host 0.0.0.0 \
  --trust-remote-code \
  --max-model-len "$MAX_LEN" \
  --gpu-memory-utilization "$GPU_UTIL"
