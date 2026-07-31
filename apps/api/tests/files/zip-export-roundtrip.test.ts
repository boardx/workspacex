/**
 * F33 -- V4: zip 内部目录结构 ≡ 树结构（`getArtifactTree`/`buildArtifactTree`'s grouping:
 * level 1 = source type, level 2 = agenda_segment, un-segmented sentinel included).
 *
 * In-memory (see `tests/support/files-export-fakes.ts`'s header): the round-trip claim under
 * test is about `domain/files/export-manifest.ts`'s path derivation and
 * `infrastructure/files/zip-codec.ts`'s writer/reader being real inverses of each other, not
 * about which artifacts are visible (that is F31's `wsx_visible_artifacts()`, already asserted
 * elsewhere against real Postgres).
 */
import { describe, expect, it } from "vitest";
import { createExportJob } from "../../src/application/files/export-artifacts";
import type { ExportableRow } from "../../src/application/files/export-ports";
import { buildArtifactTree, UNSEGMENTED_LABEL, type TreeInputRow } from "../../src/domain/files/artifact-tree";
import { readZip, NodeZipBuilder } from "../../src/infrastructure/files/zip-codec";
import { FakeObjectStore, SequentialIdFactory } from "../support/artifact-fakes";
import { FakeDecisionIds, FakeProvenanceWriter, FakeRoleViewRepository } from "../support/role-view-fakes";
import {
  FakeExportContentRepository, FakeDownloadUrlBuilder, InMemoryExportJobRepository,
} from "../support/files-export-fakes";
import { toOrgId } from "../../src/domain/org-id";
import type { ExportDeps } from "../../src/application/files/export-artifacts";

const ORG = toOrgId("org-f33-roundtrip");
const PROJECT = "proj-f33-roundtrip";
const USER = "u-facilitator";

function row(overrides: Partial<ExportableRow> & { artifactId: string }): ExportableRow {
  return {
    name: `${overrides.artifactId}.txt`,
    sourceType: "upload",
    agendaSegmentId: null,
    confidential: false,
    versionNumber: 1,
    objectKey: `store/${overrides.artifactId}`,
    contentHash: "0".repeat(64),
    mime: "text/plain",
    ...overrides,
  };
}

async function runExport(rows: readonly ExportableRow[]): Promise<{
  entries: { path: string; content: Uint8Array }[];
  itemCount: number;
}> {
  const objectStore = new FakeObjectStore();
  for (const r of rows) {
    await objectStore.putOnce(r.objectKey, new TextEncoder().encode(`bytes for ${r.artifactId}`), r.mime);
  }
  const jobs = new InMemoryExportJobRepository();
  const deps: ExportDeps = {
    repo: new FakeRoleViewRepository({ [USER]: { orgRole: "consultant", projectRole: "facilitator" } }),
    ids: new FakeDecisionIds(),
    exportContent: new FakeExportContentRepository(rows),
    objectStore,
    jobs,
    urls: new FakeDownloadUrlBuilder(),
    provenance: new FakeProvenanceWriter(),
    idFactory: new SequentialIdFactory(),
    zip: new NodeZipBuilder(),
    now: () => new Date("2026-08-01T00:00:00Z"),
  };
  const created = await createExportJob(deps, {
    userId: USER, orgId: ORG, projectId: PROJECT, artifactIds: null, treeNodeId: null,
  });
  const zipKey = [...jobs.raw.values()][0]!.objectKey;
  const zipBytes = await objectStore.get(zipKey);
  return { entries: readZip(zipBytes!), itemCount: created.status === "done" ? rows.length : -1 };
}

