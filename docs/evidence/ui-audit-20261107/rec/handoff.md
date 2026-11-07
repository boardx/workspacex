# #6353 本地麦克风检查

人类直接交办审计整改，队列外执行。只在明确开始检查后采音，复用 startCapture 的精确 deviceId 与 PCM16/16kHz 输出、pcm16Level 电平计算。最多8秒（墙钟与样本数双门）；提前结束可试听，停止并清除/关闭/切设备/卸载会释放并丢弃本地数据，迟到授权句柄也会 stop。正式转写按钮在检查面板关闭后恢复，仍需用户明确点击。

WAV 只存在内存和 blob URL，不调用 ASR、不创建服务器转写；试听清理还会 pause/remove src/load，撤销 URL。默认设备 label 不可知时明确说明，不编造实际设备名。

## 精确提交清单

- apps/web/components/rec/realtime-transcription-workspace.tsx
- apps/web/components/rec/local-microphone-check.tsx
- apps/web/components/rec/use-local-microphone-check.ts
- apps/web/lib/i18n/namespaces/recording.ts
- apps/web/tests/ui/rec-local-microphone-check.test.tsx
- apps/web/tests/ui/realtime-transcription-workspace.test.tsx
- docs/evidence/ui-audit-20261107/rec/

## 验证

- red.log：实现前缺失本地检查模块，退出1。
- green.log：`pnpm --filter web exec vitest run tests/ui/rec-local-microphone-check.test.tsx tests/ui/realtime-transcription-workspace.test.tsx tests/recording/live-recording-capture.test.ts tests/ui/realtime-transcription-history.test.tsx tests/ui/recording-journey-i18n.test.tsx` → 115 passed。
- lint.log：对上述6个源/测试文件执行 eslint --max-warnings 0，退出0。
- `node docs/evidence/ui-audit-20261107/rec/browser-check.cjs` → 退出0，browser.log 与 local-preview.png。
- 浏览器 fixture 使用实际 LocalMicrophoneCheck、hook、startCapture 与 PCM 电平；React Button/i18n 是薄适配。Chromium fake media 验证8秒自动停止、WAV播放、所有轨道ended、关闭清理、无网络/ASR请求。该合成音频证据不能代表真人短句ASR准确率，也不能代替主会话应用壳人工复测。
- typecheck.log：全量 tsc 退出2，仅并行 survey-live-workspace.test.tsx:464 缺version；录音文件未报错。没有回退或修改该问卷文件。
- git diff --check（本范围）通过。无 Docker、无提交、无切分支。

## 历史音频清理事实边界

存在 DELETE personal transcription 后端：recording.controller.ts 的 deletePersonal → personal-transcription-usecases.ts/deletePersonalTranscription → pg-personal-transcription-repository.ts/deleteOwned。当前路径结束活动capture并删除 recording_sessions 与 personal_transcriptions 数据行。未在本任务验证对象存储原始音频清理，不能据此声明历史原始录音文件已删除。本地试听清除与该后端路径无关。

## 主会话后续

按上述清单独立提交PR，应用壳复测设备选择/本地检查/关闭/正式转写入口。受控真人短句准确率单独验收。
