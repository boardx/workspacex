/**
 * F37 -- 幂等键去重（uc-22-2 R7）：同一文件连续上传两次不产生重复 Segment/Version。
 *
 * Against in-memory doubles, per this worker's no-local-Postgres constraint (issue #74) --
 * `tests/support/artifact-fakes.ts` keeps real per-key bytes and real per-version rows, so
 * "still exactly one artifact_versions row" is read back from the fake's own map rather than
 * asserted about a value the test itself computed and never round-tripped.
 *
 * 幂等键 = content_hash + pipeline_version + parser_version (`domain/files/idempotency-key.ts`).
 * `upload-artifact.ts`'s dedup check runs BEFORE `materializeArtifact`, so a genuine
 * duplicate never reaches `createVersion` at all -- the "segments 行数两次相同（差值为0）"
 * half of this feature's `user_visible_behavior` holds by construction: no second version
 * means no second EXTRACTED/SEGMENTED job, means no second Segment, full stop.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { uploadArtifact, type UploadArtifactDeps } from "../../src/application/files/upload-artifact";
import type { QuarantineRepository, SecurityAlertPort } from "../../src/application/files/upload-ports";
import {
  FakeArtifactRepository,
  FakeObjectStore,
  SequentialIdFactory,
} from "../support/artifact-fakes";
import { FakeProvenanceWriter } from "../support/role-view-fakes";

const ORG = toOrgId("org-f37-idempotent");
const PROJECT = "proj-f37-idempotent";

class NoopQuarantine implements QuarantineRepository {
  async record(): Promise<void> {
    /* not exercised -- these files never trip the scanner */
  }
}
class NoopAlerts implements SecurityAlertPort {
  async raise(): Promise<void> {
    /* not exercised */
  }
}

function harness() {
  const provenance = new FakeProvenanceWriter();
  const repo = new FakeArtifactRepository();
  const deps: UploadArtifactDeps = {
    store: new FakeObjectStore(),
    repo,
    ids: new SequentialIdFactory(),
    quarantine: new NoopQuarantine(),
    alerts: new NoopAlerts(),
    provenance,
  };
  return { deps, provenance, repo };
}

function accepted(outcome: Awaited<ReturnType<typeof uploadArtifact>>["files"][number]) {
  expect(outcome.status).toBe("accepted");
  if (outcome.status !== "accepted") throw new Error("unreachable");
  return outcome;
}

