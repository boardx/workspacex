/**
 * F364 -- the real `FilesExportController` must pass a caller's file selection through to
 * `createExportJob` instead of the pre-fix hardcoded `artifactIds: null` (which always exported
 * the whole project regardless of what the frontend's checkboxes collected).
 *
 * This instantiates `FilesExportController` directly with the same in-memory fakes the
 * application-level `zip-export-roundtrip.test.ts` uses (no Nest HTTP layer, no Postgres --
 * `FakeExportContentRepository` doesn't filter by selection itself, but it DOES record every
 * `selection` it was called with, which is exactly the property this feature adds: does the
 * controller's parsed body reach the application layer unmodified).
 */
import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { FilesExportController } from "../../src/interface/controllers/files-export.controller";
import { NodeZipBuilder } from "../../src/infrastructure/files/zip-codec";
import { FakeObjectStore, SequentialIdFactory } from "../support/artifact-fakes";
import { FakeDecisionIds, FakeProvenanceWriter, FakeRoleViewRepository } from "../support/role-view-fakes";
import {
  FakeExportContentRepository, FakeDownloadUrlBuilder, InMemoryExportJobRepository,
} from "../support/files-export-fakes";
import { toOrgId } from "../../src/domain/org-id";
import type { ExportableRow } from "../../src/application/files/export-ports";
import type { Principal } from "../../src/domain/principal";

const ORG = toOrgId("org-f364");
const PROJECT = "proj-f364";
const USER = "u-facilitator";
const PRINCIPAL: Principal = { userId: USER, orgId: ORG };

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

function buildController(rows: readonly ExportableRow[]) {
  const objectStore = new FakeObjectStore();
  const exportContent = new FakeExportContentRepository(rows);
  const jobs = new InMemoryExportJobRepository();
  const controller = new FilesExportController(
    exportContent,
    jobs,
    objectStore,
    new FakeDownloadUrlBuilder(),
    new FakeRoleViewRepository({ [USER]: { orgRole: "consultant", projectRole: "facilitator" } }),
    new FakeDecisionIds(),
    new SequentialIdFactory(),
    new FakeProvenanceWriter(),
    new NodeZipBuilder(),
  );
  return { controller, exportContent, objectStore, rows };
}

describe("FilesExportController#create wires the caller's selection through (F364)", () => {
  it("a partial selection reaches createExportJob's application layer as those exact artifactIds, not null", async () => {
    const rows = [row({ artifactId: "a-1" }), row({ artifactId: "a-2" }), row({ artifactId: "a-3" })];
    const objectStore = new FakeObjectStore();
    await Promise.all(rows.map((r) => objectStore.putOnce(r.objectKey, new TextEncoder().encode("x"), r.mime)));
    const exportContent = new FakeExportContentRepository(rows);
    const jobs = new InMemoryExportJobRepository();
    const controller = new FilesExportController(
      exportContent,
      jobs,
      objectStore,
      new FakeDownloadUrlBuilder(),
      new FakeRoleViewRepository({ [USER]: { orgRole: "consultant", projectRole: "facilitator" } }),
      new FakeDecisionIds(),
      new SequentialIdFactory(),
      new FakeProvenanceWriter(),
      new NodeZipBuilder(),
    );

    await controller.create(PRINCIPAL, PROJECT, {
      projectId: PROJECT,
      artifactIds: ["a-1", "a-2"],
      treeNodeId: null,
    });

    expect(exportContent.calls).toHaveLength(1);
    expect(exportContent.calls[0]!.selection).toEqual({ artifactIds: ["a-1", "a-2"], treeNodeId: null });
  });

  it("an empty/omitted selection (both null) is passed through as null -- 'export everything visible', not silently dropped or rejected", async () => {
    const rows = [row({ artifactId: "b-1" })];
    const objectStore = new FakeObjectStore();
    await objectStore.putOnce(rows[0]!.objectKey, new TextEncoder().encode("x"), rows[0]!.mime);
    const exportContent = new FakeExportContentRepository(rows);
    const jobs = new InMemoryExportJobRepository();
    const controller = new FilesExportController(
      exportContent,
      jobs,
      objectStore,
      new FakeDownloadUrlBuilder(),
      new FakeRoleViewRepository({ [USER]: { orgRole: "consultant", projectRole: "facilitator" } }),
      new FakeDecisionIds(),
      new SequentialIdFactory(),
      new FakeProvenanceWriter(),
      new NodeZipBuilder(),
    );

    await controller.create(PRINCIPAL, PROJECT, { projectId: PROJECT, artifactIds: null, treeNodeId: null });

    expect(exportContent.calls[0]!.selection).toEqual({ artifactIds: null, treeNodeId: null });
  });

  it("rejects a body whose projectId disagrees with the route param, instead of silently picking one (same discipline as advance/bind routes)", async () => {
    const { controller } = buildController([row({ artifactId: "c-1" })]);

    await expect(
      controller.create(PRINCIPAL, PROJECT, {
        projectId: "some-other-project",
        artifactIds: null,
        treeNodeId: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
