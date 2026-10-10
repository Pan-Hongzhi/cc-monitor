<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ send: [text: string] }>();
const text = ref('');
const box = ref<HTMLTextAreaElement | null>(null);

// 单行起步，内容多了再长高，最多约 6 行
function grow() {
  const el = box.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 150) + 'px';
}

// 不在这里清空：发送是否成功由父组件确认，失败时文字留在框里
function send() {
  const t = text.value;
  if (t.trim().length === 0) return;
  emit('send', t);
}

function clear() {
  text.value = '';
  if (box.value) box.value.style.height = 'auto';
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
  <div class="composer" :class="{ disabled }">
    <div class="box">
      <span class="prompt">❯</span>
      <textarea ref="box" v-model="text" :disabled="disabled" rows="1" :placeholder="disabled ? '当前不能输入' : '输入 prompt，支持多行'" @keydown="onKeydown" @input="grow" />
    </div>
    <div class="foot">
      <span class="hint">Ctrl+Enter 发送</span>
      <button data-test="send" class="key" :disabled="disabled" @click="send">发送</button>
    </div>
  </div>
</template>

<style scoped>
.composer { padding: 6px 12px calc(6px + env(safe-area-inset-bottom)); background: var(--bg); }
.box { display: flex; gap: 8px; align-items: flex-start; padding: 5px 8px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.composer:focus-within .box { border-color: var(--orange); }
.disabled .box { border-color: var(--line); }
.prompt { color: var(--orange); padding-top: 1px; }
.disabled .prompt { color: var(--faint); }
textarea { flex: 1; resize: none; border: 0; outline: 0; background: transparent; color: var(--fg); font: inherit; font-size: 15px; line-height: 1.5; padding: 0; max-height: 150px; overflow-y: auto; }
textarea::placeholder { color: var(--faint); }
textarea:disabled { color: var(--faint); }
.foot { display: flex; justify-content: space-between; align-items: center; padding-top: 2px; font-size: 12px; color: var(--faint); }
</style>
