# cc-monitor 设计文档

日期：2026-10-02
状态：设计已口头确认，待用户审阅本文件

## 1. 目标

在局域网内用手机浏览器监看并操控本机 Windows 上正在运行的 Claude Code（下称 CC）会话：

- 看到 CC 的输出，既有适合手机阅读的聊天视图，也有和终端一模一样的画面。
- 往会话里发送 prompt，必要时直接在终端画面里按键（权限确认、斜杠命令、Esc 打断）。
- 一眼看到本机有哪些会话、各自是忙是闲。

不走 Anthropic 服务器，所有流量只在局域网内。CC 本身零改动，唯一要求是会话用 `claude --bg` 启动。

## 2. 已验证的事实与决定

本节结论均在本机实测（CC 2.1.287，Windows 11，2026-10-02），是设计的前提。

| 事实 | 对设计的影响 |
|---|---|
| `claude --bg --name <名字>` 在 Windows 可用，立刻返回 8 位短 id；守护进程持有会话的 PTY | 会话生命周期交给 CC 自己的守护进程，监测器不负责拉起或保活 |
| `claude attach <id>` 可在 node-pty 里运行，单客户端时输入回显、输出正常，Ctrl+Z 脱离 | 监测器通过 attach 拿到原样画面和输入通道 |
| attach 是单客户端接管语义：第二个客户端 attach 时，旧客户端收到 `Session opened in another window` 并以退出码 0 退出，不会自动恢复 | 监测器必须是唯一的 attach 客户端，自己把画面复用给多端；本地也经监测器看 |
| 会话按当前 attach 客户端的尺寸渲染 | 多端共用时需要尺寸策略 |
| `~/.claude/sessions/<pid>.json` 记录每个运行中会话：sessionId、cwd、name、kind（interactive / bg）、jobId（即 attach 用的短 id）、status（busy / idle）、procStart | 会话列表和状态直接读文件，不轮询 `claude agents` |
| 转录在 `~/.claude/projects/<编码后的 cwd>/<sessionId>.jsonl`，按内容块追加 user / assistant 记录；官方文档声明格式内部、不稳定；后台会话发出第一条 prompt 前不生成该文件 | 聊天视图尾随此文件，解析必须防御式；空文件是正常状态 |
| CC 的 TUI 启用了括号粘贴模式（输出里有 `?2004h`） | 发送 prompt 用括号粘贴序列整段写入 |
| `claude logs <id>` 输出是带 ANSI 的原始画面回放 | 不用它做聊天视图，只在集成测试里用来验证输入到达 |
| node-pty 1.1.0 在 Node 24 上 `npm install` 直接使用预编译 ConPTY 二进制，无需编译 | 技术栈选 Node |
| 原生二进制在 `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe` | node-pty 直接 spawn 该 exe，不经过 cmd.exe |

用户决定：

- 排除 Remote Control（流量和转录经 Anthropic 服务器）。
- 采用 A1：监测器独占 attach，本地也经监测器看画面。
- 访问来源是局域网内的手机。
- 两种视图都做，手机默认聊天视图，终端画面一键切换。
- 首页为会话列表；非 `--bg` 启动的普通会话只能看状态和转录，不能输入。

## 3. 架构

单个 Node 进程运行在本机，监听局域网可达的端口，持有随机 token。三条数据通路：

1. **画面通路**：node-pty 运行 `claude.exe attach <id>`，输出进环形缓冲区并广播给该会话的所有客户端；所有客户端的输入写入同一个 PTY。
2. **结构化通路**：尾随转录 jsonl，生成聊天消息；读会话注册表得到会话列表与 busy / idle。
3. **事件通路**：接收 CC hooks 的 HTTP 回调，用于"CC 在等你"和"这轮结束"的提示。

客户端有两种：手机或电脑浏览器里的 Vue 单页应用，以及本地的薄命令行客户端。两者都只和监测器通信，都不直接 attach。

技术栈：Node 24 + TypeScript（ESM），node-pty 1.1.0、ws、@xterm/xterm 6 及 fit addon；前端 Vue 3 + Vite + TypeScript。备选的 Rust（axum + portable-pty）一期无收益，不采用。

## 4. 目录结构

