/** Builtin tool JSON Schemas（对齐 Go tools/builtin/schema）。 */

export function readParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Absolute file path (or @workspace/ relative).' },
      offset: { type: 'integer', description: 'Starting line number (1-based). Defaults to 1' },
      limit: { type: 'integer', description: 'Maximum number of lines to return. Defaults to 2000' }
    }
  };
}

export function writeParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['path', 'content'],
    properties: {
      path: { type: 'string' },
      content: { type: 'string' }
    }
  };
}

export function editParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['path', 'oldText', 'newText'],
    properties: {
      path: { type: 'string' },
      oldText: { type: 'string' },
      newText: { type: 'string' },
      replaceAll: { type: 'boolean' }
    }
  };
}

export function execParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['description', 'command'],
    properties: {
      description: { type: 'string' },
      command: { type: 'string' },
      background: { type: 'boolean' },
      timeout: { type: 'integer', description: 'Timeout in ms for foreground exec' }
    }
  };
}

export function processParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['list', 'read', 'write', 'wait', 'kill', 'remove'] },
      processId: { type: 'string' },
      data: { type: 'string' },
      timeoutMs: { type: 'integer' },
      state: { type: 'string' }
    }
  };
}

export function searchParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['pattern'],
    properties: {
      pattern: { type: 'string' },
      searchPath: { type: 'string' },
      glob: { type: 'string' },
      caseSensitive: { type: 'boolean' },
      maxResults: { type: 'integer' }
    }
  };
}

export function grepParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['pattern'],
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string' },
      glob: { type: 'string' },
      type: { type: 'string' },
      output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'] },
      caseSensitive: { type: 'boolean' },
      contextAfter: { type: 'integer' },
      contextBefore: { type: 'integer' },
      context: { type: 'integer' },
      multiline: { type: 'boolean' },
      head_limit: { type: 'integer' }
    }
  };
}

export function globParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['pattern'],
    properties: {
      pattern: { type: 'string' },
      searchPath: { type: 'string' }
    }
  };
}

export function skillFindParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['list', 'search'] },
      scope: { type: 'string', enum: ['shared', 'agent', 'all'] },
      keyword: { type: 'string' },
      limit: { type: 'integer' },
      offset: { type: 'integer' }
    }
  };
}

export function todosParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['read', 'replace', 'merge'] },
      sessionId: { type: 'string' },
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            status: { type: 'string' }
          },
          required: ['id']
        }
      }
    }
  };
}

export function emitEventParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: {
      text: { type: 'string' },
      data: { type: 'object' }
    }
  };
}
