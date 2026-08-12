import type { IdentityRepository } from "../identity/ports";
import type { IdGenerator } from "./ports";
import type { OrgId } from "../../domain/org-id";
import type { PersonalTranscriptionRepository } from "./personal-transcription-ports";
import { createHash, randomBytes } from "node:crypto";
import type { RealtimeAsrTicketStore } from "./personal-realtime-asr";

export class PersonalTranscriptionOrgMembershipRequired extends Error {}
export class PersonalTranscriptionNotFound extends Error {}

async function requireOrgMembership(
  identities: IdentityRepository,
  userId: string,
  orgId: OrgId,
): Promise<void> {
  if ((await identities.findOrgMembership(userId, orgId)) === null) {
    throw new PersonalTranscriptionOrgMembershipRequired();
  }
}

export async function createPersonalTranscription(
  deps: { readonly identities: IdentityRepository; readonly repository: PersonalTranscriptionRepository; readonly ids: IdGenerator },
  input: { readonly userId: string; readonly orgId: OrgId; readonly name: string; readonly tags: readonly string[] },
) {
  await requireOrgMembership(deps.identities, input.userId, input.orgId);
  return deps.repository.create({
    transcriptionId: deps.ids.next("personal-transcription"),
    orgId: input.orgId,
    ownerUserId: input.userId,
    name: input.name,
    tags: input.tags,
  });
}

export async function listPersonalTranscriptions(
  deps: { readonly identities: IdentityRepository; readonly repository: PersonalTranscriptionRepository },
  input: {
    readonly userId: string;
    readonly orgId: OrgId;
    readonly query?: string;
    readonly tag?: string;
    readonly sort?: "recent" | "oldest";
    readonly cursor?: string;
  },
) {
  await requireOrgMembership(deps.identities, input.userId, input.orgId);
  return deps.repository.listOwned({
    orgId: input.orgId,
    ownerUserId: input.userId,
    query: input.query,
    tag: input.tag,
    sort: input.sort ?? "recent",
    cursor: input.cursor,
  });
}

export async function readPersonalTranscription(
  deps: { readonly identities: IdentityRepository; readonly repository: PersonalTranscriptionRepository },
  input: { readonly userId: string; readonly orgId: OrgId; readonly transcriptionId: string },
) {
  await requireOrgMembership(deps.identities, input.userId, input.orgId);
  const found = await deps.repository.readOwned({
    orgId: input.orgId,
    ownerUserId: input.userId,
    transcriptionId: input.transcriptionId,
  });
  if (found === undefined) throw new PersonalTranscriptionNotFound();
  return found;
}

export async function updatePersonalTranscriptionContent(
  deps: { readonly identities: IdentityRepository; readonly repository: PersonalTranscriptionRepository },
  input: { readonly userId: string; readonly orgId: OrgId; readonly transcriptionId: string; readonly content: string },
) {
  await requireOrgMembership(deps.identities, input.userId, input.orgId);
  if (await deps.repository.hasActiveCapture({ orgId: input.orgId, ownerUserId: input.userId,
    transcriptionId: input.transcriptionId })) throw new RealtimeAsrCaptureAlreadyActive();
  const updated = await deps.repository.replaceContent({ orgId: input.orgId, ownerUserId: input.userId,
    transcriptionId: input.transcriptionId, content: input.content });
  if (!updated) {
    if (await deps.repository.hasActiveCapture({ orgId: input.orgId, ownerUserId: input.userId,
      transcriptionId: input.transcriptionId })) throw new RealtimeAsrCaptureAlreadyActive();
    throw new PersonalTranscriptionNotFound();
  }
  return updated;
}

export class RealtimeAsrNotConfigured extends Error {}
export class RealtimeAsrCaptureAlreadyActive extends Error {}
const REALTIME_ASR_TICKET_TTL_MS = 60_000; // [days-literal-ok:unit-conversion] 60-second one-use WebSocket ticket TTL.
export async function issueRealtimeAsrTicket(deps:{identities:IdentityRepository;repository:PersonalTranscriptionRepository;
  tickets:RealtimeAsrTicketStore;ids:IdGenerator;isConfigured:()=>boolean},input:{userId:string;orgId:OrgId;transcriptionId:string}){
  await requireOrgMembership(deps.identities,input.userId,input.orgId);
  if(!deps.isConfigured()) throw new RealtimeAsrNotConfigured();
  const owned=await deps.repository.readOwned({orgId:input.orgId,ownerUserId:input.userId,transcriptionId:input.transcriptionId});
  if(!owned) throw new PersonalTranscriptionNotFound();
  if(await deps.repository.hasActiveCapture({orgId:input.orgId,ownerUserId:input.userId,
    transcriptionId:input.transcriptionId})) throw new RealtimeAsrCaptureAlreadyActive();
  const captureId=deps.ids.next("personal-capture"),trackId=deps.ids.next("personal-track");
  await deps.repository.startCapture({orgId:input.orgId,ownerUserId:input.userId,transcriptionId:input.transcriptionId,captureId,trackId});
  const ticket=`${Buffer.from(String(input.orgId)).toString("base64url")}.${randomBytes(32).toString("base64url")}`;
  const ticketHash=createHash("sha256").update(ticket).digest("hex"),expiresAtMs=Date.now()+REALTIME_ASR_TICKET_TTL_MS;
  await deps.tickets.issue({ticket,ticketHash,orgId:input.orgId,ownerUserId:input.userId,transcriptionId:input.transcriptionId,captureId,expiresAtMs});
  return {captureId,ticket,expiresAt:new Date(expiresAtMs).toISOString(),
    websocketPath:`/recording/realtime-asr/sessions/${encodeURIComponent(input.transcriptionId)}/captures/${encodeURIComponent(captureId)}/stream`};
}