```
cc-monitor/
  package.json                 npm workspaces：server、web、cli
  server/
    src/
      index.ts                 入口：读配置、起 HTTP 与 WebSocket、打印 URL 和二维码
      config.ts                端口、绑定地址、token、minCols、空闲脱离时间、claude.exe 路径
      registry.ts              读 ~/.claude/sessions，PID 存活与映像名校验
      attach.ts                AttachManager：每会话一个 PTY、环形缓冲区、客户端集合、尺寸策略、接管检测
      ringbuffer.ts            定长字节环形缓冲区
      paste.ts                 括号粘贴封装与快捷键映射
      transcript.ts            转录定位、增量尾随、记录解析为 ChatMessage
      hooks.ts                 POST /api/hook 接收端
      ws.ts                    WebSocket 协议编解码与路由
      auth.ts                  token 与 cookie 校验
    test/                      vitest 单元测试与夹具
  web/
    src/
      pages/SessionList.vue    首页：会话列表
      pages/SessionView.vue    会话页：标签切换、状态栏、输入框
      components/ChatPane.vue  聊天视图
      components/TerminalPane.vue  xterm.js 终端画面
      components/Composer.vue  共用的 prompt 输入框
      components/QuickKeys.vue 终端快捷键条
      components/StatusBar.vue attach 状态、busy / idle、接管回来按钮
      lib/ws.ts                WebSocket 客户端，自动重连
  cli/
    src/attach.ts              本地薄客户端：连本机 WebSocket，原样收发 PTY 数据与尺寸
  docs/superpowers/specs/      本文件
```

## 5. 组件

### 5.1 会话注册表读取器（registry.ts）

- 数据源：`<CLAUDE_CONFIG_DIR 或 ~/.claude>/sessions/*.json`。每个文件解析字段 pid、sessionId、cwd、name、kind、jobId、status、startedAt、procStart、version。解析失败的文件跳过。
- 存活校验：PID 存在，且映像名属于 claude.exe / node.exe / bun.exe（CC 自更新时映像名可能带 `.old.<时间戳>` 后缀，截断到 `.exe` 比对）。映像名用 `tasklist /FI "PID eq <pid>" /FO CSV` 查询，结果缓存 5 秒。procStart 与进程创建时间的比对作为可选增强，一期不做。
- 刷新：目录用 `fs.watch` 监听，加 3 秒兜底轮询。变化时向列表页和会话页广播。
- 输出类型：

```ts
interface SessionInfo {
  sessionId: string; pid: number; cwd: string; name: string;
  kind: 'interactive' | 'bg'; jobId?: string;      // jobId 仅 bg 有，即 attach 短 id
  status: 'busy' | 'idle' | 'unknown'; startedAt: number;
  attachable: boolean;                             // kind === 'bg'
}
```

### 5.2 attach 管理器（attach.ts）

- 每个 bg 会话最多一个 PTY。第一个客户端打开会话页时 spawn：`claude.exe attach <jobId>`，cwd 为会话目录，`name: 'xterm-256color'`，初始尺寸取该客户端尺寸经策略处理后的值。
- 输出：写入 512 KB 环形缓冲区，同时广播给该会话所有客户端。新客户端连上先收到 `replay` 帧（缓冲区全部内容），随后服务端做一次"尺寸抖动"（列数减一再加回）触发 TUI 全量重绘，避免回放截断的转义序列留下残影。
- 输入：任何客户端的 `in`、`paste`、`key` 帧都写入 PTY。
- 尺寸策略：PTY 尺寸跟随最近发出 `active` 或 `resize` 帧的客户端，列数不低于 `minCols`（默认 80），行数不低于 24；200 毫秒防抖。
- 空闲脱离：最后一个客户端离开 10 分钟（可配置）后发送 Ctrl+Z 脱离并回收 PTY；再次打开会话页时重新 attach。
- 接管检测：PTY 进程在非主动脱离时退出，若最近输出包含 `Session opened in another window`，状态置为 `taken_over`；否则置为 `error` 并附退出码与最近输出的末尾文本。两种状态都广播给客户端，页面显示"接管回来"按钮，按下即重新 spawn。
- 状态机：`detached → attaching → attached → (detached | taken_over | error)`。

### 5.3 括号粘贴与快捷键（paste.ts）

