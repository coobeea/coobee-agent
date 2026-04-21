/**
 * Workspace API 客户端
 *
 * 封装工作目录文件操作相关的 HTTP API 调用
 */

import type { ApiResponse } from '@shared/api';
import configManager from '@/config';

const BASE_URL = configManager.getBaseUrl();

/** 文件节点 */
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
  modifiedAt?: string;
}

/** 文件树响应 */
export interface FileTreeResponse {
  root: string;
  depth: number;
  children: FileNode[];
}

/** 文件内容响应 */
export interface FileContentResponse {
  content: string;
  encoding?: string;
}

// ==================== API 方法 ====================

/**
 * 获取目录树
 */
export async function getFileTree(dirPath: string, depth = 3): Promise<FileTreeResponse> {
  const url = `${BASE_URL}/gateway/files/tree?path=${encodeURIComponent(dirPath)}&depth=${depth}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return data;
}

/**
 * 删除文件或目录
 */
export async function deleteNode(nodePath: string): Promise<{ success: boolean; path: string }> {
  const url = `${BASE_URL}/gateway/files/delete`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: nodePath })
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return data;
}

/**
 * 复制文件到工作目录
 */
export async function copyFileToWorkspace(
  sourcePath: string,
  targetDir: string
): Promise<{ success: boolean; sourcePath: string; targetPath: string; type: string }> {
  const url = `${BASE_URL}/gateway/files/copy`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourcePath, targetDir })
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return data;
}

/**
 * 上传文件到工作目录
 */
export async function uploadFile(params: {
  targetDir: string;
  fileName: string;
  content: string;
  encoding: 'base64' | 'utf8';
}): Promise<{ success: boolean; fileName: string; targetPath: string; size: number }> {
  const url = `${BASE_URL}/gateway/files/upload`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return data;
}

/**
 * 获取文件内容
 */
export async function getFileContent(filePath: string): Promise<FileContentResponse> {
  const url = `${BASE_URL}/gateway/files/content?path=${encodeURIComponent(filePath)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const content = await response.text();
  return { content };
}

/**
 * 读取本地文件（用于预览）
 */
export async function readLocalFile(filePath: string): Promise<string> {
  const response = await fetch(`file://${filePath}`);
  return response.text();
}
