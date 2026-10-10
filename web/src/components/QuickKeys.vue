<script setup lang="ts">
defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ key: [name: string] }>();
// 回车放第一个：手机上最常用，也最不该被挤到屏幕外
const keys: { name: string; label: string }[] = [
  { name: 'enter', label: 'Enter ⏎' }, { name: 'esc', label: 'Esc' }, { name: 'tab', label: 'Tab' },
  { name: 'shift-tab', label: 'Shift+Tab' }, { name: 'up', label: '↑' }, { name: 'down', label: '↓' },
  { name: 'left', label: '←' }, { name: 'right', label: '→' }, { name: 'ctrl-c', label: 'Ctrl+C' },
];
</script>

<template>
  <div class="keys">
    <button v-for="k in keys" :key="k.name" :data-key="k.name" class="key" :disabled="disabled" @click="emit('key', k.name)">{{ k.label }}</button>
  </div>
</template>

<style scoped>
/* 换行排布而不是横向滚动：窄屏上所有按键都看得见，按键够大好点 */
.keys { display: flex; flex-wrap: wrap; gap: 4px 6px; padding: 6px 10px; font-size: 13px; border-top: 1px solid var(--line); background: var(--bg); }
.key { flex: 0 0 auto; min-height: 34px; padding: 6px 6px; }
.key[data-key="enter"] { color: var(--orange); }
.key[data-key="enter"]::before, .key[data-key="enter"]::after { color: var(--orange); }
</style>
