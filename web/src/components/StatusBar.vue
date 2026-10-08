<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import type { StateFrame } from '../lib/protocol';
import type { SocketStatus } from '../lib/ws';

const props = defineProps<{ state: StateFrame | null; socket: SocketStatus; stoppable?: boolean }>();
const emit = defineEmits<{ reattach: []; stop: [] }>();

const attachText = computed(() => {
  const s = props.state;
  if (!s) return '等待状态';
  switch (s.attach) {
    case 'attached': return '已连接';
    case 'attaching': return '连接中';
    case 'taken_over': return s.reason ?? '已被本地窗口接管';
    case 'error': return s.reason ?? '连接出错';
    default: return s.attachable ? (s.reason ?? '未连接') : (s.reason ?? '只能查看');
  }
});
const statusText = computed(() => (props.state?.status === 'busy' ? '忙碌' : props.state?.status === 'idle' ? '空闲' : ''));
const canReattach = computed(() => !!props.state && props.state.attachable && props.state.attach !== 'attached' && props.state.attach !== 'attaching');
const formatWarning = computed(() => (props.state?.unknownRecords ?? 0) > 200);

// 停止会话要点两次：第一次只把按钮变成"再点一次确认"，几秒内不点第二次就恢复
const confirming = ref(false);
let confirmTimer: ReturnType<typeof setTimeout> | null = null;
function onStopClick() {
  if (!confirming.value) {
    confirming.value = true;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => { confirming.value = false; }, 4000);
    return;
  }
  confirming.value = false;
  if (confirmTimer) clearTimeout(confirmTimer);
  confirmTimer = null;
  emit('stop');
}
onUnmounted(() => { if (confirmTimer) clearTimeout(confirmTimer); });
</script>

<template>
  <div class="bar">
    <span class="chev">⏵⏵</span>
    <span class="net" v-if="socket !== 'open'">网络断开，重连中</span>
    <span class="attach" :class="state?.attach">{{ attachText }}</span>
    <template v-if="statusText"><span class="sep">·</span><span class="status" :class="state?.status">{{ statusText }}</span></template>
    <template v-if="state"><span class="sep">·</span><span class="size">{{ state.size.cols }}×{{ state.size.rows }}</span></template>
    <button v-if="canReattach" data-test="reattach" class="key" @click="emit('reattach')">接管回来</button>
    <button v-if="stoppable" data-test="stop" class="key stop" :class="{ confirming }" @click="onStopClick">{{ confirming ? '再点一次确认停止' : '停止会话' }}</button>
    <span class="warn" v-if="formatWarning">⚠ 转录格式可能已变化，聊天视图可能不完整</span>
  </div>
</template>

<style scoped>
.bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 12px; font-size: 12px; color: var(--dim); border-bottom: 1px solid var(--line); background: var(--bg); }
.chev { color: var(--yellow); }
.net { color: var(--red); }
.attach.attached { color: var(--green); }
.attach.attaching { color: var(--dim); }
.attach.taken_over, .attach.error { color: var(--yellow); }
.status.busy { color: var(--yellow); }
.sep { color: var(--faint); }
.size { color: var(--faint); }
.key { margin-left: 4px; }
.stop { margin-left: auto; color: var(--dim); }
.stop.confirming { color: var(--red); }
.stop.confirming::before, .stop.confirming::after { color: var(--red); }
.warn { color: var(--yellow); width: 100%; }
</style>
