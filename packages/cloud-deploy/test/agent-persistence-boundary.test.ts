import { expect, it } from "vitest";
import { validateProductionAgentPersistence } from "../src/agent-persistence-boundary.js";
const baseline = () => ({
  DATABASE_URI: "postgresql://graph_owner:graph-secret@db.example/graph?sslmode=verify-full",
  MEMORY_STORE_DATABASE_URL: "postgresql://memory_rw:memory-secret@db.example/memory?sslmode=verify-full",
  MEMORY_STORE_MIGRATION_DATABASE_URL: "postgresql://memory_owner:owner-secret@db.example/memory?sslmode=verify-full",
});
it("accepts independent identities with exactly one verified TLS setting", () => {
  expect(() => validateProductionAgentPersistence(baseline())).not.toThrow();
});
it("accepts sslmode=disable only when the caller passes the explicit exception mode", () => {
  const disabled=Object.fromEntries(Object.entries(baseline()).map(([key,value])=>[key,value.replace("sslmode=verify-full","sslmode=disable")])) as ReturnType<typeof baseline>;
  expect(()=>validateProductionAgentPersistence(disabled)).toThrow("AGENT_PERSISTENCE_CONFIGURATION_INVALID");
  expect(()=>validateProductionAgentPersistence(disabled,"disable")).not.toThrow();
});
it.each(["memory_rw", "memory_owner", "app_rw", "app_diag_ro", "memory%5fowner"])("rejects graph reuse of %s", user => {
  expect(() => validateProductionAgentPersistence({ ...baseline(), DATABASE_URI: baseline().DATABASE_URI.replace("graph_owner", user) })).toThrow("AGENT_PERSISTENCE_CONFIGURATION_INVALID");
});
const keys = ["DATABASE_URI", "MEMORY_STORE_DATABASE_URL", "MEMORY_STORE_MIGRATION_DATABASE_URL"] as const;
it.each(keys)("rejects libpq TLS and identity query overrides on %s", key => {
  for (const suffix of ["&sslmode=disable", "&sslmode=verify-full", "&user=memory_owner", "&dbname=memory", "&host=other", "&port=5433", "&password=other", "&sslrootcert=/tmp/ca", "&sslcert=/tmp/client", "&sslkey=/tmp/key", "&options=-csearch_path=public"]) {
    expect(() => validateProductionAgentPersistence({ ...baseline(), [key]: baseline()[key] + suffix })).toThrow("AGENT_PERSISTENCE_CONFIGURATION_INVALID");
  }
});
it("sanitizes invalid URL errors and rejects missing TLS", () => {
  for (const value of ["secret-marker", baseline().DATABASE_URI.split("?")[0]!, baseline().DATABASE_URI.replace("verify-full", "require")]) {
    try { validateProductionAgentPersistence({ ...baseline(), DATABASE_URI: value }); throw new Error("unexpected pass"); }
    catch (error) { expect(String(error)).toBe("Error: AGENT_PERSISTENCE_CONFIGURATION_INVALID"); }
  }
});
it.each(["DATABASE_URI", "MEMORY_STORE_DATABASE_URL", "MEMORY_STORE_MIGRATION_DATABASE_URL"] as const)("rejects a shared password through %s", key => {
  const input = baseline();
  if (key === "DATABASE_URI") input.DATABASE_URI = input.DATABASE_URI.replace("graph-secret", "memory-secret");
  if (key === "MEMORY_STORE_DATABASE_URL") input.MEMORY_STORE_DATABASE_URL = input.MEMORY_STORE_DATABASE_URL.replace("memory-secret", "graph-secret");
  if (key === "MEMORY_STORE_MIGRATION_DATABASE_URL") input.MEMORY_STORE_MIGRATION_DATABASE_URL = input.MEMORY_STORE_MIGRATION_DATABASE_URL.replace("owner-secret", "graph-secret");
  expect(() => validateProductionAgentPersistence(input)).toThrow("AGENT_PERSISTENCE_CONFIGURATION_INVALID");
});
