<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { ChatMessage } from '../lib/protocol';
import { toolLabel, splitLines } from '../lib/transcriptStyle';

const props = defineProps<{ messages: ChatMessage[]; emptyHint: string }>();
const box = ref<HTMLElement | null>(null);
const stick = ref(true);
const HEAD_LINES = 3;

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
      <!-- 回答：⏺ 开头 -->
      <div v-else-if="m.kind === 'text'" class="line">
        <span class="marker">⏺</span>
        <pre class="body">{{ m.text }}</pre>
      </div>
      <details v-else-if="m.kind === 'thinking'">
        <summary><span class="marker dim">✻</span><span class="dim italic">Thinking…</span></summary>
        <pre class="body dim italic">{{ m.text }}</pre>
      </details>
      <details v-else-if="m.kind === 'tool_use'">
        <summary><span class="marker">⏺</span><span class="label">{{ toolLabel(m.tool?.name ?? 'tool', m.tool?.summary ?? '') }}</span></summary>
        <pre class="body dim">{{ m.tool?.summary }}</pre>
      </details>
      <details v-else-if="m.kind === 'tool_result'" class="result">
        <summary>
          <span class="marker dim">⎿</span>
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
</style>
