"""Bounded offline FFmpeg adapter. Trusted caller supplies all product limits.

Originals stay under /inputs. PCM is streamed into source-bound chunks rather
than materializing a second full recording. The session owns process deadlines.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--source-hash', required=True)
    for name in ('max-source-bytes', 'max-duration-ms', 'chunk-duration-ms', 'max-chunks'):
        parser.add_argument('--' + name, required=True, type=int)
    args = parser.parse_args()
    limits = (args.max_source_bytes, args.max_duration_ms, args.chunk_duration_ms, args.max_chunks)
    if any(value <= 0 for value in limits) or not re.fullmatch(r'[a-f0-9]{64}', args.source_hash):
        raise ValueError('invalid trusted limits')
    source = Path(args.source)
    if not source.is_absolute() or '..' in source.parts or not source.resolve().is_relative_to('/inputs'):
        raise ValueError('original input required')
    if not source.is_file() or source.stat().st_size > args.max_source_bytes:
        raise ValueError('source unavailable or oversized')
    if hashlib.sha256(source.read_bytes()).hexdigest() != args.source_hash:
        raise ValueError('source changed')
    # PCM transport is the existing ASR contract: mono 16 kHz signed 16-bit.
    rate, sample_bytes = 16000, 2
    chunk_frames = args.chunk_duration_ms * rate // 1000
    max_frames = args.max_duration_ms * rate // 1000
    if chunk_frames < 1 or (max_frames + chunk_frames - 1) // chunk_frames > args.max_chunks:
        raise ValueError('inconsistent trusted limits')
    command = ['/usr/bin/ffmpeg', '-nostdin', '-v', 'error', '-xerror',
               '-threads', '1', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe',
               '-format_whitelist', 'wav,mp3',
               '-i', str(source), '-map', '0:a:0', '-vn', '-sn', '-dn',
               '-t', str((args.max_duration_ms + 1000) / 1000),
               '-ac', '1', '-ar', str(rate), '-f', 's16le', 'pipe:1']
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               env={**os.environ, "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"})
    created, chunks, total_frames = [], [], 0
    try:
        while True:
            pcm = bytearray()
            while len(pcm) < chunk_frames * sample_bytes:
                part = process.stdout.read(chunk_frames * sample_bytes - len(pcm))
                if not part:
                    break
                pcm.extend(part)
            if not pcm:
                break
            if len(pcm) % sample_bytes:
                raise ValueError('invalid PCM frame')
            frames = len(pcm) // sample_bytes
            if total_frames + frames > max_frames or len(chunks) >= args.max_chunks:
                raise ValueError('duration limit exceeded')
            path = Path(f'/workspace/audio-{args.source_hash}-{total_frames}.pcm')
            # Files are derived working copies; never modify original inputs.
            path.write_bytes(pcm)
            created.append(path)
            chunks.append(dict(path=str(path), startMs=total_frames * 1000 // rate,
                               endMs=((total_frames + frames) * 1000 + rate - 1) // rate,
                               sizeBytes=len(pcm), frames=frames,
                               sha256=hashlib.sha256(pcm).hexdigest()))
            total_frames += frames
        if process.wait() != 0 or not chunks:
            raise ValueError('audio decoding failed')
        print(json.dumps(chunks, separators=(',', ':')))
    except BaseException:
        for path in created:
            path.unlink(missing_ok=True)
        raise
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdout.close()


if __name__ == '__main__':
    main()
