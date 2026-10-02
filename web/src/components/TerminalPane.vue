<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const props = defineProps<{ minCols: number }>();
const emit = defineEmits<{ input: [data: string]; resize: [cols: number, rows: number]; active: [] }>();

const host = ref<HTMLElement | null>(null);
const narrow = ref(false);
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let observer: ResizeObserver | null = null;

function write(data: string) {
  term?.write(data);
}

function clear() {
  term?.reset();
}

function refit() {
  if (!term || !fit) return;
  fit.fit();
  narrow.value = term.cols < props.minCols;
  emit('resize', term.cols, term.rows);
}

onMounted(() => {
  term = new Terminal({
    fontSize: 13,
    fontFamily: 'ui-monospace, Consolas, "Cascadia Mono", monospace',
    cursorBlink: true,
    scrollback: 2000,
    theme: { background: '#111111' },
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host.value!);
  term.onData((d) => emit('input', d));
  term.textarea?.addEventListener('focus', () => emit('active'));
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => refit());
    observer.observe(host.value!);
  }
  refit();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  term?.dispose();
  term = null;
});

defineExpose({ write, clear, refit });
</script>

<template>
  <div class="wrap">
    <p v-if="narrow" class="hint">当前宽度不足 {{ minCols }} 列，画面会被压缩，横屏或放大浏览器后更清楚</p>
    <div ref="host" class="term" />
  </div>
</template>

<style scoped>
.wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.hint { margin: 0; padding: 6px 12px; font-size: 12px; color: #f0a030; background: #1a1a1a; }
.term { flex: 1; min-height: 0; padding: 4px; }
</style>
