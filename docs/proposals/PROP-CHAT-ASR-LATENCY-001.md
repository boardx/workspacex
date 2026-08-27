# 提案：麦克风实时转录延迟优化

> **状态：已落地。** 2026-08-16 已修复 Qwen 高频中间结果解析，并将默认 VAD 静音阈值设为 400ms。
> 人类在 devapp 实测反馈：「目前实时转录的效果不好，有很大的延迟，需要优化转录的效果需要更加的实时」。

## 一、2026-08-16 根因修正：适配器曾忽略高频中间结果

此前调查只验证了音频上传路径没有攒批，却没有用阿里云官方下行事件做契约测试，因而错误地
把全部可感知延迟归因于 VAD。真实 Qwen Realtime 协议的高频中间结果是
`conversation.item.input_audio_transcription.text`，其中 `text` 为已确认前缀、`stash`
为可修订尾部；旧适配器却等待不存在的 `.delta` 事件，因此页面通常只能等到
`.completed` 才更新，表现为“返回很慢”。

现已把 `text + stash` 转为 BoardX interim 快照，并用纯协议单测和 loopback 上游锁定真实
事件形状。浏览器仍按 80ms 聚合 16kHz PCM16LE，即每帧 2560B、每秒 12.5 帧；这个粒度在
交互延迟与消息数量之间合理，不再继续放大帧长。

## 二、已经排除的可能性：音频上传链路没有额外攒批

逐层读过真实采音→上传→转发→上游这条链路（不是猜的，每一层都读了源码）：

1. **浏览器采音**（`apps/web/lib/PcmAudioWorklet.ts`）：AudioWorklet 显式下混、重采样为
   16kHz PCM16LE，再由 `PcmFrameBatcher` 聚合成 2560B（80ms）一帧；不足一帧的尾部在停止时
   flush，**不存在秒级攒批**。
2. **实时转录客户端**（`apps/web/lib/BoardxRealtimeAsrClient.ts`）：每拿到一帧就
   `socket.send(...)`，**没有额外 debounce/节流**。
3. **服务端网关**（`apps/api/src/interface/ws/asr-draft.gateway.ts`）：`ws.on("message", ...)`
   收到二进制帧直接 `upstream.pushAudio(raw)` 转发，**没有排队等待攒批**。
4. **上游适配器**（`apps/api/src/infrastructure/recording/configured-realtime-asr-provider.ts`）：
   `pushAudio()` 把帧 base64 编码后立即 `socket.send({type:"input_audio_buffer.append",...})`，
   **没有本地缓冲**。

⇒ 音频上传本身没有额外攒批；修复中间事件后，剩余的“最终句”延迟才主要由上游 VAD 与
断句判定决定。

## 三、当前配置：默认使用 400ms 断句参数

`session.update` 当前会发送：

```json
{
  "type": "session.update",
  "session": {
    "input_audio_format": "pcm",
    "sample_rate": 16000,
    "input_audio_transcription": { "model": "<配置的模型名>" },
    "turn_detection": {
      "type": "server_vad",
      "silence_duration_ms": 400
    }
  }
}
```

该文件遵循 DashScope Qwen Realtime 的 OpenAI-compatible 协议形状；控制断句延迟的字段是：

```json
"turn_detection": {
  "type": "server_vad",
  "threshold": 0.5,           // 触发灵敏度，越低越容易触发
  "prefix_padding_ms": 300,   // 语音开始前保留多少静音
  "silence_duration_ms": 500  // 静音持续多久判定为一句话结束
}
```

devapp 已验证 DashScope 接受该字段。`KERNEL_ASR_TURN_SILENCE_MS` 可用正整数覆盖默认值；
未配置、空值或非法值均回退到 400ms。

## 四、为什么不能直接猜一个值改上去

`configured-realtime-asr-provider.ts` 自己的历史就是最好的反面教材（`#802` hotfix，
文件头注原话）：

> 这支 loopback 用来测的协议此前接受 `transcription_session.update` 且从不检查 `?model=`
> 参数——跟当时 `ConfiguredRealtimeAsrProvider` 一模一样的错误假设——所以 smoke test
> 一直是绿的，而真实的 dashscope 端点在拒绝同样的帧。**这个错误协议假设在生产里
> 静默存在了 7 天以上没被发现**，直到有人拿真实端点验证才抓出来。

