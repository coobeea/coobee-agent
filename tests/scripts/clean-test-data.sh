#!/bin/bash

# 清理端到端测试生成的数据

echo "🧹 清理端到端测试数据"
echo ""

# 确认清理
read -p "确定要清理所有测试数据吗？(y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ 已取消"
  exit 0
fi

# 清理 workspaces
if [ -d ".home/workspaces" ]; then
  echo "🗑️  清理 workspaces..."
  rm -rf .home/workspaces/*
  echo "✅ workspaces 已清理"
else
  echo "⚠️  workspaces 目录不存在"
fi

# 清理 threads
if [ -d ".home/threads" ]; then
  echo "🗑️  清理 threads..."
  rm -rf .home/threads/*
  echo "✅ threads 已清理"
else
  echo "⚠️  threads 目录不存在"
fi

# 清理 agents（可选，慎重）
read -p "是否清理用户创建的 agents？(y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  if [ -d ".home/agents" ]; then
    echo "🗑️  清理 agents..."
    rm -rf .home/agents/*
    echo "✅ agents 已清理"
  else
    echo "⚠️  agents 目录不存在"
  fi
fi

echo ""
echo "✅ 清理完成！"
