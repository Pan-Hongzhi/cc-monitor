import type { ChatMessage } from './protocol';

/** 按 id 合并两批消息并按时间排序；相同时间保持先后顺序。 */
export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const out: ChatMessage[] = [];
  for (const m of [...existing, ...incoming]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.sort((a, b) => a.ts - b.ts);
}
