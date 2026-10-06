<script setup lang="ts">
defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ key: [name: string] }>();
const keys: { name: string; label: string }[] = [
  { name: 'esc', label: 'Esc' }, { name: 'ctrl-c', label: 'Ctrl+C' }, { name: 'tab', label: 'Tab' },
  { name: 'shift-tab', label: 'Shift+Tab' }, { name: 'up', label: '↑' }, { name: 'down', label: '↓' },
  { name: 'left', label: '←' }, { name: 'right', label: '→' }, { name: 'enter', label: 'Enter' },
];
</script>

<template>
  <div class="keys">
    <button v-for="k in keys" :key="k.name" :data-key="k.name" class="key" :disabled="disabled" @click="emit('key', k.name)">{{ k.label }}</button>
  </div>
</template>

<style scoped>
.keys { display: flex; gap: 2px; overflow-x: auto; padding: 4px 10px; font-size: 12px; border-top: 1px solid var(--line); background: var(--bg); scrollbar-width: none; }
.keys::-webkit-scrollbar { display: none; }
.key { flex: 0 0 auto; }
</style>
