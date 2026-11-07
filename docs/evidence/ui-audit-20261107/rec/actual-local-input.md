# Actual local microphone browser check

On 2026-11-07 root used CUA at the isolated 127.0.0.1:25778 project transcription entry. The user separately authorized at most 8 seconds of test speech and local replay. ASR was not started.

Created a named test transcription, opened Check microphone, and verified the panel stated capture starts only after clicking, max 8 seconds, page-memory-only, no upload/transcription. The native permission prompt required user operation because the tool forbids controlling the Codex window. The user confirmed Allow. Root cleared that permission-wait preview, started a fresh test phrase, and observed automatic stop and microphone released. Clicking Play changed the control to Pause. The user explicitly confirmed they could clearly hear the test sentence; this auditory confirmation is the user's, not the agent's.

Root then cleared the preview and closed the panel. Check microphone / Start transcription controls were available again. Start transcription was never clicked. No audio was exported or committed. The device label remained system default, so no physical-device identity or ASR accuracy is claimed. Existing controlled device-switch/cancel/unmount evidence remains separate. No production deployment.

[Released microphone and local preview](26-mic-local-preview-released.png)

[Preview cleared and panel closed](27-mic-preview-cleared.png)