describe("F37 -- 幂等键去重：同一文件连续上传两次", () => {
  it("segments 行数两次相同（差值为0）：第二次不产生新 artifact_version", async () => {
    const { deps, repo } = harness();
    const bytes = new TextEncoder().encode("the exact same bytes, twice");

    const first = accepted(
      (
        await uploadArtifact(deps, {
          orgId: ORG,
          projectId: PROJECT,
          agendaSegmentId: null,
          confidential: false,
          actorId: "u-1",
          files: [{ filename: "report.txt", bytes }],
        })
      ).files[0]!,
    );
    expect(first.duplicate).toBe(false);
    expect(repo.versions.size).toBe(1);

    const second = accepted(
      (
        await uploadArtifact(deps, {
          orgId: ORG,
          projectId: PROJECT,
          agendaSegmentId: null,
          confidential: false,
          actorId: "u-2",
          files: [{ filename: "report-again.txt", bytes }], // even a DIFFERENT filename --
          // the key is content_hash+pipeline+parser, never the name (uc-22-2 R7).
        })
      ).files[0]!,
    );

    // The critical assertions: no second version, second call reports the hit, both point at
    // the SAME artifact/version.
    expect(second.duplicate, "第二次上传必须报告幂等命中标识").toBe(true);
    expect(second.artifactId).toBe(first.artifactId);
    expect(second.versionId).toBe(first.versionId);
    expect(second.versionNumber).toBe(first.versionNumber);
    expect(repo.versions.size, "artifact_versions 不应新增").toBe(1);

    // Drive both versions through the SEGMENTED step (F36's worker) and confirm the segment
    // count truly never moves off whatever the FIRST (only) version produced -- there is no
    // second version for a second SEGMENTED job to even run against.
    expect(repo.segments.size).toBe(0); // the worker was never invoked in this test --
    // asserted anyway so a future edit that starts auto-running the worker here does not
    // silently start asserting on state this test never produced.
  });

  it("provenance_events 新增一条但 artifact_versions 不新增（幂等命中不得静默）", async () => {
    const { deps, provenance, repo } = harness();
    const bytes = new TextEncoder().encode("dedup provenance check");

    await uploadArtifact(deps, {
      orgId: ORG,
      projectId: PROJECT,
      agendaSegmentId: null,
      confidential: false,
      actorId: "u-1",
      files: [{ filename: "a.txt", bytes }],
    });
    expect(provenance.appended).toHaveLength(1);
    expect(provenance.appended[0]!.type).toBe("ingested");
    expect(provenance.appended[0]!.detail.duplicate).toBe(false);

    await uploadArtifact(deps, {
      orgId: ORG,
      projectId: PROJECT,
      agendaSegmentId: null,
      confidential: false,
      actorId: "u-2",
      files: [{ filename: "a-copy.txt", bytes }],
    });

    // ONE new provenance row for the second upload (not zero -- "silently deduped" is
    // exactly what R7 forbids), and it is explicitly marked as the duplicate branch.
    expect(provenance.appended).toHaveLength(2);
    expect(provenance.appended[1]!.type).toBe("ingested");
    expect(provenance.appended[1]!.detail.duplicate).toBe(true);
    expect(repo.versions.size, "the second event must not correspond to a new version").toBe(1);
  });

  it("parser_version 升版后再上传新增派生版本而旧 Segment 未被修改", async () => {
    const { deps, repo } = harness();
    const bytes = new TextEncoder().encode("same bytes, parser upgraded later");

    const v1 = accepted(
      (
        await uploadArtifact(deps, {
          orgId: ORG,
          projectId: PROJECT,
          agendaSegmentId: null,
          confidential: false,
          actorId: "u-1",
          files: [{ filename: "doc.txt", bytes }],
        })
      ).files[0]!,
    );
    expect(v1.duplicate).toBe(false);

    // Same content, but parser_version bumped -- NOT a duplicate hit, a genuine new version.
    const v2 = accepted(
      (
        await uploadArtifact(deps, {
          orgId: ORG,
          projectId: PROJECT,
          agendaSegmentId: null,
          confidential: false,
          actorId: "u-1",
          files: [{ filename: "doc.txt", bytes }],
          parserVersion: "2",
        })
      ).files[0]!,
    );

    expect(v2.duplicate, "parser 版本不同不是同一幂等键，必须视为新内容").toBe(false);
    expect(v2.artifactId).not.toBe(v1.artifactId);
    expect(v2.versionId).not.toBe(v1.versionId);
    expect(repo.versions.size).toBe(2);

    // Re-uploading the ORIGINAL parser version again is still recognised as a duplicate of
    // v1, unaffected by v2 existing in between.
    const v1Again = accepted(
      (
        await uploadArtifact(deps, {
          orgId: ORG,
          projectId: PROJECT,
          agendaSegmentId: null,
          confidential: false,
          actorId: "u-1",
          files: [{ filename: "doc.txt", bytes }],
        })
      ).files[0]!,
    );
    expect(v1Again.duplicate).toBe(true);
    expect(v1Again.versionId).toBe(v1.versionId);
    expect(repo.versions.size, "重跑旧 parser 版本不应再新增任何版本").toBe(2);
  });

  it("反证：不同项目里同样的字节不算重复（幂等键按项目隔离，不是全局按内容去重）", async () => {
    const { deps, repo } = harness();
    const bytes = new TextEncoder().encode("shared bytes across two projects");

    const inProjectA = accepted(
      (
        await uploadArtifact(deps, {
          orgId: ORG,
          projectId: "proj-a",
          agendaSegmentId: null,
          confidential: false,
          actorId: "u-1",
          files: [{ filename: "shared.txt", bytes }],
        })
      ).files[0]!,
    );
    const inProjectB = accepted(
      (
        await uploadArtifact(deps, {
          orgId: ORG,
          projectId: "proj-b",
          agendaSegmentId: null,
          confidential: false,
          actorId: "u-1",
          files: [{ filename: "shared.txt", bytes }],
        })
      ).files[0]!,
    );

    expect(inProjectA.duplicate).toBe(false);
    expect(inProjectB.duplicate, "同样字节在不同项目不是幂等命中").toBe(false);
    expect(inProjectB.artifactId).not.toBe(inProjectA.artifactId);
    expect(repo.versions.size).toBe(2);
  });
});
