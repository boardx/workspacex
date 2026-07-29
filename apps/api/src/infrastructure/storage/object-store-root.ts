/**
 * Where the filesystem object store lives.
 *
 * A function rather than a constant read at import time: the gates and the DB-backed tests
 * set `WORKSPACEX_OBJECT_ROOT` before booting the app in-process, and a module-level constant
 * would have been frozen by whichever import happened first.
 *
 * Same shape and the same reason as `pg-config.ts`: one place reads the environment, so
 * "which store am I talking to" has one answer.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

export function objectStoreRoot(): string {
  const configured = process.env.WORKSPACEX_OBJECT_ROOT;
  if (configured !== undefined && configured !== "") return configured;
  // ⚠ A temp directory is a DEVELOPMENT default, not a deployment one. It is fine here for
  // the same reason the compose file only starts PostgreSQL: this kernel has no S3 yet, and
  // S3 arrives as a second implementation of the same port. A deployment that leaves this
  // unset and expects durability has misconfigured itself, which is why the variable exists.
  return join(tmpdir(), "workspacex-objects");
}
