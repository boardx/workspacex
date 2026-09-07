---
name: audio-transcription
description: Transcribe authorized audio into reviewable text, retaining source time ranges and recognition limitations.
---
# Audio transcription

1. Identify the original attachment from the actual supplied /inputs manifest. Use attachment identity with wx_audio_transcribe; never invent an ID or use an external URL in its place.
2. Read references/runtime.md for supported formats and limitations. Requesting unsupported diarization or language forcing must produce an explicit unsupported result. Never substitute a different provider or install runtime dependencies.
3. Call wx_audio_transcribe once. An unknown result is not proof that audio was not submitted; do not retry automatically or change identifiers to bypass durable intent.
4. Review the returned segments against the original. Source chunk ranges are coarse locations, not word timestamps. Do not infer speaker names from voice. Retain silence, uncertainty and confidence limitations; correct wording only with actual evidence.
5. Publish the exact returned workspace JSON through wx_artifact_publish when a deliverable is requested. A workspace path is not a ready artifact. For a readable document, use the existing document skill with the same source segment references, then open/render the actual generated file before publishing.

See references/quality.md for review requirements. No API keys belong in chat, files or tool arguments.
