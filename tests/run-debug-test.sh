#!/usr/bin/env bash
set -euo pipefail

# ===== 用法 =====
#   ./tests/run-debug-test.sh <测试名称>
#
# 示例：
#   ./tests/run-debug-test.sh "步骤4"     # 只跑步骤4
#   ./tests/run-debug-test.sh "步骤1"     # 只跑步骤1
#
# 可选环境变量：
#   TEST_FILE                   测试文件路径（默认 OpenAIAgentRuntime.ollama.test.ts）
#   DEBUG                       debug 命名空间（默认 openai-agents*）
#   OPENAI_AGENTS_DONT_LOG_MODEL_DATA  是否隐藏模型数据（默认 false）
#   OLLAMA_DEBUG_LOG            日志输出路径（默认自动带时间戳）
#
# 切换测试文件示例：
#   TEST_FILE=src/main/agent/runtime/openai/__tests__/OllamaNativeReasoning.test.ts \
#     bash tests/run-debug-test.sh "步骤A"

if [ $# -eq 0 ]; then
  echo "错误：缺少测试名称参数"
  echo "用法：$0 <测试名称>"
  echo "示例：$0 \"步骤4：关闭思维链\""
  exit 1
fi

TEST_NAME="$1"
shift

cd "$(dirname "$0")/.."

timestamp=$(date +%Y%m%d-%H%M%S)
test_file="${TEST_FILE:-src/main/agent/runtime/openai/__tests__/OpenAIAgentRuntime.ollama.test.ts}"
log_file="${OLLAMA_DEBUG_LOG:-"test-results/logs/debug-$timestamp.log"}"
mkdir -p "$(dirname "$log_file")"

echo "===== 运行测试: $TEST_NAME ====="
echo "测试文件: $test_file"
echo "日志文件: $log_file"
echo

DEBUG="${DEBUG:-openai-agents*}" \
OPENAI_AGENTS_DONT_LOG_MODEL_DATA="${OPENAI_AGENTS_DONT_LOG_MODEL_DATA:-false}" \
pnpm vitest run "$test_file" \
  -t "$TEST_NAME" \
  --reporter verbose \
  --no-color \
  "$@" 2>&1 | tee "$log_file"
