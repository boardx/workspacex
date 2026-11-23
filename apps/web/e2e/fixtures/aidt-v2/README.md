# AIDT V2 synthetic speech fixture

`synthetic-prototype-test.wav` contains synthesized English speech, not a real person's interview or workshop evidence. The adjacent `.txt` is the authored ground truth for independent software QA; it must not be pasted into the transcription model request as its answer.

Generated locally on 2026-11-22 using FFmpeg's `flite` source and the bundled `slt` synthetic voice:

```sh
ffmpeg -f lavfi -i flite=textfile=synthetic-prototype-test.txt:voice=slt -af atempo=1.15 -ar 16000 -ac 1 -c:a pcm_s16le synthetic-prototype-test.wav
```

- PCM s16le, mono, 16000 Hz; duration 7.45444 s; 238620 bytes.
- SHA-256: `f0841829b4dc1223319da4d9fe3ccae71cc8b9a984b6179bb977058fcc19ccbf`.
- This file only proves a speech-bearing fixture exists. It does not prove provider ASR, transcription review, classroom consent, or end-to-end completion. Keep actual tool/run/artifact hashes and independent review results separately.
