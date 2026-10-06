// 把工具调用渲染成 Claude Code 终端里的样子：Bash(ls -la)、Read(C:/a.ts)

const PREFERRED_KEYS = ['command', 'file_path', 'path', 'pattern', 'skill', 'description', 'query', 'url', 'name', 'prompt', 'text', 'content'];
const ARG_MAX = 80;

function oneLine(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > ARG_MAX ? flat.slice(0, ARG_MAX) + '…' : flat;
}

export function toolLabel(name: string, summary: string): string {
  let arg = summary;
  try {
    const v = JSON.parse(summary) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const key = PREFERRED_KEYS.find((k) => typeof o[k] === 'string') ?? Object.keys(o).find((k) => typeof o[k] === 'string');
      if (key) arg = String(o[key]);
    }
  } catch {
    /* 不是 JSON（例如被截断），原样显示 */
  }
  return `${name}(${oneLine(arg)})`;
}

export function splitLines(text: string, head: number): { head: string; rest: string; hidden: number } {
  const lines = text.split('\n');
  if (lines.length <= head) return { head: text, rest: '', hidden: 0 };
  return { head: lines.slice(0, head).join('\n'), rest: lines.slice(head).join('\n'), hidden: lines.length - head };
}
