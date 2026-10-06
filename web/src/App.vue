<template>
  <router-view />
</template>

<style>
:root {
  color-scheme: dark;
  --bg: #0c0c0c;
  --bg-raised: #141414;
  --fg: #e6e6e6;
  --dim: #999999;
  --faint: #5c5c5c;
  --line: #2e2e2e;
  --orange: #d77757;
  --lavender: #b1b9f9;
  --yellow: #ffc107;
  --green: #3cc26a;
  --red: #ff6b6b;
  --mono: "Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, "DejaVu Sans Mono", monospace;
}
html, body, #app { margin: 0; height: 100%; }
body {
  background: radial-gradient(ellipse at top, #121212 0%, var(--bg) 55%);
  color: var(--fg);
  font-family: var(--mono);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; }
::selection { background: var(--orange); color: #000; }
pre { margin: 0; font-family: inherit; white-space: pre-wrap; word-break: break-word; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
button:disabled { cursor: default; }
a { color: var(--lavender); text-decoration: none; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 0; }
::-webkit-scrollbar-track { background: transparent; }

/* 终端风格的按键：[文字] */
.key {
  color: var(--fg);
  padding: 2px 4px;
  white-space: nowrap;
}
.key::before { content: "["; color: var(--faint); }
.key::after { content: "]"; color: var(--faint); }
.key:hover:not(:disabled) { color: var(--orange); }
.key:hover:not(:disabled)::before, .key:hover:not(:disabled)::after { color: var(--orange); }
.key:disabled { color: var(--faint); }
</style>
