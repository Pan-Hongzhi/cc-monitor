import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./pages/SessionList.vue') },
    { path: '/s/:sessionId', component: () => import('./pages/SessionView.vue'), props: true },
  ],
});
