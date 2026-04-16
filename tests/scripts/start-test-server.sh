#!/bin/bash

# 启动测试服务器
# 用于端到端测试前准备环境

set -e

echo "🚀 启动 Coobee Agent 测试服务器"
echo ""

# 检查 Ollama 是否运行
echo "🔍 检查 Ollama..."
if curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
  echo "✅ Ollama 运行正常"
else
  echo "❌ Ollama 未运行，请先启动 Ollama"
  echo "   运行: ollama serve"
  exit 1
fi

# 检查模型是否存在
echo ""
echo "🔍 检查模型..."
if curl -s http://127.0.0.1:11434/api/tags | grep -q "qwen3.5:9b"; then
  echo "✅ qwen3.5:9b 模型已安装"
else
  echo "⚠️  qwen3.5:9b 模型未安装"
  echo "   正在安装..."
  ollama pull qwen3.5:9b
  echo "✅ 模型安装完成"
fi

# 启动应用
echo ""
echo "🚀 启动 Coobee Agent..."
echo "   地址: http://127.0.0.1:8765"
echo "   按 Ctrl+C 停止"
echo ""

# 启动开发服务器
pnpm dev
