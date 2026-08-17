import path from 'node:path';
import { formatError } from './helpers';

export function recoverableFileMissing(absPath: string): ReturnType<typeof formatError> {
  const parent = path.dirname(absPath);
  const base = path.basename(absPath);
  const stem = path.basename(base, path.extname(base)) || base;
  const body = [
    `No file at ${absPath}`,
    '',
    'Likely causes:',
    '- incomplete or guessed filename (short name / wrong suffix)',
    '- wrong directory; the file may sit deeper under a parent folder',
    '',
    'Next steps (do not invent the path):',
    `1. glob under ${parent} with a looser name pattern, e.g. **/*${stem}*`,
    '2. or grep a distinctive keyword under the docs/knowledge root, then read a hit path',
    '3. if the parent itself is uncertain, glob one level up with **/*keyword* first'
  ].join('\n');
  return formatError('NOT_FOUND', body);
}

export function recoverableSearchRootMissing(absPath: string): ReturnType<typeof formatError> {
  const parent = path.dirname(absPath);
  const body = [
    `search path does not exist: ${absPath}`,
    '',
    'Likely causes:',
    '- mistyped directory name',
    '- using a relative/short name that resolved to the wrong place',
    '',
    'Next steps:',
    `1. glob under ${parent} with **/* to verify nearby directories`,
    '2. or omit searchPath/path and search from workspace/agent root with a narrower pattern',
    '3. confirm the absolute path from <session_environment> (agent_root / workspace_root)'
  ].join('\n');
  return formatError('NOT_FOUND', body);
}

export function recoverableGlobEmpty(pattern: string, searchRoot: string): ReturnType<typeof successText> {
  return successText(
    [
      `No files found matching ${JSON.stringify(pattern)} under ${searchRoot}.`,
      '',
      'Likely causes:',
      '- pattern too narrow or filename incomplete',
      '- wrong searchPath (knowledge files often live under agent_root, not workspace_root)',
      '',
      'Next steps:',
      '1. broaden the glob (e.g. **/*keyword* or *.md) or point searchPath at the parent docs root',
      '2. or grep a content keyword under that root, then read the matched path',
      '3. avoid guessing deep absolute paths — discover with glob/grep first'
    ].join('\n')
  );
}

export function recoverableContentEmpty(pattern: string, scanRoot: string): ReturnType<typeof successText> {
  return successText(
    [
      `No matches found for ${JSON.stringify(pattern)} under ${scanRoot}.`,
      '',
      'Likely causes:',
      '- typo or wrong casing in pattern',
      '- searching the wrong directory',
      '',
      'Next steps:',
      '1. broaden the pattern or search from a parent directory',
      '2. use glob to confirm file names exist before grepping content'
    ].join('\n')
  );
}

function successText(llmContent: string): { success: true; llmContent: string } {
  return { success: true as const, llmContent };
}
