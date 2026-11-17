import * as designPrototype from "@repo/contracts/design-prototype";
import * as designWorkbench from "@repo/contracts/design-workbench";
import * as project from "@repo/contracts/project";
import { apiRequest } from "@/lib/api-client";
import type { DesignProject, PrototypeVersionSummary } from "@/lib/live-design-workbench";
import { isAidtModuleEnabled } from "./aidt-module-config";

export type AidtPrototypeReadContext = {
  projectId: string;
  userId: string;
  sessionToken: string;
  signal?: AbortSignal;
};
export type AidtPrototypeDesign = Pick<DesignProject, "id" | "name" | "ownerId">;
/** A student-selected reference, not a test result, authorization grant or quality verdict. */
export type AidtPrototypeVersionReference = {
  designId: string;
  versionId: string;
  designName: string;
  seq: PrototypeVersionSummary["seq"];
  summary: PrototypeVersionSummary["summary"];
  createdAt: PrototypeVersionSummary["createdAt"];
  frameCount: number;
  generatedFrameCount: number;
  source: PrototypeVersionSummary["source"];
};
export type AidtPrototypeDesignList = { items: readonly AidtPrototypeDesign[]; unavailableCount: number };
const validId = (id: string) => !!id.trim() && id !== "." && id !== ".." && !/[\u0000-\u001f\u007f]/.test(id);
// Existing native service emits links (prototype-versions.ts summaryView); validate that
// known field using its existing canonical node schema and reject every other extra field.
const nativeLinks = designPrototype.PrototypeLink.array().array().optional();
const nativeSummary = designWorkbench.PrototypeVersionSummary.extend({ links: nativeLinks }).strict();
const nativeVersion = designWorkbench.PrototypeVersion.extend({ links: nativeLinks }).strict();
function current(context: AidtPrototypeReadContext) {
  if (!isAidtModuleEnabled() || context.signal?.aborted) throw new Error("AIDT_CONTEXT_CHANGED");
  if (![context.projectId, context.userId].every(validId) || !context.sessionToken) throw new Error("AIDT_PROTOTYPE_UNAVAILABLE");
}
function read(context: AidtPrototypeReadContext, template: string, designId?: string, versionId?: string) {
  current(context);
  const path = template.replace(":projectId", encodeURIComponent(designId ?? context.projectId))
    .replace(":versionId", encodeURIComponent(versionId ?? ""));
  return apiRequest<unknown>(path, { method: "GET", sessionToken: context.sessionToken, signal: context.signal });
}

/** Reuses existing contracts/routes, with an explicit bearer and cancellation per teaching actor. */
export async function loadAidtPrototypeDesigns(context: AidtPrototypeReadContext): Promise<AidtPrototypeDesignList> {
  current(context);
  const resources = project.operations.listProjectResources.out.parse(await read(context, project.operations.listProjectResources.path));
  current(context);
  const linked = resources.items.filter((item) => item.kind === "design" && validId(item.id));
  if (!linked.length) return { items: [], unavailableCount: 0 };
  const owned = designWorkbench.operations.listMyProjects.out.parse(await read(context, designWorkbench.operations.listMyProjects.path));
  current(context);
  const byId = new Map(owned.items.filter((item) => item.ownerId === context.userId && validId(item.id)).map((item) => [item.id, item]));
  const seen = new Set<string>();
  const items = linked.flatMap((resource) => {
    const design = byId.get(resource.id);
    if (!design || resource.ownerUserId !== context.userId || seen.has(design.id)) return [];
    seen.add(design.id);
    return [{ id: design.id, name: design.name, ownerId: design.ownerId }];
  });
  return { items, unavailableCount: new Set(linked.map((item) => item.id)).size - items.length };
}

async function requireLinkedOwnedDesign(context: AidtPrototypeReadContext, designId: string) {
  if (!validId(designId)) throw new Error("AIDT_PROTOTYPE_UNAVAILABLE");
  const listed = await loadAidtPrototypeDesigns(context);
  const design = listed.items.find((item) => item.id === designId);
  if (!design) throw new Error("AIDT_PROTOTYPE_UNAVAILABLE");
  return design;
}

/** No guessed current-version ID: only persisted version rows from the native version endpoint. */
export async function loadAidtPrototypeVersions(context: AidtPrototypeReadContext, designId: string): Promise<readonly PrototypeVersionSummary[]> {
  await requireLinkedOwnedDesign(context, designId);
  const raw = await read(context, designWorkbench.operations.listPrototypeVersions.path, designId);
  current(context);
  // The native service additionally projects `links`; consume only canonical summary fields.
  const result = designWorkbench.operations.listPrototypeVersions.out.extend({ items: nativeSummary.array() }).parse(raw);
  const ids = new Set<string>();
  const seqs = new Set<number>();
  for (const version of result.items) {
    if (!validId(version.id) || ids.has(version.id) || seqs.has(version.seq)) throw new Error("AIDT_PROTOTYPE_INVALID_VERSION");
    ids.add(version.id); seqs.add(version.seq);
  }
  return result.items;
}

/** Revalidate association, ownership and actual immutable snapshot at the explicit selection. */
export async function resolveAidtPrototypeVersion(context: AidtPrototypeReadContext, designId: string, versionId: string): Promise<AidtPrototypeVersionReference> {
  if (!validId(versionId)) throw new Error("AIDT_PROTOTYPE_UNAVAILABLE");
  const design = await requireLinkedOwnedDesign(context, designId);
  const raw = await read(context, designWorkbench.operations.getPrototypeVersion.path, designId, versionId);
  current(context);
  const { version } = designWorkbench.operations.getPrototypeVersion.out.extend({ version: nativeVersion }).parse(raw);
  if (version.id !== versionId || !version.frames.length || version.prototype.length !== version.frames.length || !version.prototype.some(Boolean)) throw new Error("AIDT_PROTOTYPE_INVALID_VERSION");
  return { designId, versionId: version.id, designName: design.name, seq: version.seq, summary: version.summary, createdAt: version.createdAt, frameCount: version.frames.length, generatedFrameCount: version.prototype.filter(Boolean).length, source: version.source };
}

/** Compatibility export; keep the sole implementation on the pure formatting path. */
export { aidtPrototypeVersionLabel } from "./aidt-prototype-label";
