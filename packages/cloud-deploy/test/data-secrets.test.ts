import { describe, expect, it } from "vitest";
import { productionDataEnvironment } from "../src/data-secrets";
const db = { host: "pg.internal", port: 5432, database: "workspacex", user: "app_rw", password: "a".repeat(32), diagnosticsUser: "app_diag_ro", diagnosticsPassword: "b".repeat(32) };
const migration = { host: db.host, port: db.port, database: db.database, user: "owner", password: "c".repeat(32) };
const redis = { host: "redis.internal", password: "d".repeat(32) };
describe("production secret contract", () => {
  it("renders separate identities with verified TLS", () => expect(productionDataEnvironment(db,migration,redis)).toMatchObject({ APP_DB_USER: "app_rw", MIGRATION_DB_USER: "owner", DIAG_DB_USER: "app_diag_ro", PGSSLMODE: "verify-full", REDIS_TLS: "true" }));
  it.each([ { ...migration, host: "other.internal" }, { ...migration, database: "other" }, { ...migration, user: "app_rw" }, { ...migration, user: "app_diag_ro" } ])("rejects mismatched identity", owner => expect(() => productionDataEnvironment(db,owner,redis)).toThrow("identities"));
  it("rejects short passwords safely", () => expect(() => productionDataEnvironment({...db,password:"secret"},migration,redis)).toThrow("invalid production data secret fields"));
  it("rejects unknown fields", () => expect(() => productionDataEnvironment({...db,ssl:false},migration,redis)).toThrow("invalid"));
});