这条历史直接说明：**这个仓库对这条集成有过一次真实的、代价不小的教训**——凭协议文档
（哪怕是同一套 OpenAI Realtime 形状）猜字段名/取值，在没有真实端点验证的情况下改上去，
换来的可能是"看起来改了、实际上上游直接忽略或报错、又要好几天才被发现"。

**我（agent）在这个沙箱环境里没有真实 DashScope 凭据和网络出口**，本 session 至今全部
ASR 相关验证都是通过 `apps/api/scripts/loopback-asr-provider.ts`（确定性替身）做的——
这支替身可以模拟任何我们想要的时序（包括"立刻出结果，没有延迟"），**验证不了真实
DashScope 端点在收到 `turn_detection` 参数后到底会不会认、认了会不会真的更快**。

## 五、两条路径

### 路径 A：由能访问真实 devapp/DashScope 凭据的人验证后落地

1. 在**真实环境**（不是 e2e loopback）里，先只加 `session.update` 里的 `turn_detection`
   一个字段，观察：
   - DashScope 是否报错拒绝这个字段（如果拒绝，说明协议形状不认，路径 A 到此为止）
   - 如果不报错，延迟是否真的缩短
2. 从保守值开始试（比如 `silence_duration_ms: 300`，比默认更短但不会太激进），
   而不是一步到位调到极限值
3. 确认真的有效后，把验证过的参数值和验证记录写回本文档，再提交代码改动
   （改动本身很小——`configured-realtime-asr-provider.ts:133-140` 那个对象加一个字段）

### 路径 B：换一种能在沙箱里也验证得了的方式排查

如果没有人手头有 DashScope 真实凭据，另一种思路是：**先确认延迟到底发生在哪一段**——

- 如果 DashScope 的 WS 端点本身在文档里公开了默认 VAD 参数/典型延迟指标，看文档而不是猜
- 如果延迟是"用户说完一句话后要等一两秒才出字"，符合典型 VAD 断句延迟的特征，
  基本可以确认是路径 A 描述的问题，等真实环境验证窗口
- 如果延迟是"从一开始说话到任何文字出现都很慢"（不是断句慢，是完全没反应很久），
  那可能是网络本身的问题（RTT、上游负载），不是参数能解的，需要抓包/日志定位

## 六、我现在能做、且已经在做的

**麦克风按钮闪烁问题已经独立修复**（不依赖这份延迟提案，纯前端 CSS class 改动，
已验证：typecheck/lint/761 单测干净，commit `31c8596f`）——这是两个独立问题，
延迟这条卡在"需要真实环境验证"不影响闪烁那条先提交。

## 六点五、2026-08-11 更新：两个开关都已备好，等真实环境各试一次

### 开关 1（新代码，PR 已备）：`KERNEL_ASR_TURN_SILENCE_MS`
`configured-realtime-asr-provider.ts` 现在支持这个环境变量：设成正整数时会覆盖默认值；
未配置或为空时默认使用 `400`，并在 `session.update` 里发送
`turn_detection: { type: "server_vad", silence_duration_ms: 400 }`。非法值回退 400ms 并留日志。
上游若不认这个字段，会走既有 error→close 链路映射成清晰的界面降级提示，不会静默。

### 开关 2（零代码，改环境变量就行）：换模型 `KERNEL_ASR_MODEL`
人类问「是否有另外一种模式的实时转录」——**有，而且线索在本仓自己的模型清单里**
（`apps/api/scripts/lib/aliyun-bailian-models.ts`，#548 人类 2026-08-06 现场取值）：

| 清单里的 ASR 相关条目 | 标签 | 端点 |
|---|---|---|
| `qwen-audio-3.0-asr-flash-streaming` | ASR、**流式** | `wss://dashscope.aliyuncs.com/api-ws/v1/inference`（与现用同一 WS 端点族） |
| `qwen-audio-3.0-asr-flash-filetrans` | ASR、文件转写 | compatible-mode（非实时，不适用） |
| `qwen3.5-omni-plus-realtime` / `qwen-audio-3.0-realtime-plus` | 实时对话+ASR | 同 WS 端点（对话模型，杀鸡用牛刀） |

