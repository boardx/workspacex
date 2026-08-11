# Realtime ASR contract delta（#466 步骤 7）

Status: proposed; human signoff required.

本文件是本 delta 的**唯一规范来源**。已签核的 `recording` 束保持不变、不被静默修改；
若本包与既有束冲突，实现停下来，等人类签这份 delta。

## 背景（实测事实，SHA `ced78deb`）

- `apps/web` 对 `MediaRecorder` / `getUserMedia` / `mediaDevices` **零命中** —— 前端没有任何采音代码。
- `recording.controller.ts` 已有 4 条真路由（#465 已合入 main）：`startRecording`、
  `ingestSegment`、`endRecording`、`materializeRecordingArtifacts`。
- **`ingestSegment` 收的是 `rawText` + `asrConfidence`，不收音频。** 也就是说
  「音频 → 文字」这一步，现有契约把它留在了客户端。
- 人类 2026-08-05 指定用阿里云 **Qwen3-ASR-Flash-Realtime**。

## 决策、后果与被否决的备选

**决策**：新增**一条**服务端 WebSocket 面，由后端代理到阿里云实时 ASR；识别出的
最终文本由**服务端**调用既有 `ingestSegment` 用例落库。

**为什么必须是服务端代理**：`qwen3-asr-flash-realtime` 的鉴权是
`Authorization: bearer {API_KEY}`（`wss://…/api-ws/v1/realtime`，另需
`OpenAI-Beta: realtime=v1`）。浏览器直连等于把 DashScope key 发给每一个访客。
**没有任何前端方案能规避这一点**，所以这条 WS 面不是便利，是必需品。

**后果（如实列出，不粉饰）**：
1. 这是 `apps/api` 的**第一条流式面**。现有契约是 `{method, path}` 形状的 HTTP 契约，
   装不下 WS，因此本 delta 同时定义「WS 面怎么在契约里表达」这件事本身。
2. 引入一个外部 ASR 依赖，触及 D-U1「机密数据整轮全本地」的路由口径（见 §4）。
3. 录音音频会离开本地边界 —— 这是**人类必须知情并签核**的实质变化，不是实现细节。

**被否决的备选**：
- *浏览器 Web Speech API*：不动任何契约面、今晚可交付，但不是人类指定的模型，
  且中文质量不可控。人类 2026-08-05 明确选 B（服务端代理 Qwen）。
- *浏览器直连阿里云*：泄 key，直接出局。
- *把音频塞进 `ingestSegment`*：会把一个已签核的、语义是「收文本」的操作改成
  「也收音频」，属于静默修改已签束 —— 正是 ADR-023 要防的。

## 1. WS 面

```
WS  /recording/sessions/:sessionId/asr-stream
```

**鉴权与授权**：与 `ingestSegment` **完全同一条判定**（项目角色 + 会话可见性）。
不新增任何授权口径；无权即在握手阶段拒绝，不建立连接。

**前置**：`sessionId` 必须是经 `startRecording` 建立且未 `endRecording` 的会话。
`startRecording` 已经做过的事（保留期解析、consent 门禁、track 计划）本面**不重做也不绕过**。

### 客户端 → 服务端

| 帧 | 内容 | 说明 |
|---|---|---|
| JSON | `{"type":"asr.start","trackId":string,"idempotencyKeyPrefix":string}` | 必须是第一帧 |
| 二进制 | PCM16 / 16000 Hz / 单声道 裸帧 | 阿里云要求的格式，转换在浏览器侧完成 |
| JSON | `{"type":"asr.commit"}` | 手动模式下切一段 |
| JSON | `{"type":"asr.finish"}` | 正常收尾 |

### 服务端 → 客户端

| 帧 | 内容 |
|---|---|
| JSON | `{"type":"asr.partial","text":string}` —— 中间结果，**不落库** |
| JSON | `{"type":"asr.final","segmentId":string,"text":string,"lowConfidence":boolean}` |
| JSON | `{"type":"asr.error","reason":<见下>}` |
| JSON | `{"type":"asr.finished"}` |

`asr.error.reason` 枚举：`ASR_PROVIDER_UNAVAILABLE`、`ASR_NOT_CONFIGURED`、
`AUDIO_FORMAT_REJECTED`、`SESSION_ENDED`、`CONFIDENTIAL_SCOPE_FORBIDS_EXTERNAL_ASR`、
`NO_PROJECT_ROLE`。**没有「未知错误」这一项**——不认识的上游故障映射到
`ASR_PROVIDER_UNAVAILABLE` 并在服务端日志留原因，不向客户端编造语义。

## 2. 落库只有一条路

`asr.final` 由**服务端**调用既有 `ingestSegment` 用例落库，然后才回给客户端。

- **不新增第二条写路径。** 幂等键沿用 `ingestSegment` 的 `idempotencyKey`，由
  `idempotencyKeyPrefix + 序号` 生成，重连后重放同一段不会写第二条。
- 客户端**不能**自己调 `ingestSegment` 写 ASR 结果——否则同一事实两条写路径，
  正是 `AGENTS.md` 点名、本项目已漂移五次的反模式。
- 读回仍走既有 `readTranscriptStream`，本 delta **不新增读端口**。

## 3. 模型从注册表来，不写进代码

