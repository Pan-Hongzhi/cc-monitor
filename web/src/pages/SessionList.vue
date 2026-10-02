<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { SessionInfo } from '../lib/protocol';
import { ReconnectingSocket, wsUrl } from '../lib/ws';

const sessions = ref<SessionInfo[]>([]);
const error = ref('');
const loaded = ref(false);
let socket: ReconnectingSocket | null = null;

const statusText = (s: SessionInfo) => (s.status === 'busy' ? '忙碌' : s.status === 'idle' ? '空闲' : '未知');

async function load() {
  try {
    const r = await fetch('/api/sessions');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    sessions.value = (await r.json()) as SessionInfo[];
    error.value = '';
  } catch (e) {
    error.value = `加载会话列表失败：${(e as Error).message}`;
  } finally {
    loaded.value = true;
  }
}

onMounted(() => {
  void load();
  socket = new ReconnectingSocket(wsUrl('/ws?list=1'));
  socket.onFrame((f) => {
    if (f.t === 'sessions') sessions.value = f.list;
  });
  socket.connect();
});
onUnmounted(() => socket?.close());
</script>

<template>
  <main class="list">
    <h1>Claude Code 会话</h1>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loaded && sessions.length === 0" class="empty">没有正在运行的会话。用 <code>claude --bg</code> 启动一个后再回来。</p>
    <ul>
      <li v-for="s in sessions" :key="s.sessionId" data-test="session">
        <router-link :to="`/s/${s.sessionId}`">
          <span class="dot" :class="s.status" />
          <span class="name">{{ s.name || s.sessionId.slice(0, 8) }}</span>
          <span class="badge" v-if="!s.attachable">只读</span>
          <span class="status">{{ statusText(s) }}</span>
          <span class="cwd">{{ s.cwd }}</span>
        </router-link>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.list { padding: 16px; max-width: 720px; margin: 0 auto; }
h1 { font-size: 18px; margin: 0 0 12px; }
ul { list-style: none; padding: 0; margin: 0; }
li a { display: grid; grid-template-columns: 12px 1fr auto auto; grid-template-areas: "dot name badge status" "dot cwd cwd cwd"; gap: 4px 8px; align-items: center; padding: 12px; margin-bottom: 8px; border-radius: 10px; background: #1d1d1d; color: inherit; text-decoration: none; }
.dot { grid-area: dot; width: 10px; height: 10px; border-radius: 50%; background: #666; }
.dot.busy { background: #f0a030; }
.dot.idle { background: #3cc26a; }
.name { grid-area: name; font-weight: 600; }
.badge { grid-area: badge; font-size: 12px; padding: 1px 6px; border-radius: 6px; background: #444; }
.status { grid-area: status; font-size: 13px; color: #aaa; }
.cwd { grid-area: cwd; font-size: 12px; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.error { color: #ff7b7b; }
.empty { color: #aaa; }
</style>
