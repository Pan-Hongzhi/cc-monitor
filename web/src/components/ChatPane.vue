<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { ChatMessage } from '../lib/protocol';

const props = defineProps<{ messages: ChatMessage[]; emptyHint: string }>();
const box = ref<HTMLElement | null>(null);
const stick = ref(true);

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
    <p v-if="messages.length === 0" class="empty">{{ emptyHint }}</p>
    <div v-for="m in messages" :key="m.id" class="msg" :class="[m.role, m.kind]">
      <details v-if="m.kind === 'thinking'">
        <summary>思考</summary>
        <pre>{{ m.text }}</pre>
      </details>
      <details v-else-if="m.kind === 'tool_use'">
        <summary>调用 {{ m.tool?.name }}</summary>
        <pre>{{ m.tool?.summary }}</pre>
      </details>
      <details v-else-if="m.kind === 'tool_result'">
        <summary>工具结果</summary>
        <pre>{{ m.text }}</pre>
      </details>
      <pre v-else>{{ m.text }}</pre>
    </div>
  </div>
</template>

<style scoped>
.chat { height: 100%; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.msg { max-width: 92%; border-radius: 10px; padding: 8px 10px; background: #1d1d1d; }
.msg.user.text { align-self: flex-end; background: #2b4a8a; }
.msg.assistant.text { align-self: flex-start; }
.msg.thinking, .msg.tool_use, .msg.tool_result { align-self: flex-start; font-size: 13px; color: #bbb; background: #181818; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 15px; }
details pre { font-family: ui-monospace, Consolas, monospace; font-size: 12px; margin-top: 6px; }
summary { cursor: pointer; }
.empty { color: #888; text-align: center; margin-top: 40px; }
</style>
