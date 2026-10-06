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
    fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, monospace',
    cursorBlink: true,
    scrollback: 2000,
    theme: {
      background: '#0c0c0c',
      foreground: '#e6e6e6',
      cursor: '#d77757',
      cursorAccent: '#0c0c0c',
      selectionBackground: '#3a3a3a',
    },
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
    <p v-if="narrow" class="hint">⚠ 当前宽度不足 {{ minCols }} 列，画面会被压缩，横屏或放大浏览器后更清楚</p>
    <div ref="host" class="term" />
  </div>
</template>

<style scoped>
.wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.hint { margin: 0; padding: 4px 12px; font-size: 12px; color: var(--yellow); }
.term { flex: 1; min-height: 0; padding: 4px; }
</style>
