export class ExtensionManager {
  static getLoader() {
    return {
      loadWorkspaceExtensions: async (_sessionId: string, _workspaceDir: string) => {},
      unloadWorkspaceExtensions: async (_sessionId: string) => {}
    };
  }
  static getHookRunner() {
    return {
      runVoidHook: async (_hookName: string, _context: any) => {},
      runModifyingHook: async (_hookName: string, _context: any) => null as any,
      run: async (_hookName: string, _context: any) => null as any
    };
  }
  static getApi() {
    return {};
  }
  static getRegistry() {
    return {
      getExtensions: (): any[] => [],
      getSkillDirs: (): any[] => [],
      getExtensionIds: (): string[] => []
    };
  }
}
