/** Return a 0..1 RMS level from real PCM16 samples for every voice surface. */
export function pcm16Level(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sumSquares = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const normalized = frame[index]! / 0x8000;
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / frame.length);
  return Math.max(0, Math.min(1, rms * 4));
}
