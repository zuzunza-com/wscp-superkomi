/**
 * RGSS 스크립트 파서
 * Ruby 소스 텍스트 파싱 - 변수/상수/메서드 추출 등
 * (실제 Ruby 실행은 Opal 등 별도 런타임 필요)
 */
export interface ParsedScriptBlock {
  type: 'class' | 'module' | 'def' | 'alias' | 'comment';
  name?: string;
  lineStart: number;
  lineEnd?: number;
  raw: string;
}

/**
 * RGSS Ruby 스크립트에서 주요 블록 추출
 */
export function parseRgssScript(code: string): ParsedScriptBlock[] {
  const blocks: ParsedScriptBlock[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('#')) {
      blocks.push({
        type: 'comment',
        lineStart: i + 1,
        raw: line,
      });
      continue;
    }

    const classMatch = trimmed.match(/^\s*(?:class|module)\s+(\w+(?:::\w+)*)/);
    if (classMatch) {
      blocks.push({
        type: trimmed.startsWith('class') ? 'class' : 'module',
        name: classMatch[1],
        lineStart: i + 1,
        raw: line,
      });
      continue;
    }

    const defMatch = trimmed.match(/^\s*def\s+(?:self\.)?(\w+[\?!]?)/);
    if (defMatch) {
      blocks.push({
        type: 'def',
        name: defMatch[1],
        lineStart: i + 1,
        raw: line,
      });
    }
  }

  return blocks;
}

/**
 * 스크립트에서 특정 패턴 검색
 */
export function extractScriptInfo(code: string): { hasMain: boolean; hasScene: boolean } {
  const hasMain = /def\s+main\b|rgss_main|SceneManager\.run/m.test(code);
  const hasScene = /class\s+Scene_\w+/m.test(code);
  return { hasMain, hasScene };
}
