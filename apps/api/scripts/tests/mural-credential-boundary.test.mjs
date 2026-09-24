import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkMuralCredentialBoundary, MURAL_CREDENTIAL_PATH } from "../lib/mural-credential-boundary.mjs";

const root = new URL("../..", import.meta.url).pathname;
const source = readFileSync(join(root, MURAL_CREDENTIAL_PATH), "utf8");
const migration = readFileSync(join(root, "migrations/20260924000900_whiteboard_mural_direct_import.sql"), "utf8");
const evidence = readFileSync(join(root, "tests/whiteboard/mural-repository-guard.test.ts"), "utf8");

assert.deepEqual(checkMuralCredentialBoundary(source, migration, evidence), []);
assert.ok(checkMuralCredentialBoundary(source.replace(" AND actor_id=$2", ""), migration, evidence).some(value => value.includes("actor_id")));
assert.ok(checkMuralCredentialBoundary(source.replace("consumed_at IS NULL", "TRUE"), migration, evidence).some(value => value.includes("one-time")));
assert.ok(checkMuralCredentialBoundary(source.replace("revision=$3", "TRUE"), migration, evidence).some(value => value.includes("CAS")));
assert.ok(checkMuralCredentialBoundary(source, `${migration}\nrefresh_token text`, evidence).some(value => value.includes("plaintext")));

console.log("mural-credential-boundary: pass");