当前代码**不写死模型**——`KERNEL_ASR_MODEL` 环境变量在连接 URL 的 `?model=` 里生效。
仓库文档记录的现用值是 `qwen3-asr-flash-realtime`。如果 `qwen-audio-3.0-asr-flash-streaming`
（名字里带 streaming，可能是更新一代、以连续出字为卖点的流式 ASR）与现用协议形状兼容，
**换模型只需要改这一个环境变量重启，零代码改动**——这可能比调 turn_detection 更治本。

⚠ 两个开关是否真的有效、协议是否兼容，都**只能在真实 devapp/DashScope 凭据下验证**（#802 前科）。

## 七点五、2026-08-23 复查：人类再次实测反馈「文字远落后声音」+「标点符号不对」

人类在 devapp 上再次实测反馈同一条延迟投诉，并新增了标点符号问题。逐层复查结论：

### 复查 1：链路代码有没有偏离本文档记录的状态（无回归）

对比本文档记录的 2026-08-16/17 状态与当前 SHA（`ef9dffe9`，`main` 最新）：

- `apps/api/src/infrastructure/recording/configured-realtime-asr-provider.ts`：
  自 2026-08-16 起只有 `1390c872`（"default turn silence to 400ms"，2026-08-17）
  一次改动，`DEFAULT_ASR_TURN_SILENCE_MS = 400`、`KERNEL_ASR_TURN_SILENCE_MS` /
  `KERNEL_ASR_MODEL` 两个环境变量开关均未变化，与文档第三、六点五节记录一致。
  `parseDashscopeTranscriptEvent` 仍是 `text + stash` 拼接成完整快照后经
  `onPartial` 立即转发（`configured-realtime-asr-provider.ts:126-128,241-243`），
  没有引入任何缓冲/去抖。
- `apps/api/src/interface/ws/asr-draft.gateway.ts`：自 2026-08-16 起**无改动**
  （`git log --since=2026-08-15` 空）。`onPartial` 收到即用
  `send({ type: "asr.partial", text: t.text })` 转发，无排队。
- `apps/web/lib/live-asr-draft.ts` / `BoardxRealtimeAsrClient.ts`：均无
  2026-08-15 之后的改动；`socket.addEventListener("message", ...)` 收到
  `asr.partial` 即同步调用 `handlers.onPartial(frame.text)`，无 debounce/节流。
- `apps/web/lib/PcmAudioWorklet.ts` 唯一一次改动是 `5e2065d1`
  （2026-08-15，"batch realtime PCM frames"）——这条**早于**本文档 2026-08-16
  的调查基线，文档第一节"浏览器仍按 80ms 聚合 16kHz PCM16LE"这句话本身就是
  在这次改动之后写的，不是新回归。
- `apps/web/lib/use-asr-draft.ts` 有一次改动（`8ef5c237`，2026-08-20，
  补 connecting/stopping 中间态），只加状态机的过渡态，**没有碰**
  `onPartial`/`onFinal` 的转发路径（`appendTranscript` 逻辑与 `onTranscriptRef.current(...)`
  同步调用未变）。

⇒ 后端到浏览器事件转发这条链路，**没有发现任何偏离文档记录状态的新回归**。

### 复查 2：转录渲染是不是被今天 session 改动的文字消息组件误伤（不是）

转录状态机挂载在 `apps/web/components/chat/chat-live-message-panel.tsx`
（`useAsrDraft(...)`，第 460 行），这个组件今天 session 确实有大量改动历史，
但逐行核对转录相关路径：

- `onTranscript: (fullText) => updateDraft({ text: fullText })`（第 462 行）
  → `updateDraft` 直接 `setText(nextText)`（第 709-717 行），是同步的
  `React.useState` setter，**没有** `useMemo`/`React.memo`/`useDeferredValue`/
  `setTimeout`/`debounce`/`throttle` 包裹这条路径。
- `<Textarea value={text} ... />`（第 1432-1447 行）是普通受控输入，`value`
  直接绑定 `text` state，没有额外的渲染门槛。
- 全文 grep `speech\.` 只命中按钮状态展示（`connecting`/`stopping`/`listening`/
  `error`），转录文字本身走的是 `text`/`updateDraft`，与今天改动的"过程区"、
  "折叠头"等文字消息渲染逻辑是完全不同的代码路径，没有交叉。

