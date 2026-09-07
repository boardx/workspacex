# Planned bounded long-audio consumer

This is a plan, not implemented runtime behavior. The verified WAV increment remains unchanged.

1. Keep the existing original attachment identity, current membership/thread visibility checks, fixed source hash, and persisted pre-submit intent. Add MP3 to the existing shared upload MIME policy only when the real decode fixture passes; no second upload policy or arbitrary URL input.
2. Replace the WAV-only decoder with the installed FFmpeg adapter for WAV/MP3. Trust only server-bound `/inputs` paths. The decoder restricts demuxers and protocols, streams 30-second PCM chunks, and rejects actual decoded duration above the requested maximum rather than accepting truncation.
3. Derive the chunk count from one shared 60-minute/30-second limit. A 60-minute recording produces 120 chunks and 115200000 PCM bytes; no duplicate whole PCM buffer is written. Existing per-file 8MiB and 256-file/session limits remain in force.
4. Use at most four existing manual ASR sessions concurrently, with the same actual terminal protocol and item/event revision collector. Revalidate owner/source access before remote work and final confirmation. No replacement queue, provider, run lease, or main-run lifecycle.
5. Bound the entire tool to 240 seconds, below the default main model deadline. Slow or unknown outcomes fail explicitly and do not resubmit a persisted intent. Do not claim arbitrary provider latency or all configured main-run timeout values support the full duration.
6. Output timestamps remain decoded source chunk boundaries. No speaker, word timing, or calibrated confidence claims. A final receipt requires all chunks; no partial transcript is labelled complete. Preserve bounded JSON output and existing artifact publication/writeback.
7. Required evidence: real 60-minute compressed input decoded inside the isolated session; actual WebSocket sessions for all chunks and observed concurrency bound; full receipt replay without additional submission; source revoke/changed bytes rejection; final artifact bytes/hash; original unchanged. Local deterministic WS evidence verifies orchestration, not external supplier accuracy.