describe("zip 目录结构 ≡ getArtifactTree 的两级分组", () => {
  it("every file's zip path starts with its (sourceType, segment) grouping, matching buildArtifactTree", async () => {
    const rows = [
      row({ artifactId: "r-1", sourceType: "interview", agendaSegmentId: "seg-a" }),
      row({ artifactId: "r-2", sourceType: "interview", agendaSegmentId: "seg-a" }),
      row({ artifactId: "r-3", sourceType: "interview", agendaSegmentId: "seg-b" }),
      row({ artifactId: "r-4", sourceType: "upload", agendaSegmentId: null }),
    ];
    const { entries } = await runExport(rows);

    // The independently-computed tree, from the SAME domain function the browser uses.
    const treeInput: TreeInputRow[] = rows.map((r) => ({ sourceType: r.sourceType, agendaSegmentId: r.agendaSegmentId }));
    const tree = buildArtifactTree(treeInput);
    const level1Keys = new Set(tree.filter((n) => n.level === 1).map((n) => n.key));
    expect(level1Keys).toEqual(new Set(["interview", "upload"]));

    for (const r of rows) {
      const found = entries.find((e) => e.content.byteLength > 0 && new TextDecoder().decode(e.content) === `bytes for ${r.artifactId}`);
      expect(found, `no zip entry contains ${r.artifactId}'s bytes`).toBeDefined();
      const segLabel = r.agendaSegmentId === null ? UNSEGMENTED_LABEL : r.agendaSegmentId;
      expect(found!.path.startsWith(`${r.sourceType}/${segLabel}/`), found!.path).toBe(true);
    }

    // The un-segmented node: r-4 must land under UNSEGMENTED_LABEL, not disappear and not be
    // silently merged into some other segment's folder (uc-22-1's "un-segmented must exist
    // and must not be hideable", carried over to the export side).
    const r4 = entries.find((e) => new TextDecoder().decode(e.content) === "bytes for r-4");
    expect(r4!.path).toBe(`upload/${UNSEGMENTED_LABEL}/r-4.txt`);
  });

  it("round trip: every row produces exactly one zip entry, no fewer, no more, no silent merge", async () => {
    const rows = [
      row({ artifactId: "u-1", sourceType: "interview", agendaSegmentId: "seg-x" }),
      row({ artifactId: "u-2", sourceType: "interview", agendaSegmentId: "seg-x" }),
      row({ artifactId: "u-3", sourceType: "interview", agendaSegmentId: "seg-x" }),
    ];
    const { entries, itemCount } = await runExport(rows);
    expect(itemCount).toBe(3);
    // manifest.json + 3 files, and no two files collapsed onto the same path.
    expect(entries.length).toBe(4);
    const filePaths = entries.filter((e) => e.path !== "manifest.json").map((e) => e.path);
    expect(new Set(filePaths).size).toBe(3);
  });

  it("two artifacts with the IDENTICAL name in the SAME (source, segment) get disambiguated, not overwritten", async () => {
    const rows = [
      row({ artifactId: "dup-a", name: "notes.txt", sourceType: "upload", agendaSegmentId: "seg-1" }),
      row({ artifactId: "dup-b", name: "notes.txt", sourceType: "upload", agendaSegmentId: "seg-1" }),
    ];
    const { entries, itemCount } = await runExport(rows);
    expect(itemCount).toBe(2);
    const filePaths = entries.filter((e) => e.path !== "manifest.json").map((e) => e.path);
    // Two DISTINCT paths -- if they collided, `entries.length` would be 2 (manifest + 1
    // survivor) instead of 3, and one artifact's bytes would have silently vanished from the
    // export while its manifest row still claimed it was there.
    expect(new Set(filePaths).size).toBe(2);
    expect(entries.length).toBe(3);
    for (const r of rows) {
      const found = entries.find((e) => new TextDecoder().decode(e.content) === `bytes for ${r.artifactId}`);
      expect(found, `${r.artifactId}'s bytes are missing from the zip`).toBeDefined();
    }
  });

  it("COUNTER-PROOF: the naive path builder (no un-segmented sentinel) would make r-4 indistinguishable from a failed upload", async () => {
    // Same property `artifact-tree.ts`'s own counter-proof asserts, carried to the export
    // side: grouping by `agendaSegmentId ?? UNSEGMENTED_KEY` keeps the row; a version that
    // just used the raw (possibly-null) value as a path segment either throws (can't join
    // `null` into a path) or silently drops the file into the project root, indistinguishable
    // from "this upload never made it into the export" if anyone were checking for that.
    const naive = (r: { sourceType: string; agendaSegmentId: string | null }): string =>
      `${r.sourceType}/${r.agendaSegmentId}`; // the version anybody would write first
    expect(naive({ sourceType: "upload", agendaSegmentId: null })).toBe("upload/null");
    expect(naive({ sourceType: "upload", agendaSegmentId: null })).not.toContain(UNSEGMENTED_LABEL);
  });
});
