import { expect, it, vi } from "vitest";
import { continueArtifact, type ContinueArtifactDeps } from "../../src/application/artifacts-steering/continue-artifact";
import { resolveVisibility } from "../../src/application/chat/resolve-visibility";
import { ArtifactNotVisibleError } from "../../src/application/artifacts-steering/errors";
import { guard } from "../../src/application/security/permission-filter";
import { toOrgId } from "../../src/domain/org-id";
vi.mock("../../src/application/chat/resolve-visibility", () => ({resolveVisibility: vi.fn()}));
const orgId = toOrgId("org-continuation-access");
const input = {orgId, userId: "user", artifactId: "artifact", basedOnVersion: 1, instruction: "revise"};
function setup(projectRole: string, archived: boolean) {
  const object = {kind: "project" as const, id: "project"};
  vi.mocked(resolveVisibility).mockResolvedValue({kind: "allow", actor: {projectRole}, thread: {archived},
    base: {allowed: true, object}} as unknown as Awaited<ReturnType<typeof resolveVisibility>>);
  const findVersion = vi.fn().mockResolvedValue(guard(object, {version: 1, producedByRunId: "source"}));
  const launch = vi.fn().mockResolvedValue({runId: "next"});
  return {findVersion, launch, deps: {artifacts: {findLocator: vi.fn().mockResolvedValue({projectId: "project", threadId: "thread"}), findVersion},
    launcher: {launch}} as unknown as ContinueArtifactDeps};
}
it.each([["observer", false], ["facilitator", true]])("rejects %s archived=%s before revealing or loading a hidden version", async (role, archived) => {
  const {deps, findVersion, launch} = setup(role as string, archived as boolean);
  await expect(continueArtifact(deps, input)).rejects.toBeInstanceOf(ArtifactNotVisibleError);
  expect(findVersion).not.toHaveBeenCalled();
  expect(launch).not.toHaveBeenCalled();
});
it("keeps editable member continuation on the exact selected version", async () => {
  const {deps, findVersion, launch} = setup("facilitator", false);
  expect(await continueArtifact(deps, input)).toEqual({runId: "next", artifactId: "artifact"});
  expect(findVersion).toHaveBeenCalledWith(orgId, "artifact", 1);
  expect(launch).toHaveBeenCalledWith(orgId, expect.objectContaining({basedOnVersion: {version: 1, producedByRunId: "source"}}));
});
