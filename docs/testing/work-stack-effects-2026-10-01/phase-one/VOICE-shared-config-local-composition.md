# 实时语音：统一配置与本地验收组合

生产语音只读取文字对话已有的 `KERNEL_MODEL_BASE_URL` 和 `KERNEL_MODEL_API_KEY`。旧 `KERNEL_OMNI_REALTIME_BASE_URL/API_KEY`、`KERNEL_ASR_BASE_URL/API_KEY`、`DASHSCOPE_API_KEY` 不再授权实时对话端点或凭据。固定POC模型为 `qwen3.8-omni-flash-realtime`。

已给出的非敏感文字对话端点：
`https://llm-jb1kfwgfohl80lle.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。
派生实时端点：
`wss://llm-jb1kfwgfohl80lle.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime`。
此映射已用合成测试key断言；未读取、提交或展示用户密钥。非法协议、凭据URL、未知主机和缺少统一配置均失败关闭。

本地测试使用独立composition脚本 `apps/api/scripts/start-fullstack-smoke-api.ts`：真实Nest/PG和正式streaming surfaces，唯一差异是通过函数参数显式注入隔离localhost Omni协议fixture。production entry没有测试环境开关或自动loopback回退。测试共用MODEL测试key；端口来自既有isolation wrapper。

Playwright fullstack config及本地PGlite voice trial runner改用此脚本，不再通过独立OMNI环境配置绕过统一规则。localhost合成PCM与模型回复只能证明LOCAL_PROTOCOL，不能证明真实Qwen供应商、devapp反代或专业业务能力。

共享采音层在返回句柄前恢复并验证AudioContext running；恢复失败停止麦克风轨道并关闭context。新鲜Chromium验收必须确认真实输入与非零播放、静音/打断、落库刷新、重试及所有媒体资源关闭。

现有回归：shared URL/key及preflight 44/44 PASS；共享采音/ASR/voice teardown 58/58 PASS。新composition版本真实Chromium运行待PG窗口安排，不能继承旧attempt2的通过结果。

2026-10-03本地main75addf492适配：API45/45、Web43/43、两端typecheck/lint绿；浏览器连接/静音/挂断有新截图，但输入音量0，真实音频输入和持久化未通过。真实供应商音频探针见evidence/digital-acceptance-20261002/r1/report.md；不得继承旧Chromium通过结论。
