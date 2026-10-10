<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import StatusBar from '../components/StatusBar.vue';
import ChatPane from '../components/ChatPane.vue';
import Composer from '../components/Composer.vue';
import QuickKeys from '../components/QuickKeys.vue';
import TerminalPane from '../components/TerminalPane.vue';
import { ReconnectingSocket, wsUrl, type SocketStatus } from '../lib/ws';
import { decodeB64, encodeB64, type ChatMessage, type StateFrame } from '../lib/protocol';
import { mergeMessages } from '../lib/chat';

const props = defineProps<{ sessionId: string }>();
const MIN_COLS = 80;

const tab = ref<'chat' | 'term'>('chat');
const messages = ref<ChatMessage[]>([]);
const state = ref<StateFrame | null>(null);
const socketStatus = ref<SocketStatus>('connecting');
const banner = ref('');
const errorText = ref('');
const stopped = ref(false);
const term = ref<InstanceType<typeof TerminalPane> | null>(null);
const composer = ref<InstanceType<typeof Composer> | null>(null);
let socket: ReconnectingSocket | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;
let everOpened = false;

const canInput = computed(() => !!state.value && state.value.attachable && state.value.attach === 'attached' && socketStatus.value === 'open');
const stoppable = computed(() => !!state.value && state.value.attachable && !stopped.value);

function showBanner(text: string, autoHideMs = 0) {
  banner.value = text;
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = autoHideMs ? setTimeout(() => { banner.value = ''; }, autoHideMs) : null;
}

function onHook(event: string, data: Record<string, unknown>) {
  if (event === 'PermissionRequest') return showBanner(`需要你确认权限（${String(data.tool_name ?? '')}），切到终端画面处理`);
  if (event === 'Notification') {
    const type = String(data.notification_type ?? '');
    if (type === 'permission_prompt') return showBanner('需要你确认权限，切到终端画面处理');
    if (type === 'idle_prompt') return showBanner('CC 在等你输入');
    return;
  }
  if (event === 'Stop') return showBanner('这轮结束了', 5000);
}

async function loadHistory() {
  try {
    const r = await fetch(`/api/sessions/${encodeURIComponent(props.sessionId)}/transcript?limit=200`);
    if (r.ok) messages.value = mergeMessages(messages.value, (await r.json()) as ChatMessage[]);
  } catch {
    /* 没有历史也能用 */
  }
}

function send(text: string) {
  if (!socket?.send({ t: 'paste', text })) {
    showBanner('网络未连接，内容已保留，恢复后再发送', 4000);
    return;
  }
  composer.value?.clear();
  if (text.trim().startsWith('/')) {
    // 斜杠命令的菜单和对话框只在终端画面里显示，聊天视图看不到
    void switchTab('term');
    showBanner('斜杠命令的界面只在终端画面显示，已切换过去', 4000);
  }
}
function sendKey(name: string) { socket?.send({ t: 'key', name }); }
function onTermInput(d: string) { socket?.send({ t: 'in', d: encodeB64(d) }); }
function onTermResize(cols: number, rows: number) { socket?.send({ t: 'resize', cols, rows }); }
function onTermActive() { socket?.send({ t: 'active' }); }
function reattach() { socket?.send({ t: 'attach' }); }

async function stopSession() {
  try {
    const r = await fetch(`/api/sessions/${encodeURIComponent(props.sessionId)}/stop`, { method: 'POST' });
    if (r.ok) {
      stopped.value = true;
      showBanner('会话已停止，对话记录已保留，可在电脑上用 claude --bg --resume 继续');
    } else {
      const body = (await r.json().catch(() => ({ output: '' }))) as { output?: string };
      showBanner(`停止失败：${body.output || `HTTP ${r.status}`}`, 6000);
    }
  } catch (e) {
    showBanner(`停止失败：${(e as Error).message}`, 6000);
  }
}

async function switchTab(next: 'chat' | 'term') {
  tab.value = next;
  if (next === 'term') {
    await nextTick();
    term.value?.refit();
    onTermActive();
  }
}

onMounted(() => {
  void loadHistory();
  socket = new ReconnectingSocket(wsUrl(`/ws?sid=${encodeURIComponent(props.sessionId)}`));
  socket.onStatus((s) => {
    socketStatus.value = s;
    if (s === 'open') {
      if (everOpened) void loadHistory(); // 重连后补齐断线期间的消息
      everOpened = true;
    }
  });
  socket.onFrame((f) => {
    switch (f.t) {
      case 'replay': term.value?.clear(); term.value?.write(decodeB64(f.d)); break;
      case 'out': term.value?.write(decodeB64(f.d)); break;
      case 'chat': messages.value = mergeMessages(messages.value, f.messages); break;
      case 'state': state.value = f; break;
      case 'hook': onHook(f.event, (f.data ?? {}) as Record<string, unknown>); break;
      case 'error': errorText.value = f.message; break;
      default: break;
    }
  });
  socket.connect();
});

onUnmounted(() => {
  socket?.close();
  if (bannerTimer) clearTimeout(bannerTimer);
});
</script>

<template>
  <div class="page">
    <header>
      <router-link to="/" class="back">← 会话</router-link>
      <nav class="tabs">
        <button data-test="tab-chat" class="key" :class="{ on: tab === 'chat' }" @click="switchTab('chat')">聊天</button>
        <button v-if="!state || state.attachable" data-test="tab-term" class="key" :class="{ on: tab === 'term' }" @click="switchTab('term')">终端</button>
      </nav>
    </header>
    <StatusBar :state="state" :socket="socketStatus" :stoppable="stoppable" @reattach="reattach" @stop="stopSession" />
    <p v-if="errorText" class="error">✗ {{ errorText }}</p>
    <p v-if="banner" class="banner" @click="banner = ''">⚠ {{ banner }}</p>
    <section class="body">
      <ChatPane v-show="tab === 'chat'" :messages="messages" empty-hint="发出第一条 prompt 后这里会显示对话" />
      <div v-show="tab === 'term'" class="termwrap">
        <TerminalPane ref="term" :min-cols="MIN_COLS" @input="onTermInput" @resize="onTermResize" @active="onTermActive" />
        <QuickKeys :disabled="!canInput" @key="sendKey" />
      </div>
    </section>
    <Composer ref="composer" :disabled="!canInput" @send="send" />
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100%; }
header { display: flex; align-items: center; gap: 12px; padding: 8px 12px; font-size: 13px; }
.back { color: var(--dim); }
.back:hover { color: var(--lavender); }
.tabs { display: flex; gap: 4px; }
.tabs .key.on { color: var(--orange); }
.tabs .key.on::before, .tabs .key.on::after { color: var(--orange); }
.body { flex: 1; min-height: 0; }
.termwrap { display: flex; flex-direction: column; height: 100%; }
.error { margin: 0; padding: 6px 12px; color: var(--red); font-size: 13px; }
.banner { margin: 0; padding: 6px 12px; color: var(--yellow); font-size: 13px; cursor: pointer; animation: rise 140ms ease-out; }
@keyframes rise { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
</style>
