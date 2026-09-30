import { randomUUID } from "node:crypto";
import { constants, mkdirSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Reserve a new private inode before Docker is contacted. Never adopt an existing file. */
export function openPrivateReport(path: string): number {
  return openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
}

/** UUID isolation plus an atomic host lock prevents two invocations owning the same project. */
export function acquireRehearsalRun(runId = randomUUID(), lockRoot = tmpdir()) {
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error("invalid rehearsal run ID");
  const project = `wsx-cn-migration-rehearsal-4763-${runId}`;
  const lock = join(lockRoot, `${project}.lock`);
  mkdirSync(lock, { mode: 0o700 });
  let released = false;
  return { project, runId, release() {
    if (!released) { rmSync(lock, { recursive: true }); released = true; }
  } };
}

export function assertLocalDockerEndpoint(endpoint: string): void {
  if (!endpoint.startsWith("unix://") || !endpoint.slice(7).startsWith("/")) {
    throw new Error("synthetic rehearsal requires a local Unix Docker endpoint");
  }
}

export function assertRehearsalResourcesAbsent(project: string, docker: (...args: string[]) => string) {
  if (docker("ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`)
    || docker("network", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`)
    || docker("volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`)) {
    throw new Error("rehearsal project already exists");
  }
}
