# cc-monitor

局域网内用手机查看并操控本机的 Claude Code 会话。

## 集成验证

需要本机已安装 Claude Code 并登录。脚本会起一个名为 ccm-it 的后台会话，验证完自动清理：

    npm run it:attach -w server

加 `--submit` 会真的提交一条 prompt 验证回车路径，会消耗一次对话：

    npm run it:attach -w server -- --submit
