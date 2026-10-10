<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ChatMessage } from '../lib/protocol';
import { toolLabel, splitLines } from '../lib/transcriptStyle';

const props = defineProps<{ messages: ChatMessage[]; emptyHint: string }>();
const box = ref<HTMLElement | null>(null);
const stick = ref(true);
const HEAD_LINES = 3;

marked.setOptions({ gfm: true, breaks: true });

// 回答按 Markdown 渲染（表格、代码块、加粗、列表），输出经 DOMPurify 消毒；你的 prompt 原样显示
function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

function onScroll() {
  const el = box.value;
  if (!el) return;
  stick.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
}

watch(() => props.messages.length, async () => {
  await nextTick();
  const el = box.value;
  if (el && stick.value) el.scrollTop = el.scrollHeight;
});

defineExpose({ stick });
</script>

<template>
  <div class="chat" ref="box" @scroll="onScroll">
    <p v-if="messages.length === 0" class="empty">✻ {{ emptyHint }}</p>
    <div v-for="m in messages" :key="m.id" class="msg" :class="[m.role, m.kind]">
      <!-- 你的 prompt：Claude Code 用 > 开头 -->
      <div v-if="m.kind === 'text' && m.role === 'user'" class="line prompt">
        <span class="marker">&gt;</span>
        <pre class="body">{{ m.text }}</pre>
      </div>
      <!-- 回答：● 开头（Claude Code 用 ⏺，手机字体未必有，用 ● 代替） -->
      <div v-else-if="m.kind === 'text'" class="line">
        <span class="marker">●</span>
        <div class="body md" v-html="renderMarkdown(m.text)" />
      </div>
      <details v-else-if="m.kind === 'thinking'">
        <summary><span class="marker dim">✻</span><span class="dim italic">Thinking…</span></summary>
        <pre class="body dim italic">{{ m.text }}</pre>
      </details>
      <details v-else-if="m.kind === 'tool_use'">
        <summary><span class="marker">●</span><span class="label">{{ toolLabel(m.tool?.name ?? 'tool', m.tool?.summary ?? '') }}</span></summary>
        <pre class="body dim">{{ m.tool?.summary }}</pre>
      </details>
      <details v-else-if="m.kind === 'tool_result'" class="result">
        <summary>
          <span class="marker dim">└</span>
          <pre class="body dim">{{ splitLines(m.text, HEAD_LINES).head }}</pre>
          <span class="more" v-if="splitLines(m.text, HEAD_LINES).hidden">… +{{ splitLines(m.text, HEAD_LINES).hidden }} 行</span>
        </summary>
        <pre class="body dim rest" v-if="splitLines(m.text, HEAD_LINES).hidden">{{ splitLines(m.text, HEAD_LINES).rest }}</pre>
      </details>
    </div>
  </div>
</template>

<style scoped>
.chat { height: 100%; overflow-y: auto; padding: 10px 14px 16px; }
.msg { animation: rise 140ms ease-out; }
@keyframes rise { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
.line, summary { display: flex; gap: 8px; align-items: flex-start; }
summary { list-style: none; cursor: pointer; }
summary::-webkit-details-marker { display: none; }
.marker { flex: 0 0 1ch; color: var(--orange); }
.marker.dim { color: var(--faint); }
.body { flex: 1; min-width: 0; }
.dim { color: var(--dim); }
.italic { font-style: italic; }
.label { color: var(--fg); }
.label::first-letter { font-weight: 600; }
.msg.user.text { margin: 14px 0 6px; }
.msg.user.text .prompt { padding: 4px 8px; margin-left: -8px; background: var(--bg-raised); border-left: 2px solid var(--line); }
.msg.user.text .marker { color: var(--dim); }
.msg.assistant.text { margin: 6px 0; }
.msg.thinking, .msg.tool_use { margin: 6px 0 2px; }
.msg.tool_result { margin: 0 0 6px 1ch; padding-left: 8px; }
.msg.tool_result .more { color: var(--faint); white-space: nowrap; }
.msg.tool_result .rest { margin: 2px 0 0 calc(1ch + 8px); }
details[open] > summary .more { display: none; }
details > pre { margin: 2px 0 0 calc(1ch + 8px); }
.empty { color: var(--dim); margin-top: 24px; }

/* Markdown 正文：贴近终端里的渲染，表格窄屏可横向滑动 */
.md :deep(p) { margin: 0 0 8px; }
.md :deep(p:last-child) { margin-bottom: 0; }
.md :deep(h1), .md :deep(h2), .md :deep(h3), .md :deep(h4) { font-size: inherit; font-weight: 600; margin: 10px 0 4px; color: var(--orange); }
.md :deep(ul), .md :deep(ol) { margin: 0 0 8px; padding-left: 1.6em; }
.md :deep(li) { margin: 2px 0; }
.md :deep(code) { background: var(--bg-raised); padding: 1px 4px; border-radius: 3px; color: var(--lavender); }
.md :deep(pre) { background: var(--bg-raised); border-left: 2px solid var(--line); padding: 8px 10px; margin: 6px 0 8px; overflow-x: auto; white-space: pre; }
.md :deep(pre code) { background: none; padding: 0; color: var(--fg); }
.md :deep(blockquote) { margin: 6px 0; padding-left: 10px; border-left: 2px solid var(--faint); color: var(--dim); }
.md :deep(a) { color: var(--lavender); }
.md :deep(hr) { border: 0; border-top: 1px solid var(--line); margin: 10px 0; }
.md :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin: 6px 0 8px; font-size: 13px; }
.md :deep(th), .md :deep(td) { border: 1px solid var(--line); padding: 3px 8px; text-align: left; white-space: nowrap; }
.md :deep(th) { color: var(--dim); font-weight: 600; background: var(--bg-raised); }
.md :deep(strong) { color: var(--fg); }
</style>
