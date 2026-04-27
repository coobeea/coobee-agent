#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

log_file="${OLLAMA_DEBUG_LOG:-test-results/logs/openai-ollama-debug.log}"
mkdir -p "$(dirname "$log_file")"

DEBUG="${DEBUG:-openai-agents*}" \
OPENAI_AGENTS_DONT_LOG_MODEL_DATA="${OPENAI_AGENTS_DONT_LOG_MODEL_DATA:-false}" \
pnpm vitest run src/main/agent/runtime/openai/__tests__/OpenAIAgentRuntime.ollama.test.ts \
  -t "${OLLAMA_TEST_NAME:-步骤1}" \
  --reporter verbose \
  --no-color \
  "$@" 2>&1 | tee "$log_file"
