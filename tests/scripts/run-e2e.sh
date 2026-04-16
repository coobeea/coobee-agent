#!/bin/bash

# 运行端到端测试
# 自动检查前置条件

set -e

echo "🧪 Coobee Agent 端到端测试"
echo ""

# 检查应用是否运行
echo "🔍 检查应用状态..."
if curl -s http://127.0.0.1:8765/gateway/agents > /dev/null 2>&1; then
  echo "✅ 应用运行正常 (http://127.0.0.1:8765)"
else
  echo "❌ 应用未运行"
  echo ""
  echo "请先启动应用："
  echo "  方式1: pnpm dev"
  echo "  方式2: ./tests/scripts/start-test-server.sh"
  exit 1
fi

# 检查 Ollama
echo ""
echo "🔍 检查 Ollama..."
if curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
  echo "✅ Ollama 运行正常"
else
  echo "❌ Ollama 未运行"
  echo "   请运行: ollama serve"
  exit 1
fi

# 检查模型
echo ""
echo "🔍 检查模型..."
if curl -s http://127.0.0.1:11434/api/tags | grep -q "qwen3.5:9b"; then
  echo "✅ qwen3.5:9b 模型已安装"
else
  echo "❌ qwen3.5:9b 模型未安装"
  echo "   请运行: ollama pull qwen3.5:9b"
  exit 1
fi

# 运行测试
echo ""
echo "🧪 运行端到端测试..."
echo ""

pnpm test:e2e "$@"
