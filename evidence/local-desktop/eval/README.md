# 本地版性能 backlog（#3749）评测记录 — 2026-09-20

测量对象：同一台 Mac（Apple Silicon，16 GB），同一模型 qwen3.5:4b（GGUF，随包 Ollama 0.34.1）。
- **基线** `baseline2-installed-0.1.0.*`：安装版 0.1.0（DMG 03d61fff…，代码 8aa39175f 之前），机器空闲时跑。
- **改后** `after3-*.*`：源码栈，代码 `2b9ee9e52`（本 backlog 全部改动），同一 Ollama 实例、同一模型库。
脚本：`scripts/local-bundle/eval-local.mjs`，chat / url / canvas 各 5 题固定金标准，JSON 站点各 5 条。
首块延迟与块/s 取自 deep-agent 账本事件时间戳（块 ≈ token）；系统提示长度取自 deep-agent 线程状态。

| 指标 | 基线 0.1.0 | 改后 2b9ee9e52 | 变化 |
|---|---|---|---|
| 系统提示（普通对话）| 10 727 字符 | **629** 字符（点名画像时 4 304）| −94% |
| chat 中位 wall / 首块 | 8 s / 1.8 s | 11 s / 2.8 s（含 1 次冷加载 12 s；去掉后 ≈ 8 s / 2.6 s）| 持平 |
| url 中位 wall | 96 s（5 次里 3 次绕进 call_skill，最长 349 s）| **31 s**，5/5 直接 fetch_url，零绕路 | −68% |
| canvas 中位 wall | 213 s，4/5 成功（1 次 368 s 未结束），围栏 2/5，4/5 绕 call_skill | **67 s**，5/5 成功，围栏 **5/5**，零绕路 | −69%，合法率 40%→100% |
| 追问建议 | 1.8 s，5/5（含模板兜底，无法区分）| 1.3 s，5/5 均为模型输出（schema 约束）| — |
| 反馈结构化 | 8.7 s，4/5（1 次 503）| **2.9 s**，5/5 | −67% |
| 自动起名 | 0/5（本地未启用）| **5/5**（如「提高会议效率的三个办法」）| 从无到有 |
| 生成速度 tok/s | 25–35 | 25–35 | 不变（模型同一个）|

**主要来源**：画布指引/mermaid/技能目录按意图注入（提示 −94%，4B 不再被画布词带偏）；画布请求不列 skill 目录（消灭 call_skill 绕路，这是 url/canvas 三倍差距的来源）；JSON 约束解码（反馈 8.7→2.9 s，标题从无到有）；分区名校正（围栏 5/5 可渲染）；本地 API 连接超时 5→30 s（消灭轮询 500）。

**没有变快的**：纯生成速度（同一模型）、chat 首块（本来就 1–2 s）。

**未完成 / 记录**：
- B2.4 MLX 对比：`qwen3.5:4b-mlx` 下载四次都在 1 GB 左右因 TLS 超时中断，未能实测；命令 `ollama pull qwen3.5:4b-mlx` 后用本脚本 SUITE=chat 对比即可。
- B1.7 HNSW：按设计不建（见 issue 评论）。B4 级联/蒸馏：本机无云端凭据与训练数据，未做。
- 2B 元任务模型：16 GB 上每次换模型 2 s，抵消收益，已改为 ≥24 GB 才启用；随包仍带 2B。
- 评测时机器上同时有用户的 Ollama.app 0.34.1；改后版本始终起自己的实例（`OLLAMA_CONTEXT_LENGTH=8192`）。

**DMG** `WorkspaceX-0.2.0-arm64.dmg`（代码 2b9ee9e52）：8 147 346 839 B，sha256 `0339d1ea76a45473a7ec9c61af2a255450921d6eb3ca7a477994d08d3332b7b2`。挂载核对：`build-info.json` = {sha: 2b9ee9e52}，随包模型 qwen3.5:4b + qwen3.5:2b + qwen3-embedding，bundle 内 execute-run 含 selectGuidanceTemplates，Info.plist 版本 0.2.0。体积比 0.1.0 多 2.5 GB（2B 模型）。