⇒ 前端渲染路径**没有发现**额外引入的延迟或阻塞重渲染的 bug。

### 复查 3：标点符号问题——确认是模型原样输出，代码没有二次加工

- 全仓 grep 转录管线相关文件（`use-asr-draft.ts`、`live-asr-draft.ts`、
  `BoardxRealtimeAsrClient.ts`、`asr-draft.gateway.ts`、
  `configured-realtime-asr-provider.ts`）不存在任何 `replace(/…/)` 之类的
  正则改写、trim、全半角转换等针对转录文本的后处理。
- `use-asr-draft.ts` 的 `appendTranscript()` 只在拼接"基线文本 + 已提交转录 +
  当前临时转录"三段时按"结尾是否已有空白"决定要不要插一个 ASCII 空格
  （第 72-77 行），**不触碰**每一段内部的标点字符本身。
- `parseDashscopeTranscriptEvent()`（`configured-realtime-asr-provider.ts:116-138`）
  把上游 `text`/`stash`/`transcript` 字段原样拼接转发，没有任何字符级改写。

⇒ 标点符号是 DashScope 模型原样吐出来的，本仓代码链路上**没有**引入或损坏
标点。这是模型本身的标点质量问题，不是代码 bug——不建议在没有先例支持的情况下
额外发明一个"标点修正"后处理层去掩盖模型质量问题；是否要做规则修正、以及切换到
文档第六点五节列出的 `qwen-audio-3.0-asr-flash-streaming` 是否标点更好，需要在
真实环境里对比试用后再判断。

### 复查 4：两个开关在当前 SHA 上确认仍然可用，不需要等代码

- `KERNEL_ASR_TURN_SILENCE_MS`：设为正整数覆盖默认 400ms；非法值/空值回退
  400ms 并打警告日志（`configured-realtime-asr-provider.ts:71,73,91`）——
  与文档记录一致，**现在就能用，改环境变量 + 重启即可试**。
- `KERNEL_ASR_MODEL`：直接拼进连接 URL 的 `?model=` 查询参数
  （`configured-realtime-asr-provider.ts:164`），**不写死模型**——换成
  `qwen-audio-3.0-asr-flash-streaming` 同样只需要改环境变量 + 重启，
  零代码改动。

### 结论

这次复查确认：文档记录的两个"待人类在真实环境验证"的开关（VAD 静音阈值、
换流式模型）在当前 `main` 上原样成立，代码链路没有新引入的延迟或标点回归。
延迟问题的根因判断维持文档原结论——**卡在"需要真实 devapp/DashScope 凭据下
验证参数是否生效"**，本 agent 在这个沙箱环境里同样没有这项凭据，无法进一步
验证。标点问题判断为模型输出质量问题，代码链路未做任何后处理、也未引入损坏。

*本节由 dev-chat-e2e worker 于 2026-08-23 复查整理，未改动任何代码。*

## 七点二五、2026-08-27 issue #2217：CDP 实测本仓链路真实往返延迟（首次拿到硬数字）

人类在 devapp 再次实测反馈"延迟很严重"（issue #2217），并明确点名三个待查方向：
`use-asr-draft.ts` 有没有节流、`asr-draft.gateway.ts` 有没有攒批、以及 **#2090
刚修的 rewrite 路径是不是多绕了一跳**（这是此前六轮复查都没有的新变量——#2090
把 `/chat/asr-draft` 加回 Next `rewrites()` 枚举表，这之前 WS 握手直接失败，
现在握手改走 Next dev 的 rewrite 代理转发）。

此前六轮复查（本文档第一～七节）全部是"逐层读源码，没找到 debounce/攒批"，
从未拿到过一个真实毫秒数——这正是 issue #2217 明确要求补的证据。本轮用
**Chrome DevTools Protocol（`Network.webSocketFrameSent`/`webSocketFrameReceived`）**
给 `apps/web/e2e/copilotkit-v2-voice-input.spec.ts` 临时接上逐帧时间戳采集
（验证完已 `git checkout` 撤回，不在这次 PR 的 diff 里），跑一次真实
`pnpm run verify:chat-read -g "voice-input"`（真 Postgres + 真 API + 真 Next dev
+ `LOOPBACK_ASR_EMIT_DELTA=1` 确定性 ASR 替身，`--use-fake-device-for-media-stream`
喂假音频源，采音/WS 客户端/网关/适配器全部是真实生产代码，只有最上游换成
可预测的替身），量出**每一个二进制音频帧发出 → 下一条 `asr.partial`/`asr.final`
文本帧收到**之间的真实间隔：

