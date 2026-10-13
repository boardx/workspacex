import { createHash, randomBytes, randomUUID } from "node:crypto";
import { stripControlMarkersForDisplay } from "@repo/contracts/chat-control-markers";
import { chatShare as C } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import { decideSharedSnapshot } from "../../domain/chat/share-access";
import { declaredMimeMatchesBytes } from "../../domain/chat/attachment-mime-sniff";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { getAttachmentContent, type GetAttachmentContentDeps } from "./get-attachment-content";
import { ThreadNotVisibleError } from "./get-thread";
import { resolveVisibility } from "./resolve-visibility";
import type { ChatMessageCommandRepository } from "./message-command-ports";
import type { ChatShareRepository } from "./share-ports";

export const CHAT_SHARE_SERVICE = Symbol("ChatShareService");
export class ShareChangedError extends Error {}
export class ShareTooLargeError extends Error {}
export class ShareEmptyError extends Error {}
export class ShareUnavailableError extends Error {}
export type ShareActor = { orgId: OrgId; userId: string; threadId: string };
export type ShareDeps = GetAttachmentContentDeps & { shares: ChatShareRepository; commands: ChatMessageCommandRepository };
export const shareHash = (value: string) => createHash("sha256").update(value).digest("hex");

export class ChatShareService {
  constructor(private readonly deps: ShareDeps) {}
  private async owner(input: ShareActor) {
    const facts = await this.deps.chat.findThreadFacts(input.orgId, input.threadId);
    if (!facts) throw new ThreadNotVisibleError();
    const outcome = await resolveVisibility(this.deps, { ...input, projectId: facts.projectId });
    // Being able to read a colleague's thread does not confer publication rights.
    if (outcome.kind !== "allow" || facts.createdBy !== input.userId || outcome.actor.projectRole === "observer") throw new ThreadNotVisibleError();
    const org = await this.deps.repo.findOrganization(input.orgId);
    if (!org || org.kind === "personal-local") throw new ThreadNotVisibleError();
    return outcome;
  }
  async preview(input: ShareActor): Promise<C.PreviewValue> {
    const outcome = await this.owner(input);
    const guarded = await this.deps.chat.findMessages(input.orgId, input.threadId);
    if (!guarded) throw new ThreadNotVisibleError();
    const disclosed = discloseDecided(guarded, outcome.base);
    if (!isDisclosed(disclosed)) throw new ThreadNotVisibleError();
    // Do not export raw transcripts or pending-review messages into an anonymous surface.
    const rows = disclosed.payload.filter(m => !m.rawTranscript && !m.reviewPending);
    if (!rows.length) throw new ShareEmptyError();
    if (rows.length > C.SHARE_LIMITS.messages) throw new ShareTooLargeError();
    const meta = await this.deps.chat.findThreadPresentation(input.orgId, input.threadId);
    if (!meta) throw new ThreadNotVisibleError();
    const attachments = await this.deps.commands.attachmentsByMessage(input.orgId, rows.map(m => m.id));
    const messages: C.SnapshotValue["messages"] = [];
    let total = 0;
    for (const row of rows) {
      const exported: C.SnapshotValue["messages"][number]["attachments"] = [];
      for (const a of attachments.get(row.id) ?? []) {
        const attachment: C.SnapshotValue["messages"][number]["attachments"][number] = {
          filename: a.filename, mime: a.mime, bytes: a.bytes,
        };
        if (C.ImageMime.safeParse(a.mime).success) {
          if (a.bytes > C.SHARE_LIMITS.imageBytes) throw new ShareTooLargeError();
          const content = await getAttachmentContent(this.deps, { ...input, attachmentId: a.id });
          if (content.bytes.length > C.SHARE_LIMITS.imageBytes) throw new ShareTooLargeError();
          if (!declaredMimeMatchesBytes(a.mime, content.bytes)) throw new ShareUnavailableError();
          attachment.imageData = `data:${a.mime};base64,${Buffer.from(content.bytes).toString("base64")}`;
        }
        exported.push(attachment);
      }
      // Persisted body is the final conversation, not the internal tool/run ledger.
      const message = { authorKind: row.authorKind, text: stripControlMarkersForDisplay(row.body), createdAt: row.createdAt, attachments: exported };
      total += Buffer.byteLength(JSON.stringify(message));
      if (total > C.SHARE_LIMITS.snapshotBytes) throw new ShareTooLargeError();
      messages.push(message);
    }
    const snapshot = C.Snapshot.parse({ title: meta.title || "分享的对话", messages });
    if (Buffer.byteLength(JSON.stringify(snapshot)) > C.SHARE_LIMITS.snapshotBytes) throw new ShareTooLargeError();
    return { snapshot, revision: shareHash(JSON.stringify(snapshot)) };
  }
  async create(input: ShareActor, revision: string) {
    const preview = await this.preview(input);
    // Never publish messages that appeared after the user reviewed the preview.
    if (preview.revision !== revision) throw new ShareChangedError();
    const token = randomBytes(32).toString("base64url");
    const share = await this.deps.shares.insert(input.orgId, {
      id: randomUUID(), threadId: input.threadId, createdBy: input.userId,
      tokenHash: shareHash(token), snapshot: preview.snapshot,
    });
    return { share, token };
  }
  async list(input: ShareActor) {
    await this.owner(input);
    return { shares: await this.deps.shares.list(input.orgId, input.threadId, input.userId) };
  }
  async revoke(input: ShareActor, shareId: string) {
    await this.owner(input);
    if (!await this.deps.shares.revoke(input.orgId, input.threadId, input.userId, shareId)) throw new ThreadNotVisibleError();
  }
  async read(token: string) {
    if (!C.Token.safeParse(token).success) throw new ThreadNotVisibleError();
    const tokenHash = shareHash(token);
    const found = await this.deps.shares.findByTokenHash(tokenHash);
    if (!found) throw new ThreadNotVisibleError();
    const disclosed = discloseDecided(found.snapshot, decideSharedSnapshot({
      tokenMatches: found.tokenHash === tokenHash, revoked: found.revokedAt !== null, decisionId: randomUUID(),
    }));
    if (!isDisclosed(disclosed)) throw new ThreadNotVisibleError();
    return { snapshot: disclosed.payload, createdAt: found.createdAt };
  }
}