`no-hardcoded-model-list.test.ts` 是活的门控：模型名不得出现在源码里。因此：

- ASR 提供方与模型（`qwen3-asr-flash-realtime`）作为 `models` 注册表的一行**配置**，
  按组织解析，和别的模型走同一条池子逻辑。
- DashScope API key 存 `model_secrets`，**永不下发浏览器**，也不出现在任何响应体里。
- 未配置时的行为是 `ASR_NOT_CONFIGURED` 的**诚实降级**：录音按钮显示"未配置转写"，
  **不是**静默失败，也**不是**偷偷回退到别的提供方。

## 4. 机密数据边界（与 D-U1 的关系，必须人类拍板）

D-U1 的既有口径是「机密整轮全本地」。本面把音频送到**外部**提供方，因此：

- 会话所属项目/数据域被判定为机密时，本面**fail-closed 拒绝**，返回
  `CONFIDENTIAL_SCOPE_FORBIDS_EXTERNAL_ASR`，并在界面上说明原因。
- **不提供任何「确认后继续」的绕行开关。** 要放宽必须改 D-U1 本身，那是另一次签核。

⚠ 这一条是本 delta 与已签 `agent-runtime` / `chat` 束的**交叉约束**，
阶段一致性复核必须覆盖它。

## 5. 前端边界

- `apps/web/lib/live-recording.ts`：采音（`getUserMedia` → PCM16/16k/单声道）+ WS 客户端。
- chat 会话界面提供入口，锚点跟随既有 `chat-live-*` 前缀：
  `chat-live-recording-start` / `chat-live-recording-stop` / `chat-live-recording-status` /
  `chat-live-transcript`。
- 三种真实失败态可见、不静默：权限被拒、无麦克风设备、上传/转写失败。
- 录音路径**不得** import `lib/mock/rec*` 或 `lib/mock/itv`。

## 6. 不在本 delta 范围

- `app/rec` 与 `components/itv/live-record.tsx` 的去 mock（#466 第 5 条）——
  它们不在核心闭环第 7 步的路径上，单独一条 issue。
- 说话人分离、PII 遮盖、物化产物：既有 `recording` 束已签，本面不动。
- 把 WS 面推广到其它场景（chat 流式回复等）：本 delta 只授权 ASR 这一条。

## 7. 输入设备选择（增补，2026-08-12；append-only，不改 §1–§6）

人类要求：录音入口要能**选择输入麦克风**，参照 Claude Code 自身的「Microphone」下拉。
本增补**只动采集端**，§1–§4（WS 协议、`ingestSegment` 落库单路、机密 fail-closed）
**逐字不变**——上行仍是 PCM16/16k/单声道裸帧，上游听不出音频来自哪个设备。

### 7.1 采集引擎是单一事实源

`live-recording.ts` 的 `startCapture()` 是**唯一**一段真实采音代码，同时被
`live-asr.ts`（会话录音，#466）与 `live-asr-draft.ts`（composer 听写，#726）复用。
设备选择因此落在这一层，两条路径天然共享：

- `startCapture({ deviceId })`：`deviceId` 非空时，`getUserMedia` 约束加
  `audio.deviceId: { exact: deviceId }`；**为空时行为与今日逐字相同**（系统默认设备）。
  用 `exact`（而非软偏好）是刻意的：用户选了某个设备却被浏览器悄悄换成默认，
  比"设备不可用直接报错"更坏——后者由既有 `no-microphone` / `capture-failed` 具名失败态兜住。
- 新增 `enumerateInputDevices()`：返回 `kind === "audioinput"` 的设备
  `{ deviceId, label }[]`。**label 只有在已授权麦克风后才可读**（浏览器隐私约束），
  未授权时 label 为空串——这是**真实状态**，UI 必须如实显示占位（见 7.3），
  **不得**编造设备名，也**不得**为了拿名字在用户没点录音前偷偷弹权限。

### 7.2 本增补只接线 composer 听写入口

人类 2026-08-12 决定：设备下拉 UI **只挂在 composer 麦克风按钮**
（`chat-live-message-panel.tsx`，参照图就是这种听写交互）。会话录音面板
（`chat-recording-panel.tsx`）**本增补不加 UI**——引擎已向后兼容，它不传 `deviceId`
即保持今日行为，日后要加同样复用这一层，不重造。

### 7.3 三条不可省的诚实约束

1. **未授权 → 占位，不静默**：设备列表拿不到 label 时显示"允许麦克风后显示设备名"
   之类占位，而不是空白下拉假装没有设备。
2. **热插拔 → 刷新**：监听 `navigator.mediaDevices.devicechange`，插拔设备后列表更新。
3. **记住选择**：选中项存 `localStorage`（`wsx.micDeviceId`）；但**记的是 deviceId**，
   不是设备对象——下次进来若该 id 已不存在，退化为系统默认并如实反映，不卡在一个幽灵设备上。

### 7.4 明确不在本增补范围

- **「Hold to record（按住说话）」开关**：参照图里有，但它改的是 start/stop **交互语义**
  （按住 vs 点两下），触及已签 §5 的按钮行为，属于另一件事。人类 2026-08-12 决定
  **本增补不做**，单独一条 feature/签核。
- 会话录音面板（`chat-recording-panel.tsx`）的设备下拉 UI：见 7.2，本增补不接。
