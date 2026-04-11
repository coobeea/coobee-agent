/**
 * FileReference - Tiptap 文件引用扩展
 *
 * 允许在富文本编辑器中插入文件引用，显示为带图标的小标签。
 * 数据结构：{ path: 完整路径, name: 文件名 }
 *
 * 注意：需要安装 @tiptap/core 依赖后才能使用
 * 当前处于占位符状态，等后续集成富文本编辑器时再启用
 */

export interface FileReferenceOptions {
  HTMLAttributes: Record<string, unknown>;
}

export interface FileReferenceAttrs {
  path: string;
  name: string;
}

// 暂时导出空对象，等安装 tiptap 后再启用
export const FileReference = null as any;
