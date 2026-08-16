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

## 七、需要人类决定的

- 是否有人能在 devapp 环境里手动验证一次 `turn_detection` 参数是否被 DashScope 接受、
  是否真的降延迟——如果可以，我可以先把改动写好（分支/PR 都准备好），由人类在真实环境
  跑一遍验证后再合并，不需要人类自己写代码
- 如果没有验证窗口，是否接受"延迟问题记录在案、暂不动代码"这个结果，等以后有验证条件
  再处理

---

*本文档由 dev-chat-e2e worker 于 2026-08-09 整理，不代表任何代码已经改动。*
