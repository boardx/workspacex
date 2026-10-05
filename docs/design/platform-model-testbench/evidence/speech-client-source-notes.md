# 语音测试客户端边界

源码：`apps/api/src/infrastructure/model/platform-test-speech-client.ts`。纯测试：`apps/api/tests/model/platform-model-test-speech-client.test.ts`。

## 已实现并验证

`pnpm --filter @repo/api exec vitest run --config vitest.platform-model-test.config.ts tests/model/platform-model-test-speech-client.test.ts` 退出 0，26 项通过；见 `speech-client-tests.txt`。替代 fetch 响应，无供应商调用、无 DB/服务启动。最终集成 API typecheck 与 CI 由协调者统一执行。

只实现 `qwen3-tts-flash` 的非流式 character 方言。使用固定部署 endpoint/API key/model 与部署音色白名单；prepare 生成不可变 JSON，invoke 只接受本 client 实际 prepare 的原对象，门控后只发送一次该字节串，不重试失联付费调用。计费数量由用户明确上界，部署上界最多 600；输入 UTF8 字节数是 Unicode 字符各种计数的保守上界，不宣称等于厂商实际 billable characters。完整 JSON 还有有限 UTF8 传输上界。

先读取响应明确报告的 `usage.characters`，再判断 HTTP/业务失败；失败响应的真实已报告字符量仍保留计量，不从错误状态估算数量。成功/失败与消耗独立，输入/输出 Token 的文档占位 0 不作为真实 Token 消耗；缺失/零/非法字符量或不匹配 Token 方言保持 unknown。超上界的真实已报告字符量保留计量并拒绝成功结果。JSON 响应最多 2 MB；取消/失联保留 unknown，没有自动重发。

音频 URL 只接受 HTTPS、无内嵌用户名密码，返回 duration 未知，不下载供应商资产。官方样例 URL 是 HTTP；本实现明确拒绝该结果并保留已知消耗，不擅自改协议。HTTP 资产需要后续可信资产代理或已确认 HTTPS 返回，开发不能据替代响应宣称账号真实验收。

ASR 仅有真实 PCM16 单声道→WAV 编码辅助函数（16/24 kHz 为平台输入契约范围），校验 canonical Base64、偶数字节样本、最多 60 秒的显式传输上界，生成正确 RIFF/fmt/data。其 boundedDurationMs 是传输上界，不能当供应商计费时长。本文件不实现 ASR 调用。后续独立 `platform-test-asr-client.ts` 由协调线程实现其已核验协议；实际可用性以部署注册、成员与预算准入为准，未注册默认不可用。普通组织的 ASR 产品 Token 输入上界尚未验证时禁用，不因原生时长计费忽略已报告输出 Token。

## 官方依据

- [非实时 Qwen-TTS API](https://help.aliyun.com/zh/model-studio/qwen-tts-api)，2026-10-05 核验：POST multimodal-generation/generation、text/voice/language_type、stop 终态、audio.url、character 与 Token 方言区分、有限输入。
- [非实时 Qwen-ASR API](https://help.aliyun.com/en/model-studio/qwen-asr-api-reference)，2026-10-05 核验：WAV Data URL 输入支持；不同协议 usage 不能混作已确认部署价格或计费单位。

## 集成检查

早期正常 API lint 被共享测试固定 completeness denominator 命中 design-facet 单源规则，协调者已修复；本轮再次运行正常 `pnpm --filter @repo/api lint`，退出 0、全部正常 API lint 门控通过，见 `speech-client-lint.txt`。未修改其他 owner 文件或绕过规则。
