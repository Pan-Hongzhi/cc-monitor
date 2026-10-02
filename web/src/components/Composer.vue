<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ send: [text: string] }>();
const text = ref('');

// 不在这里清空：发送是否成功由父组件确认，失败时文字留在框里
function send() {
  const t = text.value;
  if (t.trim().length === 0) return;
  emit('send', t);
}

function clear() {
  text.value = '';
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    send();
  }
}

defineExpose({ clear });
</script>

<template>
  <div class="composer">
    <textarea v-model="text" :disabled="disabled" rows="2" placeholder="输入 prompt，Ctrl+Enter 发送" @keydown="onKeydown" />
    <button data-test="send" :disabled="disabled" @click="send">发送</button>
  </div>
</template>

<style scoped>
.composer { display: flex; gap: 8px; padding: 8px 12px calc(8px + env(safe-area-inset-bottom)); background: #1a1a1a; border-top: 1px solid #2a2a2a; }
textarea { flex: 1; resize: none; border-radius: 8px; border: 1px solid #444; background: #111; color: #eee; padding: 8px; font: inherit; font-size: 16px; }
button { padding: 0 16px; border-radius: 8px; border: none; background: #3b82f6; color: #fff; }
button:disabled, textarea:disabled { opacity: 0.5; }
</style>
