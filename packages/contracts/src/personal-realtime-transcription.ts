/**
 * User-owned realtime transcription contract.
 *
 * This surface is deliberately independent from project recording. An organization is
 * still the tenant and billing boundary, but ownership is always the authenticated user;
 * none of these operations accepts a project id or a project-role failure code.
 */
import { z } from "zod";

export const PersonalTranscriptionStatus = z.enum(["idle", "recording", "completed", "failed"]);
export const PersonalCaptureStatus = z.enum(["recording", "completed", "failed"]);

const Name = z.string().trim().min(1).max(100);
const Tag = z.string().trim().min(1).max(20);
const Tags = z.array(Tag).max(5);

export const PersonalTranscriptionSummary = z.object({
  sessionId: z.string(),
  name: Name,
  tags: Tags,
  status: PersonalTranscriptionStatus,
  durationMs: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export const PersonalTranscriptionSegment = z.object({
  segmentId: z.string(),
  captureId: z.string(),
  ordinal: z.number().int().positive(),
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  createdAt: z.string(),
}).strict();

export const PersonalTranscriptionCapture = z.object({
  captureId: z.string(),
  status: PersonalCaptureStatus,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  segments: z.array(PersonalTranscriptionSegment),
}).strict();

export const PersonalTranscriptionDetail = PersonalTranscriptionSummary.extend({
  captures: z.array(PersonalTranscriptionCapture),
}).strict();

export const PersonalTranscriptionError = z.enum([
  "AUTH_REQUIRED",
  "ORG_MEMBERSHIP_REQUIRED",
  "VALIDATION_FAILED",
  "TRANSCRIPTION_NOT_FOUND",
  "CAPTURE_ALREADY_ACTIVE",
  "QUOTA_EXCEEDED",
  "ASR_NOT_CONFIGURED",
]);

export const RealtimeAsrStreamError = z.enum([
  "TICKET_INVALID",
  "TICKET_EXPIRED",
  "TICKET_USED",
  "NOT_TRANSCRIPTION_OWNER",
  "QUOTA_EXCEEDED",
  "ASR_NOT_CONFIGURED",
  "ASR_PROVIDER_UNAVAILABLE",
  "AUDIO_BACKPRESSURE",
  "START_TIMEOUT",
  "FINISH_TIMEOUT",
  "PROTOCOL_ERROR",
]);

export const RealtimeAsrClientEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }).strict(),
  z.object({ type: z.literal("stop") }).strict(),
]);

export const RealtimeAsrServerEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), captureId: z.string() }).strict(),
  z.object({ type: z.literal("interim"), captureId: z.string(), text: z.string() }).strict(),
  z.object({
    type: z.literal("final"),
    captureId: z.string(),
    segmentId: z.string(),
    ordinal: z.number().int().positive(),
    text: z.string(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  }).strict(),
  z.object({ type: z.literal("stopping"), captureId: z.string() }).strict(),
  z.object({ type: z.literal("completed"), captureId: z.string() }).strict(),
  z.object({
    type: z.literal("error"),
    captureId: z.string().nullable(),
    reason: RealtimeAsrStreamError,
  }).strict(),
]);

export const REALTIME_ASR_AUDIO_FORMAT = {
  sampleRate: 16_000,
  channels: 1,
  encoding: "pcm16le",
  littleEndian: true,
} as const;

export const operations = {
  createPersonalTranscription: {
    method: "POST",
    path: "/recording/realtime-asr/sessions",
    in: z.object({ name: Name, tags: Tags }).strict(),
    out: PersonalTranscriptionSummary,
    err: ["AUTH_REQUIRED", "ORG_MEMBERSHIP_REQUIRED", "VALIDATION_FAILED"] as const,
  },
  listPersonalTranscriptions: {
    method: "GET",
    path: "/recording/realtime-asr/sessions",
    in: z.object({
      query: z.string().max(100).optional(),
      tag: Tag.optional(),
      sort: z.enum(["recent", "oldest"]).optional(),
      cursor: z.string().optional(),
    }).strict(),
    out: z.object({
      items: z.array(PersonalTranscriptionSummary),
      nextCursor: z.string().nullable(),
    }).strict(),
    err: ["AUTH_REQUIRED", "ORG_MEMBERSHIP_REQUIRED", "VALIDATION_FAILED"] as const,
  },
  readPersonalTranscription: {
    method: "GET",
    path: "/recording/realtime-asr/sessions/:sessionId",
    in: z.object({ sessionId: z.string().min(1) }).strict(),
    out: PersonalTranscriptionDetail,
    err: ["AUTH_REQUIRED", "ORG_MEMBERSHIP_REQUIRED", "TRANSCRIPTION_NOT_FOUND"] as const,
  },
  issueRealtimeAsrTicket: {
    method: "POST",
    path: "/recording/realtime-asr/sessions/:sessionId/tickets",
    in: z.object({ sessionId: z.string().min(1) }).strict(),
    out: z.object({
      captureId: z.string(),
      ticket: z.string(),
      expiresAt: z.string(),
      websocketPath: z.string(),
    }).strict(),
    err: [
      "AUTH_REQUIRED",
      "ORG_MEMBERSHIP_REQUIRED",
      "TRANSCRIPTION_NOT_FOUND",
      "CAPTURE_ALREADY_ACTIVE",
      "QUOTA_EXCEEDED",
      "ASR_NOT_CONFIGURED",
    ] as const,
  },
} as const;

export const streamOperation = {
  path: "/recording/realtime-asr/sessions/:sessionId/captures/:captureId/stream",
  ticketQueryParameter: "ticket",
  audio: REALTIME_ASR_AUDIO_FORMAT,
  client: RealtimeAsrClientEvent,
  server: RealtimeAsrServerEvent,
  err: RealtimeAsrStreamError,
} as const;

export type Operations = typeof operations;
