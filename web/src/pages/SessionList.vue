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
    <header class="banner">
      <!-- Claude Code 启动画面里的吉祥物，按终端里三行半格字符逐格还原：18×6 个半格，含两只眼睛和四只脚 -->
      <svg class="logo" viewBox="0 0 18 6" width="72" height="24" aria-hidden="true" fill="currentColor" shape-rendering="crispEdges">
        <rect x="3" y="0" width="13" height="1" />
        <rect x="3" y="1" width="2" height="1" />
        <rect x="6" y="1" width="7" height="1" />
        <rect x="14" y="1" width="2" height="1" />
        <rect x="1" y="2" width="17" height="1" />
        <rect x="3" y="3" width="13" height="1" />
        <rect x="3" y="4" width="1" height="1" />
        <rect x="5" y="4" width="1" height="1" />
        <rect x="13" y="4" width="1" height="1" />
        <rect x="15" y="4" width="1" height="1" />
        <rect class="eye" x="5" y="1" width="1" height="1" /><rect class="eye" x="13" y="1" width="1" height="1" />
      </svg>
      <div class="title">
        <h1>Claude Code 会话</h1>
        <p class="sub">本机正在运行的会话</p>
      </div>
    </header>
    <p v-if="error" class="error">✗ {{ error }}</p>
    <p v-else-if="loaded && sessions.length === 0" class="empty">没有正在运行的会话。在项目目录里运行 <code>claude --bg --name 名字</code> 启动一个。</p>
    <ul>
      <li v-for="s in sessions" :key="s.sessionId" data-test="session">
        <router-link :to="`/s/${s.sessionId}`">
          <span class="caret">❯</span>
          <span class="dot" :class="s.status">●</span>
          <span class="name">{{ s.name || s.sessionId.slice(0, 8) }}</span>
          <span class="badge" v-if="!s.attachable">[只读]</span>
          <span class="status" :class="s.status">{{ statusText(s) }}</span>
          <span class="cwd">{{ s.cwd }}</span>
        </router-link>
      </li>
    </ul>
    <p class="foot" v-if="sessions.length">⏵⏵ {{ sessions.length }} 个会话 · 列表自动刷新</p>
  </main>
</template>

<style scoped>
.list { padding: 20px 16px 32px; max-width: 760px; margin: 0 auto; }
.banner { display: flex; align-items: center; gap: 14px; padding-bottom: 14px; margin-bottom: 10px; border-bottom: 1px solid var(--line); }
.logo { color: var(--orange); flex: 0 0 auto; }
.logo .eye { fill: #000; }
h1 { font-size: 15px; font-weight: 600; margin: 0; }
.sub { margin: 2px 0 0; color: var(--dim); font-size: 12px; }
code { color: var(--lavender); }
ul { list-style: none; padding: 0; margin: 0; }
li a {
  display: grid;
  grid-template-columns: 14px 14px 1fr auto auto;
  grid-template-areas: "caret dot name badge status" "caret dot cwd cwd cwd";
  column-gap: 8px;
  align-items: baseline;
  padding: 8px 6px;
  color: inherit;
  border-left: 2px solid transparent;
}
li a:hover { background: var(--bg-raised); border-left-color: var(--orange); }
.caret { grid-area: caret; color: var(--orange); opacity: 0; }
li a:hover .caret { opacity: 1; }
.dot { grid-area: dot; color: var(--faint); font-size: 11px; }
.dot.busy { color: var(--yellow); }
.dot.idle { color: var(--green); }
.name { grid-area: name; font-weight: 600; }
.badge { grid-area: badge; color: var(--faint); font-size: 12px; }
.status { grid-area: status; color: var(--dim); font-size: 12px; }
.status.busy { color: var(--yellow); }
.cwd { grid-area: cwd; color: var(--faint); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.error { color: var(--red); }
.empty { color: var(--dim); }
.foot { margin-top: 14px; color: var(--faint); font-size: 12px; }
</style>
