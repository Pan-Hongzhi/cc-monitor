<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import StatusBar from '../components/StatusBar.vue';
import ChatPane from '../components/ChatPane.vue';
import Composer from '../components/Composer.vue';
import QuickKeys from '../components/QuickKeys.vue';
import TerminalPane from '../components/TerminalPane.vue';
import { ReconnectingSocket, wsUrl, type SocketStatus } from '../lib/ws';
import { decodeB64, encodeB64, type ChatMessage, type StateFrame } from '../lib/protocol';

const props = defineProps<{ sessionId: string }>();
const MIN_COLS = 80;

const tab = ref<'chat' | 'term'>('chat');
const messages = ref<ChatMessage[]>([]);
const state = ref<StateFrame | null>(null);
const socketStatus = ref<SocketStatus>('connecting');
const banner = ref('');
const errorText = ref('');
const term = ref<InstanceType<typeof TerminalPane> | null>(null);
let socket: ReconnectingSocket | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;

const canInput = () => !!state.value && state.value.attachable && state.value.attach === 'attached';

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
    if (r.ok) messages.value = (await r.json()) as ChatMessage[];
  } catch {
    /* 没有历史也能用 */
  }
}

function send(text: string) { socket?.send({ t: 'paste', text }); }
function sendKey(name: string) { socket?.send({ t: 'key', name }); }
function onTermInput(d: string) { socket?.send({ t: 'in', d: encodeB64(d) }); }
function onTermResize(cols: number, rows: number) { socket?.send({ t: 'resize', cols, rows }); }
function onTermActive() { socket?.send({ t: 'active' }); }
function reattach() { socket?.send({ t: 'attach' }); }

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
  socket.onStatus((s) => { socketStatus.value = s; });
  socket.onFrame((f) => {
    switch (f.t) {
      case 'replay': term.value?.clear(); term.value?.write(decodeB64(f.d)); break;
      case 'out': term.value?.write(decodeB64(f.d)); break;
      case 'chat': messages.value = messages.value.concat(f.messages); break;
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
      <router-link to="/" class="back">‹ 会话</router-link>
      <nav class="tabs">
        <button data-test="tab-chat" :class="{ on: tab === 'chat' }" @click="switchTab('chat')">聊天</button>
        <button v-if="!state || state.attachable" data-test="tab-term" :class="{ on: tab === 'term' }" @click="switchTab('term')">终端</button>
      </nav>
    </header>
    <StatusBar :state="state" :socket="socketStatus" @reattach="reattach" />
    <p v-if="errorText" class="error">{{ errorText }}</p>
    <p v-if="banner" class="banner" @click="banner = ''">{{ banner }}</p>
    <section class="body">
      <ChatPane v-show="tab === 'chat'" :messages="messages" empty-hint="发出第一条 prompt 后这里会显示对话" />
      <div v-show="tab === 'term'" class="termwrap">
        <TerminalPane ref="term" :min-cols="MIN_COLS" @input="onTermInput" @resize="onTermResize" @active="onTermActive" />
        <QuickKeys :disabled="!canInput()" @key="sendKey" />
      </div>
    </section>
    <Composer :disabled="!canInput()" @send="send" />
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100%; }
header { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #1a1a1a; }
.back { color: #9cc3ff; text-decoration: none; }
.tabs { display: flex; gap: 6px; }
.tabs button { padding: 4px 12px; border-radius: 6px; border: 1px solid #444; background: #222; color: #eee; }
.tabs button.on { background: #3b82f6; border-color: #3b82f6; }
.body { flex: 1; min-height: 0; }
.termwrap { display: flex; flex-direction: column; height: 100%; }
.error { margin: 0; padding: 8px 12px; color: #ff7b7b; }
.banner { margin: 0; padding: 8px 12px; background: #4a3a10; color: #ffd27a; }
</style>
