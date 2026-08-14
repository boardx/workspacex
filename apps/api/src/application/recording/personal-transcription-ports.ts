import { personalRealtimeTranscription as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";

export type PersonalTranscriptionSummary = z.infer<typeof C.PersonalTranscriptionSummary>;
export type PersonalTranscriptionDetail = z.infer<typeof C.PersonalTranscriptionDetail>;
export type PersonalTranscriptionMutationResult<T = undefined> =
  | { readonly kind: "changed"; readonly value: T }
  | { readonly kind: "not_found" }
  | { readonly kind: "capture_active" };

export class PersonalTranscriptionCursorInvalid extends Error {
  constructor() {
    super("personal transcription cursor is invalid");
    this.name = "PersonalTranscriptionCursorInvalid";
  }
}

export interface PersonalTranscriptionRepository {
  create(input: {
    readonly transcriptionId: string;
    readonly orgId: OrgId;
    readonly ownerUserId: string;
    readonly name: string;
    readonly tags: readonly string[];
  }): Promise<PersonalTranscriptionSummary>;

  listOwned(input: {
    readonly orgId: OrgId;
    readonly ownerUserId: string;
    readonly query?: string;
    readonly tag?: string;
    readonly sort: "recent" | "oldest";
    readonly cursor?: string;
  }): Promise<{ readonly items: readonly PersonalTranscriptionSummary[]; readonly nextCursor: string | null }>;

  listOwnedTags(input: { readonly orgId: OrgId; readonly ownerUserId: string }): Promise<readonly string[]>;

  updateMetadataOwned(input: { readonly orgId: OrgId; readonly ownerUserId: string;
    readonly transcriptionId: string; readonly name: string; readonly tags: readonly string[]
  }): Promise<PersonalTranscriptionMutationResult<PersonalTranscriptionSummary>>;

  deleteOwned(input: { readonly orgId: OrgId; readonly ownerUserId: string;
    readonly transcriptionId: string }): Promise<PersonalTranscriptionMutationResult>;

  readOwned(input: {
    readonly orgId: OrgId;
    readonly ownerUserId: string;
    readonly transcriptionId: string;
  }): Promise<PersonalTranscriptionDetail | undefined>;

  hasActiveCapture(input: { readonly orgId: OrgId; readonly ownerUserId: string;
    readonly transcriptionId: string }): Promise<boolean>;
  replaceContent(input: { readonly orgId: OrgId; readonly ownerUserId: string;
    readonly transcriptionId: string; readonly content: string }): Promise<PersonalTranscriptionDetail | undefined>;

  startCapture(input: { readonly orgId: OrgId; readonly ownerUserId: string; readonly transcriptionId: string;
    readonly captureId: string; readonly trackId: string }): Promise<void>;
  appendFinal(input: { readonly orgId: OrgId; readonly ownerUserId: string; readonly transcriptionId: string;
    readonly captureId: string; readonly segmentId: string; readonly ordinal: number; readonly text: string;
    readonly startMs: number; readonly endMs: number }): Promise<void>;
  finishCapture(input: { readonly orgId: OrgId; readonly ownerUserId: string; readonly transcriptionId: string;
    readonly captureId: string; readonly durationMs: number; readonly failed?: boolean }): Promise<void>;
}

export const PERSONAL_TRANSCRIPTION_REPOSITORY = Symbol("PersonalTranscriptionRepository");
