# Offline decoding component — final image and 60-minute decoder verified

This increment is separate from the verified WAV ASR chain. It does not yet claim 60-minute transcription, vendor recognition quality, or new accepted upload formats.

- Actual packaged FFmpeg reports `--enable-gpl` and GPL version 2 or later (see `installed-license.txt`); this is not represented as an MIT/LGPL-only build. The Debian package copyright file is retained in the image.
- Fixed Debian Bookworm FFmpeg package: `7:5.1.9-0+deb12u1`; the installed FFmpeg/libavcodec/libavformat/libavutil/libswresample versions match on ARM64.
- First built image: `sha256:840a355798e2c07e03b09bff75cec824e8dcd732715e2a44594527c0b57bdb93`, Docker reported size 514943719 bytes. This is the pre-library-layout-fix image, not a final deliverable.
- The real sessions probe failed because `libblas.so.3` resolves through `/etc/alternatives`, unavailable inside the namespace. See `first-isolated-failure.txt`. The same installation layout applies to `liblapack.so.3`.
- The Dockerfile resolves only those two package library symlinks to their real `/usr` targets at build time. It does not mount `/etc` or relax isolation.
- New decoder uses installed FFmpeg via argv, verifies original SHA256 and source size, and streams mono 16 kHz PCM into source-bound 30-second files. No second whole-recording PCM copy is made. Product limits are trusted caller arguments.
- New container probe generates a real 3600-second compressed MP3 fixture and requires 120 chunks, 115200000 decoded bytes, every chunk SHA256, unchanged readonly original, and explicit rejection of a source exceeding the requested duration. The fixture is silence and is not recognition accuracy evidence.
- The real isolated decoder probe passed using only explicit `/usr/lib/<architecture>/blas` and `/usr/lib/<architecture>/lapack` library paths in the diagnostic command. It decoded a 7200369-byte MP3 to 120 chunks / 115200000 PCM bytes, checked each hash and readonly original, and rejected excess duration and changed source. See `60min-isolated-decoder.txt`. That preliminary result was not final-image packaging evidence; the subsequent default-path packaged-image result is recorded below.
- No API duration/schema change is included here. Cross-architecture installation remains unverified. The owned `wx-audio-decode` container and volume were removed after the probe.

Source: https://packages.debian.org/bookworm/ffmpeg. Installed license/build metadata is retained in `/opt/sandbox/audio-license.txt`, `audio-copyright`, `audio-build.txt`, and `audio-versions.txt`; distribution license obligations must follow the actual packaged FFmpeg build.

Actual command: `docker exec -e AUDIO_PROBE_LIBRARY_LAYOUT=1 wx-audio-decode-skill-sandbox-sessions-1 node /tmp/audio-decode-container.mjs` (scripts injected into the container tmpfs first). The default probe omits this diagnostic library-path setting and must pass against the final repaired image.

## Final packaged-runtime evidence

`final-build.txt` is the successful final Docker build. `final-image.txt` identifies its immutable image ID and Docker-reported size. `installed-script-sha256.txt` matches the source script bytes. `container-limits.txt` records 1GiB memory, 128 PIDs, readonly rootfs and the existing seccomp profile.

The final default probe reads `/usr/local/lib/workspacex/decode-audio.py` from the actual image, with no diagnostic library-path override. `final-isolated-decoder.txt` proves 120 chunks / 115200000 PCM bytes from 3600 seconds, every chunk hash, unchanged readonly original, excess duration rejection, source-change rejection, and playlist rejection. Processing plus assertions took 2573ms (fixture generation is excluded). The owned container/volume were removed after this pass. All build sessions have exited.

Commands: `docker build --progress=plain -t workspacex-skill-sandbox:w14-audio apps/skill-sandbox`; start the existing sessions Compose using an image-only override with project `wx-audio-decode`; inject only the test harness into container tmpfs; run `docker exec wx-audio-decode-skill-sandbox-sessions-1 node /tmp/audio-decode-container.mjs`; finish with the same project's `down --volumes`.

Files in this increment: `apps/skill-sandbox/Dockerfile`, `apps/skill-sandbox/scripts/decode-audio.py`, `apps/skill-sandbox/tests/audio-decode-container.mjs`, and this evidence directory. The verified WAV source increment remains frozen. There is still no long-audio API/ASR consumer in this increment; see `next-runtime-delta.md`.
