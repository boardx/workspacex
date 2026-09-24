import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkMiroCredentialBoundary, MIRO_CREDENTIAL_PATH } from "../lib/miro-credential-boundary.mjs";

const root = new URL("../..", import.meta.url).pathname;
const source = readFileSync(join(root, MIRO_CREDENTIAL_PATH), "utf8");
const migration = readFileSync(join(root, "migrations/20260924000800_whiteboard_miro_direct_import.sql"), "utf8");
const evidence = readFileSync(join(root, "tests/whiteboard/miro-repository-guard.test.ts"), "utf8");

assert.deepEqual(checkMiroCredentialBoundary(source, migration, evidence), []);
assert.ok(checkMiroCredentialBoundary(source.replace(" AND actor_id=$2", ""), migration, evidence).some(value => value.includes("actor_id")));
assert.ok(checkMiroCredentialBoundary(source.replace("consumed_at IS NULL", "TRUE"), migration, evidence).some(value => value.includes("one-time")));
assert.ok(checkMiroCredentialBoundary(source.replace("revision=$3", "TRUE"), migration, evidence).some(value => value.includes("CAS")));
assert.ok(checkMiroCredentialBoundary(source, `${migration}\naccess_token text`, evidence).some(value => value.includes("plaintext")));

console.log("miro-credential-boundary: pass");
