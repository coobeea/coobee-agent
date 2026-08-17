/**
 * Extension Loader 骨架：扫描 searchPaths 并加载模块（完整 WASM/动态加载后续增强）。
 */
export interface ExtensionSearchPath {
  root: string;
  origin?: string;
}

export interface ExtensionModule {
  id: string;
  register(api: unknown): Promise<void> | void;
  unregister?(): Promise<void> | void;
}

export interface ExtensionLoader {
  loadAll(paths: ExtensionSearchPath[]): Promise<void>;
  load(path: string): Promise<void>;
  unload(extensionId: string): Promise<void>;
  loaded(): string[];
}

export class FileExtensionLoader implements ExtensionLoader {
  private readonly loadedIds = new Set<string>();

  async loadAll(paths: ExtensionSearchPath[]): Promise<void> {
    for (const p of paths) {
      await this.load(p.root);
    }
  }

  async load(root: string): Promise<void> {
    // 完整实现：扫描 manifest → dynamic import → Register(api)
    // 当前保留接口与登记位，避免未接线时误加载宿主扩展。
    void root;
  }

  async unload(extensionId: string): Promise<void> {
    this.loadedIds.delete(extensionId);
  }

  loaded(): string[] {
    return [...this.loadedIds];
  }
}
