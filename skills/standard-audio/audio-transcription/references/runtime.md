# Runtime and upstream

Adapted workflow from OpenAI skills/transcribe at 49f948faa9258a0c61caceaf225e179651397431, skills/.curated/transcribe/SKILL.md, Apache-2.0 (LICENSE.txt retained).
Source: https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/transcribe/SKILL.md

WorkspaceX uses its existing configured realtime ASR provider, not the upstream OpenAI CLI/model or runtime installation instructions. First adapter slice accepts authorized PCM16 mono16k WAV up to 120 seconds, under the existing 8MiB input limit. Language is detected by the provider; explicit language forcing and speaker diarization are unsupported. Thirty-second source chunks are real sample ranges, not phonetic alignment. This initial runtime does not satisfy 60-minute recording support. Missing configuration fails unavailable. No new transcript entity is created; use actual JSON hash and source hash, followed by existing artifact publication.
