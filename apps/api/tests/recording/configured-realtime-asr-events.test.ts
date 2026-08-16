import { describe, expect, it } from "vitest";
import {
  parseDashscopeTranscriptEvent,
  resolveTurnDetectionSilenceMs,
} from "../../src/infrastructure/recording/configured-realtime-asr-provider";

describe("resolveTurnDetectionSilenceMs", () => {
  it("uses 400ms when the environment value is not configured", () => {
    expect(resolveTurnDetectionSilenceMs(undefined)).toBe(400);
    expect(resolveTurnDetectionSilenceMs("")).toBe(400);
  });

  it("keeps a valid positive integer override", () => {
    expect(resolveTurnDetectionSilenceMs("600")).toBe(600);
  });
});

describe("parseDashscopeTranscriptEvent", () => {
  it("combines the official Qwen realtime text and revisable stash fields", () => {
    expect(parseDashscopeTranscriptEvent({
      type: "conversation.item.input_audio_transcription.text",
      text: "你",
      stash: "好",
    })).toEqual({ kind: "partial", text: "你好", confidence: null });
  });

  it("keeps completed transcripts as final results", () => {
    expect(parseDashscopeTranscriptEvent({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "你好",
      confidence: 0.9,
    })).toEqual({ kind: "final", text: "你好", confidence: 0.9 });
  });
});
