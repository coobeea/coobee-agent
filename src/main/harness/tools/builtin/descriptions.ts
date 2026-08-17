export const ReadToolDescription =
  'Read the contents of a file from the container filesystem. ' +
  'Usage: path MUST be an absolute container path (POSIX, starting with /). ' +
  'Returns numbered lines (e.g. "  1|content"). Use offset and limit for long files (default limit 2000 lines).';

export const WriteToolDescription =
  'Write or overwrite a file in the container filesystem. ' +
  'Usage: path MUST be an absolute container path. Creates parent directories if needed.';

export const EditToolDescription =
  'Edit a file by replacing an exact text match (deterministic search-and-replace). ' +
  'Usage: path MUST be an absolute container path. MUST read the file first to copy exact oldText.';

export const ExecToolDescription =
  'Execute a shell command in the container. Working directory is fixed to the session workspace root.';

export const ProcessToolDescription = 'Manage background processes started by exec(background=true).';

export const SearchToolDescription =
  'Legacy content search using built-in pattern matching (simple regex scan). Prefer grep when available.';

export const GrepToolDescription =
  'Search file contents using ripgrep (rg). Prefer this tool for exact symbol, string, or regex searches.';

export const GlobToolDescription = 'Find files by name or path pattern (does not search file contents).';

export const SkillFindToolDescription =
  'Discover Skill packages under configured search roots (name, description, absolute SKILL.md path).';

export const TodosToolDescription = 'Read or update the session TODO list (persisted as todos.json).';

export const EmitEventToolDescription =
  'Show a brief toast notification in the user interface. Only action "notify" is supported.';
