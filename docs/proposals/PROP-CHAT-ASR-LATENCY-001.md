# 提案：麦克风实时转录延迟优化

> **状态：未执行。** 本文档只是调查结论 + 待验证的改动方案，不代表任何代码已经改动。
> 人类在 devapp 实测反馈：「目前实时转录的效果不好，有很大的延迟，需要优化转录的效果需要更加的实时」。

## 一、先排除的可能性：我们自己的代码没有引入延迟

逐层读过真实采音→上传→转发→上游这条链路（不是猜的，每一层都读了源码）：

1. **浏览器采音**（`apps/web/lib/live-recording.ts`）：`AudioContext.createScriptProcessor(4096, 1, 1)`，
   在典型 44.1kHz/48kHz 采样率下每 ~85-93ms 触发一次回调，`onaudioprocess` 里直接把这一帧
   转 PCM16 后同步调用 `listener(frame)`——**没有内部缓冲或攒批**。
2. **草稿转录客户端**（`apps/web/lib/live-asr-draft.ts`）：`capture.onFrame` 回调里直接
   `socket.send(...)`，收到一帧就发一帧，**没有 debounce/节流**。
3. **服务端网关**（`apps/api/src/interface/ws/asr-draft.gateway.ts`）：`ws.on("message", ...)`
   收到二进制帧直接 `upstream.pushAudio(raw)` 转发，**没有排队等待攒批**。
4. **上游适配器**（`apps/api/src/infrastructure/recording/configured-realtime-asr-provider.ts`）：
   `pushAudio()` 把帧 base64 编码后立即 `socket.send({type:"input_audio_buffer.append",...})`，
   **没有本地缓冲**。

⇒ **音频从麦克风到打上游的每一跳都是即时转发，链路里没有我们自己加的延迟。**
可感知的延迟来自上游（DashScope 实时 ASR 端点）自己何时决定"这一段可以出转录结果了"——
这是典型的语音活动检测（VAD）/断句判定延迟，不是我们代码里的 bug。

## 二、当前配置：完全没有配置断句参数

`session.update` 目前只发三个字段（`configured-realtime-asr-provider.ts:133-140`）：

```json
{
  "type": "session.update",
  "session": {
    "input_audio_format": "pcm",
    "sample_rate": 16000,
    "input_audio_transcription": { "model": "<配置的模型名>" }
  }
}
```

**没有 `turn_detection` 相关字段。** 该文件遵循的协议形状是 OpenAI Realtime API 的镜像
（文件头注逐字："OpenAI realtime 形状"），那份协议里控制断句灵敏度/延迟的标准字段是：

```json
"turn_detection": {
  "type": "server_vad",
  "threshold": 0.5,           // 触发灵敏度，越低越容易触发
  "prefix_padding_ms": 300,   // 语音开始前保留多少静音
  "silence_duration_ms": 500  // 静音持续多久判定为一句话结束
}
```

**DashScope 的端点是否认这些字段名、认哪些取值范围——我们不知道，也没有验证过。**

## 三、为什么不能直接猜一个值改上去

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

## 四、两条路径

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

## 五、我现在能做、且已经在做的

**麦克风按钮闪烁问题已经独立修复**（不依赖这份延迟提案，纯前端 CSS class 改动，
已验证：typecheck/lint/761 单测干净，commit `31c8596f`）——这是两个独立问题，
延迟这条卡在"需要真实环境验证"不影响闪烁那条先提交。

## 六、需要人类决定的

- 是否有人能在 devapp 环境里手动验证一次 `turn_detection` 参数是否被 DashScope 接受、
  是否真的降延迟——如果可以，我可以先把改动写好（分支/PR 都准备好），由人类在真实环境
  跑一遍验证后再合并，不需要人类自己写代码
- 如果没有验证窗口，是否接受"延迟问题记录在案、暂不动代码"这个结果，等以后有验证条件
  再处理

---

*本文档由 dev-chat-e2e worker 于 2026-08-09 整理，不代表任何代码已经改动。*
