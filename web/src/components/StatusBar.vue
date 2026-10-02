<script setup lang="ts">
import { computed } from 'vue';
import type { StateFrame } from '../lib/protocol';
import type { SocketStatus } from '../lib/ws';

const props = defineProps<{ state: StateFrame | null; socket: SocketStatus }>();
const emit = defineEmits<{ reattach: [] }>();

const attachText = computed(() => {
  const s = props.state;
  if (!s) return '等待状态';
  switch (s.attach) {
    case 'attached': return '已连接';
    case 'attaching': return '连接中';
    case 'taken_over': return s.reason ?? '已被本地窗口接管';
    case 'error': return s.reason ?? '连接出错';
    default: return s.attachable ? '未连接' : (s.reason ?? '只能查看');
  }
});
const statusText = computed(() => (props.state?.status === 'busy' ? '忙碌' : props.state?.status === 'idle' ? '空闲' : ''));
const canReattach = computed(() => !!props.state && props.state.attachable && props.state.attach !== 'attached' && props.state.attach !== 'attaching');
const formatWarning = computed(() => (props.state?.unknownRecords ?? 0) > 200);
</script>

<template>
  <div class="bar">
    <span class="net" v-if="socket !== 'open'">网络断开，重连中</span>
    <span class="attach" :class="state?.attach">{{ attachText }}</span>
    <span class="status" v-if="statusText">{{ statusText }}</span>
    <span class="size" v-if="state">{{ state.size.cols }}×{{ state.size.rows }}</span>
    <button v-if="canReattach" data-test="reattach" @click="emit('reattach')">接管回来</button>
    <span class="warn" v-if="formatWarning">转录格式可能已变化，聊天视图可能不完整</span>
  </div>
</template>

<style scoped>
.bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 12px; font-size: 13px; background: #1a1a1a; border-bottom: 1px solid #2a2a2a; }
.net { color: #ff7b7b; }
.attach.attached { color: #3cc26a; }
.attach.taken_over, .attach.error { color: #f0a030; }
.size { color: #777; }
.warn { color: #f0a030; width: 100%; }
button { padding: 4px 10px; border-radius: 6px; border: 1px solid #555; background: #2a2a2a; color: #eee; }
</style>
