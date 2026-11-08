import * as C from "@repo/contracts/ai-catalog-admin";
import type { z } from "zod";
import { apiRequest } from "./api-client";
export type AiCatalogKind = z.infer<typeof C.Kind>;
export type AiCatalogEntry = z.infer<typeof C.Entry>;
export type AiCatalogPage = z.infer<typeof C.Page>;
export type AiCatalogWrite = z.infer<typeof C.Write>;
const orgPath = (path: string, orgId: string) =>
  path.replace(":orgId", encodeURIComponent(orgId));
export async function listPublicAiCatalog(
  orgId: string,
  kind: AiCatalogKind,
  cursor?: string,
): Promise<AiCatalogPage> {
  return C.Page.parse(
    await apiRequest<unknown>(orgPath(C.operations.listPublic.path, orgId), {
      query: { kind, ...(cursor ? { cursor } : {}) },
    }),
  );
}
export async function listPlatformAiCatalog(
  kind: AiCatalogKind,
  orgId?: string,
  cursor?: string,
): Promise<AiCatalogPage> {
  return C.Page.parse(
    await apiRequest<unknown>(C.operations.listPlatform.path, {
      query: {
        kind,
        ...(orgId ? { orgId } : {}),
        ...(cursor ? { cursor } : {}),
      },
    }),
  );
}
export async function enablePublicAiCatalog(
  orgId: string,
  entry: AiCatalogEntry,
  idempotencyKey: string,
) {
  const body = C.Enable.parse({
    kind: entry.kind,
    id: entry.id,
    versionId: entry.versionId,
    idempotencyKey,
  });
  return C.EnableResult.parse(
    await apiRequest<unknown>(orgPath(C.operations.enable.path, orgId), {
      method: "POST",
      body,
    }),
  );
}
export type AiCatalogDetail = z.infer<typeof C.Detail>;
const entityPath = (
  path: string,
  row: Pick<AiCatalogEntry, "orgId" | "kind" | "id">,
) =>
  orgPath(path, row.orgId)
    .replace(":kind", row.kind)
    .replace(":id", encodeURIComponent(row.id));
export async function getPlatformAiCatalogEntry(
  row: AiCatalogEntry,
): Promise<AiCatalogDetail> {
  const detail = C.Detail.parse(
    await apiRequest<unknown>(entityPath(C.operations.detail.path, row), {
      query: row.entityType ? { entityType: row.entityType } : {},
    }),
  );
  if (
    detail.entry.orgId !== row.orgId ||
    detail.entry.id !== row.id ||
    detail.entry.kind !== row.kind ||
    (row.entityType && detail.entry.entityType !== row.entityType)
  )
    throw new Error("catalog_detail_scope_mismatch");
  return detail;
}
export async function createPlatformAiCatalogEntry(
  orgId: string,
  definition: AiCatalogWrite,
): Promise<AiCatalogEntry> {
  return C.Entry.parse(
    await apiRequest<unknown>(orgPath(C.operations.create.path, orgId), {
      method: "POST",
      body: C.Write.parse(definition),
    }),
  );
}
export async function updatePlatformAiCatalogEntry(
  row: AiCatalogEntry,
  definition: AiCatalogWrite,
): Promise<AiCatalogEntry> {
  return C.Entry.parse(
    await apiRequest<unknown>(entityPath(C.operations.update.path, row), {
      method: "PATCH",
      body: C.Write.parse(definition),
    }),
  );
}
export async function setPlatformAiCatalogState(
  row: AiCatalogEntry,
  action: "publish" | "disable",
): Promise<AiCatalogEntry> {
  return C.Entry.parse(
    await apiRequest<unknown>(entityPath(C.operations[action].path, row), {
      method: "POST",
      body: {},
    }),
  );
}
export async function scanPlatformLegacySkill(
  orgId: string,
  versionId: string,
) {
  const operation = C.legacySkillOperations.scan;
  return operation.out.parse(
    await apiRequest<unknown>(
      orgPath(operation.path, orgId).replace(
        ":versionId",
        encodeURIComponent(versionId),
      ),
      { method: "POST", body: operation.in.parse({ versionId }) },
    ),
  );
}
export async function submitPlatformLegacySkill(
  orgId: string,
  versionId: string,
  expectedVersion: string,
) {
  const operation = C.legacySkillOperations.submit;
  return operation.out.parse(
    await apiRequest<unknown>(
      orgPath(operation.path, orgId).replace(
        ":versionId",
        encodeURIComponent(versionId),
      ),
      {
        method: "POST",
        body: operation.in.parse({ versionId, expectedVersion }),
      },
    ),
  );
}
export async function reviewPlatformLegacySkill(
  orgId: string,
  input: z.infer<typeof C.legacySkillOperations.review.in>,
) {
  const operation = C.legacySkillOperations.review;
  return operation.out.parse(
    await apiRequest<unknown>(
      orgPath(operation.path, orgId).replace(
        ":versionId",
        encodeURIComponent(input.versionId),
      ),
      { method: "POST", body: operation.in.parse(input) },
    ),
  );
}