- 发送 prompt：先写 `ESC[200~` + 文本 + `ESC[201~`，等待 50 毫秒，再写 `\r`。文本中的 CRLF 统一为 LF。实现的第一个任务就是在真实会话上验证这条路径；若 TUI 不接受，退回逐字写入、每字间隔 10 毫秒、末尾 `\r`。
- 快捷键映射：Esc `\x1b`、Ctrl+C `\x03`、Tab `\t`、Shift+Tab `\x1b[Z`、上下左右 `\x1b[A` `\x1b[B` `\x1b[D` `\x1b[C`、Enter `\r`。不暴露 Ctrl+Z，因为它会让监测器脱离。

### 5.4 转录尾随器（transcript.ts）

- 定位：优先按文档规则计算路径，cwd 中非字母数字字符替换为 `-`；若文件不存在，则在 projects 目录下按 `<sessionId>.jsonl` 查找一次。找不到视为"尚无转录"，不是错误。
- 尾随：记录已读字节偏移，`fs.watchFile` 500 毫秒间隔加 `fs.watch` 触发，读新增字节，按换行切分，最后一个不完整行留到下次。
- 解析：只处理 `type` 为 `user` 或 `assistant` 且 `message.content` 存在的记录；跳过 `isMeta` 为真和 `isSidechain` 为真的记录。内容块映射：`text` 为正文；`thinking` 为折叠块；`tool_use` 取 name 与 input 的单行摘要（最长 200 字符）；`tool_result` 取内容的前 500 字符。其余记录类型忽略并计数，计数通过 `state` 帧带给页面，页面在计数异常增长时提示"转录格式可能已变化"。
- 输出类型：

```ts
interface ChatMessage {
  id: string; ts: number; role: 'user' | 'assistant';
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  text: string; tool?: { name: string; summary: string };
}
```

### 5.5 hooks 接收端（hooks.ts）

- `POST /api/hook`，只接受来自 127.0.0.1 的请求，不要求 token。请求体即 CC 传来的 JSON，按 `hook_event_name` 和 `session_id` 路由到对应会话的客户端，帧类型 `hook`。
- 一期关心三个事件：PermissionRequest 显示"CC 在等你确认，切到终端画面"；Notification 中 `notification_type` 为 permission_prompt 或 idle_prompt 时同上；Stop 显示"这轮结束"并刷新聊天视图。
- 接入：监测器启动时打印一段可直接粘贴进 `~/.claude/settings.json` 的 hooks 配置，handler 类型为 `http`，URL 指向本机端口。字段名以 CC hooks 文档为准，实现时核对。监测器不修改用户的设置文件。

### 5.6 网页（web/）

- 首页：会话列表，显示名称、目录、kind、busy / idle、attach 状态；bg 会话可点进，interactive 会话点进后只有聊天视图且输入框禁用并说明原因。
- 会话页：顶部状态栏，两个标签。聊天视图默认，终端画面一键切换，切换不断开连接。底部共用输入框，发送即 `paste` 帧。
- 终端画面：xterm.js + fit addon，容器宽度不足 `minCols` 时提示横屏或缩小字号；标签获得焦点时发 `active` 帧；一排快捷键按钮。直接在终端里打字仍然可用，但手机输入法与自动纠错不可靠，输入框是主要输入方式。
- 聊天视图：按 ChatMessage 渲染，用户消息右侧，助手文本左侧，工具调用折叠显示名称与摘要，thinking 默认折叠。新消息自动滚到底，用户上滑时停止自动滚动。
- 连接：每个会话页一条 WebSocket，断线指数退避重连，重连后收到 `replay` 与最新 `state`。

### 5.7 本地薄客户端（cli/）

- 用法：`cc-monitor attach <jobId 或会话名>`。连本机监测器的 WebSocket，stdin 设为 raw 模式转发为 `in` 帧，`out` 与 `replay` 帧原样写 stdout，终端尺寸变化发 `resize` 帧，启动时发 `active` 帧。Ctrl+] 退出客户端，不影响监测器与会话。
- 它存在的意义是让本地也不需要直接 `claude attach`，避免把监测器踢掉。

## 6. 协议

HTTP：

- `GET /` 及静态资源：网页。首次访问带 `?t=<token>`，校验通过后下发 cookie `ccm`，后续靠 cookie。
- `GET /api/sessions`：SessionInfo 数组。
- `GET /api/sessions/:sessionId/transcript?limit=200`：最近 N 条 ChatMessage，用于会话页首屏。
- `POST /api/hook`：见 5.5。

WebSocket `GET /ws?sid=<sessionId>`，JSON 文本帧，PTY 字节用 base64：

客户端到服务端

