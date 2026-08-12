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

export async function listPersonalTranscriptions(
  input: ListPersonalTranscriptionsInput = {},
  sessionToken?: string | null,
) {
  const raw = await apiRequest<unknown>(operations.listPersonalTranscriptions.path, {
    method: operations.listPersonalTranscriptions.method,
    query: input,
    sessionToken,
  });
  return operations.listPersonalTranscriptions.out.parse(raw);
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
  return operations.createPersonalTranscription.out.parse(raw);
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
  return operations.readPersonalTranscription.out.parse(raw);
}