```
wsUrl=ws://127.0.0.1:45198/chat/asr-draft（经 Next rewrite 代理，非直连 API）
totalFrames=45 binSent=15 textRecv=17 n=15
p50=1ms p95=4ms max=4ms
all=[0,0,1,1,1,1,1,1,1,1,1,1,1,2,4]
```

### 结论：本仓代码链路（含 #2090 新增的 Next 代理跳）往返延迟 ≤4ms，不是延迟来源

- `wsUrl` 落在 `webPort`（浏览器 `page.goto("/chat")` 所在的同一个 Next dev
  端口），确认这次测的就是**经过 #2090 那条 rewrite 代理**的完整路径，不是
  绕开它直连 API——**#2090 引入的额外一跳被实测覆盖，往返延迟仍在个位数
  毫秒**，不是"多绕一圈导致变慢"的候选根因。
- 15 个音频帧样本里 p50=1ms、p95=4ms、max=4ms，全部单帧延迟落在
  0-4ms 区间，量级上不可能是人类感知到的"延迟很严重"（那种投诉对应的通常是
  几百毫秒到数秒）。这与第一～七节"逐层读代码没找到 debounce/攒批"的结论
  第一次有了硬数字支撑，而不再只是"读代码觉得应该没问题"。
- 与此前六轮结论完全一致：`use-asr-draft.ts`/`live-asr-draft.ts`/
  `asr-draft.gateway.ts`/`configured-realtime-asr-provider.ts` 四层没有任何
  一层引入可感知延迟——这次是**实测**证实，不是又读一遍代码。

### 局限：这条实测路径上，"上游"是确定性替身，不是真实 DashScope

`LOOPBACK_ASR_EMIT_DELTA=1` 驱动的 `loopback-asr-provider.ts` 收到音频后**立刻**
回 `asr.partial`，没有真实 DashScope 的网络 RTT、模型推理时间、也没有真实
`turn_detection.silence_duration_ms`（VAD 断句静音判定）那种"要等用户停顿一段
时间才判定一句话结束"的行为。这次实测**排除了本仓代码链路**是延迟来源，
但**排除不了**"人类感知到的延迟其实来自真实 DashScope 上游"这个可能性——
这一点上，第四、五、六点五节记录的判断没有变：**验证真实 DashScope 端到端
延迟需要真实 `KERNEL_ASR_API_KEY` 凭据**，本 agent 在这个沙箱环境（无网络出口
到 `dashscope.aliyuncs.com`、`env | grep -i asr` 为空、无 `.env` 文件、也没有
devapp 登录态）里同样拿不到，与此前历次复查卡点一致。

⇒ **issue #2217 的结论**：本仓代码链路（前端状态机、WS 客户端、网关转发、
适配器转发、以及 #2090 新增的 Next 代理跳）经实测往返延迟 ≤4ms，不是延迟
来源，也不能再靠"多读一遍代码"进一步排查——唯一剩下的候选是真实 DashScope
上游本身的响应/断句延迟，这需要真实凭据 + 真实网络出口才能测，是本仓代码
改不了的外部依赖。按 issue 验收标准"能修的修，不能修的如实记录并关闭"，
这条判定为**已诊断、非本仓可控**，随本节归档关闭。

*本节由 dev-chat-e2e worker 于 2026-08-27 用 CDP 逐帧计时实测整理。*

## 七、需要人类决定的

- 是否有人能在 devapp 环境里手动验证一次 `turn_detection` 参数是否被 DashScope 接受、
  是否真的降延迟——如果可以，我可以先把改动写好（分支/PR 都准备好），由人类在真实环境
  跑一遍验证后再合并，不需要人类自己写代码
- 如果没有验证窗口，是否接受"延迟问题记录在案、暂不动代码"这个结果，等以后有验证条件
  再处理

---

*本文档由 dev-chat-e2e worker 于 2026-08-09 整理，不代表任何代码已经改动。*
