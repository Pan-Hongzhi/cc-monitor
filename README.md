# cc-monitor

局域网内用手机查看并操控本机的 Claude Code 会话：聊天视图读回答，终端画面看原样，输入框发 prompt。所有流量只在局域网内。

更详细的操作说明见 [使用手册](docs/cc-monitor%20使用手册.md)。

## 要求

- Windows 10 / 11，Node.js 24 或更新。
- 已安装并登录 Claude Code（npm 方式安装，`claude --version` 能运行）。
- 要操控的会话必须用 `claude --bg` 启动。普通方式启动的会话只能查看状态和对话，不能输入。

## 安装

    npm install
    npm run build -w web

## 启动

    npm start

启动后终端会打印一个带访问口令的地址和二维码，手机扫码即可打开。口令保存在 `%LOCALAPPDATA%\cc-monitor\config.json`，不要外泄：拿到它就等于拿到你这台电脑的终端。

第一次使用需要放行防火墙端口，在管理员 PowerShell 里执行：

    netsh advfirewall firewall add rule name="cc-monitor" dir=in action=allow protocol=TCP localport=8787

## 使用

1. 在项目目录里启动会话：`claude --bg --name 项目名`。
2. 手机打开监测器，列表里点进这个会话。
3. 聊天标签读对话，底部输入框发 prompt；需要确认权限、按 Esc 或用斜杠命令时切到终端标签。
4. 在电脑上看同一个会话，用 `npm run attach -- 项目名`，Ctrl+] 退出。不要直接 `claude attach`，那会把监测器踢下线；真踢了，手机上点"接管回来"即可。

## 手机提醒

把启动日志里打印的 hooks 片段合并进 `%USERPROFILE%\.claude\settings.json`，之后 CC 等你确认权限或一轮结束时，手机页面会出现横幅。监测器不会替你改这个文件。

## 配置

`config.json` 可选字段：`port`（默认 8787）、`bind`（默认 0.0.0.0）、`minCols`（默认 80）、`minRows`（默认 24）、`idleDetachMinutes`（默认 10）、`ringBufferKB`（默认 512）、`claudeExe`（默认自动查找）。环境变量 `CCM_PORT`、`CCM_BIND` 优先级更高。

## 排查

- 页面提示"已被本地窗口接管"：有人在电脑上直接运行了 `claude attach`，点"接管回来"。
- 提示找不到 claude.exe：在 `config.json` 里把 `claudeExe` 设为 Claude Code 原生二进制的完整路径。
- 手机竖屏画面被压缩：终端标签至少需要 80 列，横屏或在聊天标签里阅读。
- 聊天视图提示转录格式可能已变化：Claude Code 升级改了转录格式，终端标签不受影响。

## 开发

    npm test                 # 全部单元测试
    npm run dev:server       # 服务端热重载
    npm run dev:web          # 前端开发服务器，代理到 8787
    npm run it:attach -w server   # 真实会话集成验证，会起一个 ccm-it 会话并自动清理
