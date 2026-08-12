import { personalRealtimeTranscription } from "@repo/contracts";
import { z } from "zod";
import { apiRequest } from "@/lib/api-client";

const { operations } = personalRealtimeTranscription;

export type PersonalTranscriptionSummary = z.infer<
  typeof personalRealtimeTranscription.PersonalTranscriptionSummary
>;
export type PersonalTranscriptionDetail = z.infer<
  typeof personalRealtimeTranscription.PersonalTranscriptionDetail
>;
export type ListPersonalTranscriptionsInput = z.infer<
  typeof operations.listPersonalTranscriptions.in
>;
export type CreatePersonalTranscriptionInput = z.infer<
  typeof operations.createPersonalTranscription.in
>;

const LegacyStatus = z.enum(["idle", "recording", "completed", "failed"]);
const LegacySummary = z.object({
  sessionId: z.string(), name: z.string(), tags: z.array(z.string()), status: LegacyStatus,
  durationMs: z.number(), createdAt: z.string(), updatedAt: z.string(),
}).passthrough();
const LegacySegment = z.object({ ordinal: z.number(), text: z.string() }).passthrough();
const LegacyCapture = z.object({ startedAt: z.string(), segments: z.array(LegacySegment) }).passthrough();
const LegacyDetail = LegacySummary.extend({ captures: z.array(LegacyCapture) }).passthrough();
const RollingDetail = LegacySummary.extend({ content: z.string() }).passthrough();

function resumableStatus(status: z.infer<typeof LegacyStatus>): "idle" | "recording" | "failed" {
  return status === "completed" ? "idle" : status;
}

function parseSummary(raw: unknown): PersonalTranscriptionSummary {
  const legacy = LegacySummary.parse(raw);
  return personalRealtimeTranscription.PersonalTranscriptionSummary.parse({
    sessionId: legacy.sessionId,
    name: legacy.name,
    tags: legacy.tags,
    status: resumableStatus(legacy.status),
    durationMs: legacy.durationMs,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  });
}

function parseDetail(raw: unknown): PersonalTranscriptionDetail {
  const current = personalRealtimeTranscription.PersonalTranscriptionDetail.safeParse(raw);
  if (current.success) return current.data;
  const rolling = RollingDetail.safeParse(raw);
  if (rolling.success) {
    return personalRealtimeTranscription.PersonalTranscriptionDetail.parse({
      sessionId: rolling.data.sessionId,
      name: rolling.data.name,
      tags: rolling.data.tags,
      status: resumableStatus(rolling.data.status),
      durationMs: rolling.data.durationMs,
      createdAt: rolling.data.createdAt,
      updatedAt: rolling.data.updatedAt,
      content: rolling.data.content,
    });
  }
  const legacy = LegacyDetail.parse(raw);
  const content = legacy.captures
    .flatMap((capture) => capture.segments
      .map((segment) => ({ ...segment, startedAt: capture.startedAt })))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.ordinal - right.ordinal)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
  return personalRealtimeTranscription.PersonalTranscriptionDetail.parse({
    sessionId: legacy.sessionId,
    name: legacy.name,
    tags: legacy.tags,
    status: resumableStatus(legacy.status),
    durationMs: legacy.durationMs,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
    content,
  });
}

export async function listPersonalTranscriptions(
  input: ListPersonalTranscriptionsInput = {},
  sessionToken?: string | null,
) {
  const raw = await apiRequest<unknown>(operations.listPersonalTranscriptions.path, {
    method: operations.listPersonalTranscriptions.method,
    query: input,
    sessionToken,
  });
  const page = z.object({ items: z.array(z.unknown()), nextCursor: z.string().nullable() }).strict().parse(raw);
  return { ...page, items: page.items.map(parseSummary) };
}

export async function createPersonalTranscription(
  input: CreatePersonalTranscriptionInput,
  sessionToken?: string | null,
): Promise<PersonalTranscriptionSummary> {
  const body = operations.createPersonalTranscription.in.parse(input);
  const raw = await apiRequest<unknown>(operations.createPersonalTranscription.path, {
    method: operations.createPersonalTranscription.method,
    body,
    sessionToken,
  });
  return parseSummary(raw);
}

export async function readPersonalTranscription(
  sessionId: string,
  sessionToken?: string | null,
): Promise<PersonalTranscriptionDetail> {
  const input = operations.readPersonalTranscription.in.parse({ sessionId });
  const path = operations.readPersonalTranscription.path.replace(":sessionId", encodeURIComponent(input.sessionId));
  const raw = await apiRequest<unknown>(path, {
    method: operations.readPersonalTranscription.method,
    sessionToken,
  });
  return parseDetail(raw);
}

export async function updatePersonalTranscriptionContent(
  sessionId: string,
  content: string,
  sessionToken?: string | null,
): Promise<PersonalTranscriptionDetail> {
  const input = operations.updatePersonalTranscriptionContent.in.parse({ sessionId, content });
  const path = operations.updatePersonalTranscriptionContent.path.replace(":sessionId", encodeURIComponent(input.sessionId));
  const raw = await apiRequest<unknown>(path, {
    method: operations.updatePersonalTranscriptionContent.method,
    body: { content: input.content },
    sessionToken,
  });
  return parseDetail(raw);
}
