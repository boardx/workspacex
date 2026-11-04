# Independent recording scope review

BASE: 2dfcf827d84bc8992c830a615643b4aacb548064
HEAD: 026d8dcac5c044fcafa8b5c33a5d633b346223b6
Reviewer: /root/review_github_import_6194 (reused, readonly)
Verdict: STATIC CLEAN; no actionable P1/P2.

Actual inventory: 88 changed paths = apps/web32 + docs2 + evidence54. apps/web32 = 17 components/display helpers + 6 dictionaries + 2 mock data modules + 1 pure-copy extraction + 4 unit suites + 1 E2E + 1 registration config. No apps/api, contracts, PCM/native-WS or ASR protocol source changes.

No locale-triggered recording start/stop, request/write/retry found. Device names/IDs/default null, draft and transcript raw content preserved. Caption translations guard stable ID and canonical raw caption. Task detail/SLA helpers consume fixed authored project-preview constants; no live custom task entry found.

Independent extraction check: baseline96563 bytes SHA25662b2d12a...78d6ee; 342 existing Chinese and348 English literals match baseline. Pure copy depends only on import-free withdrawal-rules module. Comparator retains original exports and four strict day-value probes, permits only four new caption keys.

No tests/type/lint/init/browser/services were run for this review. Historical206UI/25caption passes and old c9ad limited review are not acceptance of current026d. Latest parent-integrated type/regression/browser/CI remain UNVERIFIED. Preview project/interviewee panels do not prove live authorization/withdrawal or external ASR quality.

## Actual source-related paths

apps/web/components/chat/chat-composer-pickers.tsx
apps/web/components/rec/create-transcription-dialog.tsx
apps/web/components/rec/delete-transcription-dialog.tsx
apps/web/components/rec/edit-transcription-dialog.tsx
apps/web/components/rec/live-transcript.tsx
apps/web/components/rec/quote-annotate.tsx
apps/web/components/rec/realtime-transcription-workspace.tsx
apps/web/components/rec/rec-prep.tsx
apps/web/components/rec/rec-process.tsx
apps/web/components/rec/rec-verify.tsx
apps/web/components/rec/recording-project-display.ts
apps/web/components/rec/retention-panel.tsx
apps/web/components/rec/right-rail.tsx
apps/web/components/rec/speaker-assign.tsx
apps/web/components/rec/transcription-history.tsx
apps/web/components/rec/use-recording-notice.ts
apps/web/components/studio/studio-history.tsx
apps/web/e2e/i18n-recording-journey.spec.ts
apps/web/lib/i18n/messages/en.ts
apps/web/lib/i18n/messages/zh-CN.ts
apps/web/lib/i18n/namespaces/audio-input.ts
apps/web/lib/i18n/namespaces/recording-project.ts
apps/web/lib/i18n/namespaces/recording.ts
apps/web/lib/i18n/namespaces/studio-history.ts
apps/web/lib/mock/rec-v2.ts
apps/web/lib/mock/rec.ts
apps/web/lib/recording-display-copy.ts
apps/web/playwright.fullstack-smoke.config.ts
apps/web/tests/ui/audio-input-i18n.test.tsx
apps/web/tests/ui/recording-controller-i18n.test.tsx
apps/web/tests/ui/recording-journey-i18n.test.tsx
apps/web/tests/ui/recording-project-i18n.test.tsx
