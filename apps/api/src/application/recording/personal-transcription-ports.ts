import { personalRealtimeTranscription as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";

export type PersonalTranscriptionSummary = z.infer<typeof C.PersonalTranscriptionSummary>;
export type PersonalTranscriptionDetail = z.infer<typeof C.PersonalTranscriptionDetail>;

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

  readOwned(input: {
    readonly orgId: OrgId;
    readonly ownerUserId: string;
    readonly transcriptionId: string;
  }): Promise<PersonalTranscriptionDetail | undefined>;
}

export const PERSONAL_TRANSCRIPTION_REPOSITORY = Symbol("PersonalTranscriptionRepository");

