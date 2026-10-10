<h1 align="center">cc-monitor</h1>

<p align="center">
  在局域网内用手机查看并操控本机的 <a href="https://claude.com/claude-code">Claude Code</a> 会话。
</p>

<p align="center">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0C0C0F">
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A5%2024-3C873A">
  <img alt="Built with" src="https://img.shields.io/badge/built%20with-Vue%203%20%C2%B7%20xterm.js%20%C2%B7%20node--pty-E07A5F">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-22C55E">
</p>

Claude Code 自带后台会话（`claude --bg`），终端关了也不会退出。cc-monitor 接上这些会话，把画面复制到手机和电脑上的多个页面，把你在页面上输入的内容送回会话。所有数据只在你的局域网内流动，不经过任何外部服务器。

## 功能

- **会话列表**：列出本机正在运行的全部 Claude Code 会话，实时显示忙碌 / 空闲，自动刷新。
- **聊天视图**：按 Claude Code 终端的转录样式渲染对话，你的 prompt、回答、工具调用、工具结果和思考各有标记，长结果默认折叠，适合手机阅读。
- **终端画面**：和电脑终端一模一样的画面，带 Esc、Ctrl+C、Tab、方向键等快捷键条，用来处理权限确认和斜杠命令。
- **发送 prompt**：底部输入框支持多行，整段作为一条 prompt 发出；网络断开时文字保留不丢。
- **多端同步**：手机、电脑浏览器、本地终端可以同时看同一个会话，画面同步，都能输入。
- **停止会话**：手机上两次点击即可停止后台会话，对话记录保留。
- **手机提醒**：配合 Claude Code 的 hooks，在需要确认权限或一轮回答结束时弹出横幅。
- **界面**：Claude Code 终端风格，等宽字体、近黑底色、品牌橙强调。

## 要求

- Windows 10 / 11，Node.js 24 或更新。
- 已安装并登录 Claude Code（npm 方式安装）。
- 要操控的会话必须用 `claude --bg` 启动；普通方式启动的会话只能查看，不能输入。
- 手机和电脑在同一个局域网。

## 快速开始

```powershell
npm install
npm run build -w web
npm start
```

启动后终端会打印一个带访问口令的地址和二维码，手机扫码即可打开。首次使用需要放行防火墙端口，在管理员 PowerShell 里执行一次：

```powershell
netsh advfirewall firewall add rule name="cc-monitor" dir=in action=allow protocol=TCP localport=8787
```

然后在你的项目目录里启动一个后台会话：

```powershell
claude --bg --name 项目名
```

手机列表里点进它，就可以读对话、发 prompt、看终端了。完整说明见 [使用手册](docs/cc-monitor%20使用手册.md)。

## 在电脑上看同一个会话

```powershell
npm run attach -- 项目名
```

Ctrl+] 或 Ctrl+Z 退出。不要直接运行 `claude attach`，那会把 cc-monitor 挤下线；真挤了，手机上点"接管回来"即可。

## 安全

- 访问口令保存在 `%LOCALAPPDATA%\cc-monitor\config.json`，拿到它就等于拿到你这台电脑的终端，不要外传。
- 传输是明文 HTTP，只在可信的家庭或办公室局域网里用，不要把端口暴露到公网。需要在外面用时，建议用 Tailscale 这类组网工具把手机拉进同一个虚拟局域网，cc-monitor 本身不用改。
- cc-monitor 不修改 Claude Code 的任何文件；hooks 配置由你自己粘贴进 settings.json。

## 工作原理

```
手机 / 电脑浏览器 ──WebSocket──┐
                               ├── cc-monitor（Node）──node-pty──▶ claude attach <id> ──▶ 后台会话
本地终端 npm run attach ───────┘        │
                                        ├── 尾随 ~/.claude/projects/<cwd>/<会话id>.jsonl → 聊天视图
                                        ├── 读取 ~/.claude/sessions/*.json → 会话列表与忙闲
                                        └── 接收 Claude Code hooks 的 HTTP 回调 → 手机提醒
```

一个后台会话同一时刻只能被一个客户端接住，cc-monitor 占着这个位置，再把画面复制给任意多个页面。

## 开发

```powershell
npm test                      # 全部单元测试
npm run dev:server            # 服务端热重载
npm run dev:web               # 前端开发服务器，代理到 8787
npm run it:attach -w server   # 真实会话集成验证，会起一个 ccm-it 会话并自动清理
```

目录结构：`server/` 服务端（attach 管理、转录尾随、会话注册表、HTTP 与 WebSocket），`web/` 手机页面（Vue 3 + xterm.js），`cli/` 本地薄客户端，`docs/` 使用手册与设计文档。

## 许可证

[MIT](LICENSE)
