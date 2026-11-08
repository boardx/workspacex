import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import * as C from "@repo/contracts/ai-catalog-admin";
import type { z } from "zod";
import type { DatabasePort } from "../ports/database.port";
import type { IdentityRepository } from "../identity/ports";
import type { PlatformOrganizationRepository } from "../system/platform-organization-ports";
import { PLATFORM_ORG_ID, isOrgId, toOrgId } from "../../domain/org-id";
import { assertPrincipal, type Principal } from "../../domain/principal";
import type { AiCatalogStorage, PublishedSkillSnapshot } from "./storage-port";
export const AI_CATALOG_ADMIN_SERVICE = Symbol("AI_CATALOG_ADMIN_SERVICE");
/** Authorization and catalog orchestration; SQL lives behind the named storage port. */
export class AiCatalogAdminService {
  constructor(
    private readonly storage: AiCatalogStorage,
    private readonly db: DatabasePort,
    private readonly identities: IdentityRepository,
    private readonly organizations: PlatformOrganizationRepository,
  ) {}
  async assertReviewTarget(orgId: string): Promise<void> {
    await this.transaction(orgId, async () => undefined);
  }
  private async transaction<T>(
    orgId: string,
    fn: (
      s: import("../../application/ports/database.port").TenantSession,
    ) => Promise<T>,
  ): Promise<T> {
    if (!isOrgId(orgId)) throw new NotFoundException();
    try {
      return await this.db.withTenant(toOrgId(orgId), async (session) => {
        if (!(await this.storage.catalogTargetExists(session, orgId)))
          throw new NotFoundException();
        return fn(session);
      });
    } catch (error) {
      const candidate = error as { message?: string; code?: string };
      const code = C.ErrorCode.safeParse(candidate.message);
      if (code.success) {
        if (code.data.includes("NOT_FOUND"))
          throw new NotFoundException({ reasonCode: code.data });
        throw new ConflictException({ reasonCode: code.data });
      }
      if (candidate.code === "23505")
        throw new ConflictException({ reasonCode: "CATALOG_NAME_CONFLICT" });
      if (candidate.code === "P0001")
        throw new ConflictException({ reasonCode: "CATALOG_PUBLISH_REJECTED" });
      throw error;
    }
  }
  private async orgMember(p: Principal, orgId: string, write = false) {
    assertPrincipal(p);
    if (p.orgId !== orgId) throw new NotFoundException();
    const m = await this.identities.findOrgMembership(p.userId, toOrgId(orgId));
    if (!m) throw new NotFoundException();
    if (write && m.orgRole !== "admin") throw new ForbiddenException();
  }
  async list(p: Principal, raw: Record<string, unknown>) {
    assertPrincipal(p);
    const q = C.List.parse({
      ...raw,
      limit: raw.limit ? Number(raw.limit) : 50,
    });
    let state: { orgCursor?: string; offset: number; publicDone?: boolean } = {
      offset: 0,
    };
    if (q.cursor) {
      try {
        state = JSON.parse(Buffer.from(q.cursor, "base64url").toString("utf8"));
        if (!Number.isSafeInteger(state.offset) || state.offset < 0)
          throw new Error();
      } catch {
        throw new ConflictException("INVALID_CURSOR");
      }
    }
    const publicPage = !q.orgId && !state.publicDone;
    const page =
      q.orgId || publicPage
        ? null
        : await this.organizations.list(
            { search: "", cursor: state.orgCursor, limit: 1 },
            p.userId,
          );
    const orgId =
      q.orgId ?? (publicPage ? PLATFORM_ORG_ID : page?.organizations[0]?.orgId);
    if (!orgId) return C.Page.parse({ entries: [], nextCursor: null });
    const rows = await this.transaction(orgId, (s) =>
      this.storage.catalogEntries(s, orgId, q.kind, q.limit + 1, state.offset),
    );
    const next =
      rows.length > q.limit
        ? { ...state, offset: state.offset + q.limit }
        : publicPage
          ? { publicDone: true, offset: 0 }
          : page?.nextCursor
            ? { publicDone: true, orgCursor: page.nextCursor, offset: 0 }
            : null;
    return C.Page.parse({
      entries: rows.slice(0, q.limit),
      nextCursor: next
        ? Buffer.from(JSON.stringify(next)).toString("base64url")
        : null,
    });
  }
  async detail(
    orgId: string,
    raw: string,
    id: string,
    query: z.infer<typeof C.operations.detail.in> = {},
  ) {
    const rows = await this.transaction(orgId, (s) =>
      this.storage.catalogEntries(
        s,
        orgId,
        C.Kind.parse(raw),
        1,
        0,
        id,
        query.entityType ?? C.Kind.parse(raw),
      ),
    );
    const row = rows.find((r) => r.id === id);
    if (!row) throw new NotFoundException();
    const definition = await this.transaction(orgId, (s) =>
      this.storage.catalogDefinition(s, orgId, row),
    );
    return C.Detail.parse({ entry: row, definition });
  }
  async create(p: Principal, orgId: string, body: z.infer<typeof C.Write>) {
    return this.transaction(orgId, async (s) => {
      const out = await this.storage.catalogWrite(s, orgId, p.userId, body);
      await this.storage.catalogAudit(
        s,
        orgId,
        p.userId,
        "create",
        body.kind,
        out.id,
      );
      if (orgId === PLATFORM_ORG_ID)
        await this.storage.catalogMarkManaged(s, body.kind, out.id);
      return (
        await this.storage.catalogEntries(
          s,
          orgId,
          body.kind,
          1,
          0,
          out.id,
          body.kind,
        )
      ).find((r) => r.id === out.id);
    });
  }
  async update(
    p: Principal,
    orgId: string,
    kind: string,
    id: string,
    body: z.infer<typeof C.Write>,
  ) {
    if (body.kind !== kind) throw new NotFoundException();
    return this.transaction(orgId, async (s) => {
      await this.storage.catalogWrite(s, orgId, p.userId, body, id);
      await this.storage.catalogAudit(
        s,
        orgId,
        p.userId,
        "update",
        body.kind,
        id,
      );
      return (
        await this.storage.catalogEntries(
          s,
          orgId,
          body.kind,
          1,
          0,
          id,
          body.kind,
        )
      ).find((r) => r.id === id);
    });
  }
  async publish(p: Principal, orgId: string, raw: string, id: string) {
    const kind = C.Kind.parse(raw);
    return this.transaction(orgId, async (s) => {
      const out = await this.storage.catalogPublish(
        s,
        orgId,
        p.userId,
        kind,
        id,
      );
      await this.storage.catalogAudit(s, orgId, p.userId, "publish", kind, id);
      if (orgId === PLATFORM_ORG_ID)
        await this.storage.catalogMarkPublished(
          s,
          kind,
          id,
          out.versionId,
          p.userId,
        );
      return (
        await this.storage.catalogEntries(s, orgId, kind, 1, 0, id, kind)
      ).find((r) => r.id === id);
    });
  }
  async disable(p: Principal, orgId: string, raw: string, id: string) {
    const kind = C.Kind.parse(raw);
    return this.transaction(orgId, async (s) => {
      await this.storage.catalogDisable(s, orgId, kind, id);
      await this.storage.catalogAudit(s, orgId, p.userId, "disable", kind, id);
      return (
        await this.storage.catalogEntries(s, orgId, kind, 1, 0, id, kind)
      ).find((r) => r.id === id);
    });
  }
  async publicList(p: Principal, orgId: string, raw: Record<string, unknown>) {
    await this.orgMember(p, orgId);
    const q = C.List.omit({ orgId: true }).parse({
      ...raw,
      limit: raw.limit ? Number(raw.limit) : 50,
    });
    const offset = q.cursor ? Number(q.cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new ConflictException("INVALID_CURSOR");
    const result = await this.db.withTenant(
      toOrgId(PLATFORM_ORG_ID),
      async (s) => {
        const pub = await this.storage.catalogPublications(
          s,
          q.kind,
          q.limit + 1,
          offset,
        );
        const rows = [];
        for (const p of pub.slice(0, q.limit)) {
          if(q.kind==='skill'){
            const snapshot=await this.storage.readPublishedCatalogSkill(s,p.entity_id,p.version_id);
            if(snapshot)rows.push(C.Entry.parse({orgId:PLATFORM_ORG_ID,id:snapshot.id,kind:'skill',entityType:'skill',name:snapshot.name,description:typeof (snapshot.manifest as {description?:unknown})?.description==='string'?(snapshot.manifest as {description:string}).description:'',avatarUrl:null,versionId:snapshot.versionId,scope:'public',published:true,enabled:true}));
            continue;
          }
          const row = (
            await this.storage.catalogEntries(
              s,
              PLATFORM_ORG_ID,
              q.kind,
              1,
              0,
              p.entity_id,
            )
          )[0];
          if (
            row &&
            row.enabled &&
            row.published &&
            row.versionId === p.version_id
          )
            rows.push(row);
        }
        return { entries: rows, hasMore: pub.length > q.limit };
      },
    );
    const entries = result.entries;
    const enabled = await this.transaction(orgId, (s) =>
      this.storage.catalogEnabledOrigins(s, orgId, q.kind),
    );
    return C.Page.parse({
      entries: entries.map((r) => ({
        ...r,
        enabled: enabled.some(
          (e) => e.origin_id === r.id && e.origin_version_id === r.versionId,
        ),
      })),
      nextCursor: result.hasMore ? String(offset + q.limit) : null,
    });
  }
  async enable(p: Principal, orgId: string, body: z.infer<typeof C.Enable>) {
    await this.orgMember(p, orgId, true);
    const replay = await this.transaction(orgId, (s) =>
      this.storage.catalogIdempotency(s, orgId, body.idempotencyKey),
    );
    if (replay) {
      if (
        replay.kind !== body.kind ||
        replay.origin_id !== body.id ||
        replay.origin_version_id !== body.versionId
      )
        throw new ConflictException();
      return C.EnableResult.parse({
        kind: body.kind,
        id: replay.local_id,
        versionId: replay.local_version_id,
        originId: replay.origin_id,
        originVersionId: replay.origin_version_id,
      });
    }
    const source = await this.db.withTenant(
      toOrgId(PLATFORM_ORG_ID),
      async (s) => {
        if (
          !(await this.storage.catalogPublicationExists(
            s,
            body.kind,
            body.id,
            body.versionId,
          ))
        )
          throw new NotFoundException();
        return body.kind === "agent"
          ? this.storage.readPublishedCatalogAgent(s, body.id, body.versionId)
          : this.storage.readPublishedCatalogSkill(s, body.id, body.versionId);
      },
    );
    if (!source) throw new NotFoundException();
    return this.transaction(orgId, async (s) => {
      await this.storage.catalogLockOrganization(s, orgId);
      const old = await this.storage.catalogFindEnablement(
        s,
        orgId,
        body.idempotencyKey,
        body.kind,
        body.id,
        body.versionId,
      );
      if (old) {
        if (
          old.kind !== body.kind ||
          old.origin_id !== body.id ||
          old.origin_version_id !== body.versionId
        )
          throw new ConflictException();
        return C.EnableResult.parse({
          kind: body.kind,
          id: old.local_id,
          versionId: old.local_version_id,
          originId: old.origin_id,
          originVersionId: old.origin_version_id,
        });
      }
      const local =
        body.kind === "agent"
          ? await this.storage.copyPublishedCatalogAgent(
              s,
              orgId,
              p.userId,
              source as Record<string, unknown>,
            )
          : await this.storage.copyPublishedCatalogSkill(
              s,
              orgId,
              p.userId,
              source as PublishedSkillSnapshot,
            );
      await this.storage.catalogRecordEnablement(
        s,
        orgId,
        body.kind,
        body.id,
        body.versionId,
        local.id,
        local.versionId,
        p.userId,
        body.idempotencyKey,
      );
      await this.storage.catalogAudit(
        s,
        orgId,
        p.userId,
        "enable",
        body.kind,
        local.id,
      );
      return C.EnableResult.parse({
        kind: body.kind,
        id: local.id,
        versionId: local.versionId,
        originId: body.id,
        originVersionId: body.versionId,
      });
    });
  }
}