| 帧 | 字段 | 含义 |
|---|---|---|
| in | d | 原样按键字节，base64 |
| paste | text | 整段 prompt，服务端做括号粘贴并回车 |
| key | name | 快捷键名，见 5.3 |
| resize | cols, rows | 该客户端终端尺寸 |
| active | 无 | 该客户端成为尺寸策略的跟随对象 |
| attach | 无 | 重新 attach（接管回来） |

服务端到客户端

| 帧 | 字段 | 含义 |
|---|---|---|
| replay | d | 环形缓冲区内容，base64 |
| out | d | 实时 PTY 输出，base64 |
| state | attach, reason, status, size, unknownRecords | attach 状态机状态、原因文本、busy / idle、当前 PTY 尺寸、转录未知记录计数 |
| chat | messages | 新增的 ChatMessage 数组 |
| hook | event, data | hooks 事件透传 |
| sessions | list | 会话列表变化（列表页使用 `/ws?list=1`） |

## 7. 安全

- 默认绑定 `0.0.0.0`，端口默认 8787，可配置。token 为 32 位十六进制随机串，首次启动生成并保存在 `%LOCALAPPDATA%\cc-monitor\config.json`。
- 启动时在终端打印 `http://<局域网 IP>:<端口>/?t=<token>` 及其二维码，手机扫码进入。
- 所有 HTTP 路由与 WebSocket 升级都校验 cookie 或 `?t=`，`/api/hook` 例外但仅限回环地址。
- 明文 HTTP，仅用于家庭或办公室局域网，不暴露到公网。README 写明需要一条 Windows 防火墙入站规则，给出 `netsh advfirewall` 命令，不自动执行。
- 网页能向 CC 发送任意指令，等同于本机终端权限，token 不得外泄。

## 8. 错误处理

| 情况 | 行为 |
|---|---|
| 守护进程未运行或会话已停止 | attach 失败，状态 `error`，原因为退出码与输出末尾文本；会话页显示原因 |
| 被本地 `claude attach` 踢掉 | 状态 `taken_over`，显示"已被本地窗口接管"与"接管回来"按钮 |
| 转录文件不存在 | 聊天视图空状态，提示"发出第一条 prompt 后这里会显示对话" |
| 转录某行解析失败 | 跳过该行，计数加一 |
| 未知记录类型占比异常 | 页面提示转录格式可能已变化，终端画面不受影响 |
| WebSocket 断线 | 客户端指数退避重连，重连后回放缓冲区并同步状态 |
| 监测器重启 | 不自动 attach 任何会话；打开会话页时再 attach |
| claude.exe 找不到 | 启动即报错退出，提示配置 `claudeExe` 路径 |

## 9. 测试

- 单元测试（vitest，server/test）：转录解析器用脱敏后的真实 jsonl 夹具，覆盖 text / thinking / tool_use / tool_result、isMeta 跳过、半行处理、未知类型计数；注册表解析与存活校验用假 ProcessProbe；括号粘贴封装与快捷键映射；环形缓冲区溢出；attach 状态机的接管判定（用假 PTY）。
- 集成测试（仅本机手动运行）：起一个真实 `claude --bg` 会话，经服务端 attach，发 `paste` 帧，用 `claude logs <id>` 验证文本到达输入框；再起第二个 attach 验证 `taken_over` 判定；最后 `claude stop` 与 `claude rm` 清理。
- 前端（vitest + Vue Test Utils）：状态栏按状态渲染、输入框发送后清空、聊天视图自动滚动开关。
- 验收：手机在局域网内扫码进入，看列表、进会话、读聊天视图、切终端画面、发 prompt、按 Esc、被本地接管后接管回来。

## 10. 一期范围

做：第 3 到第 9 节的全部内容。

不做，留二期：HTTPS、多用户与权限、互联网访问、普通交互式会话的输入、把监测器做成 Windows 服务或托盘程序、从网页启动新会话或停止会话、转录的搜索与导出。

## 11. 风险

- 转录格式不稳定：解析器防御式实现并带计数提示，终端画面不依赖转录。
- attach 语义可能随 CC 版本变化：集成测试固定在 CC 版本号上，升级后重跑。
- ConPTY 与 xterm.js 的兼容细节：回放后的尺寸抖动是已知手段，若仍有残影，改为回放前先清屏再只回放最后一屏。
- 手机上 xterm.js 的输入法问题：输入框是主通道，终端直接打字只作补充。
