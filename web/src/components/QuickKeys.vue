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
    <button v-for="k in keys" :key="k.name" :data-key="k.name" :disabled="disabled" @click="emit('key', k.name)">{{ k.label }}</button>
  </div>
</template>

<style scoped>
.keys { display: flex; gap: 6px; overflow-x: auto; padding: 6px 12px; background: #1a1a1a; }
button { flex: 0 0 auto; padding: 6px 10px; border-radius: 6px; border: 1px solid #444; background: #222; color: #eee; }
button:disabled { opacity: 0.5; }
</style>
