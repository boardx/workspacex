import { afterEach, describe, expect, it, vi } from "vitest";
import { appConfig, migrationConfig } from "../../src/infrastructure/db/pg-config";
import { redisConfig } from "../../src/infrastructure/auth/redis-session-token-store";

afterEach(() => vi.unstubAllEnvs());
function production() {
  for (const [key,value] of Object.entries({ WORKSPACEX_DEPLOY_PROFILE: "production", PGHOST: "db.internal", PGDATABASE: "workspacex", APP_DB_PASSWORD: "runtime-test-password", MIGRATION_DB_PASSWORD: "owner-test-password", REDIS_HOST: "redis.internal", REDIS_PASSWORD: "cache-test-password" })) vi.stubEnv(key,value);
}
describe("cloud data transport", () => {
  it("requires cloud secrets instead of falling back to dev passwords", () => {
    production(); vi.stubEnv("APP_DB_PASSWORD", ""); expect(() => appConfig()).toThrow("APP_DB_PASSWORD");
  });
  it("verifies production TLS and bounds PG operations", () => {
    production(); expect(appConfig()).toMatchObject({ ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
    expect(migrationConfig().password).toBe("owner-test-password");
  });
  it("rejects insecure production PG", () => {
    production(); vi.stubEnv("PGSSLMODE", "disable"); expect(() => appConfig()).toThrow("PGSSLMODE");
  });
  it("rejects unbounded query timeout", () => {
    production(); vi.stubEnv("PGSTATEMENT_TIMEOUT_MS", "0"); expect(() => appConfig()).toThrow("timeout");
  });
  it("uses authenticated TLS Redis", () => {
    production(); expect(redisConfig()).toMatchObject({ password: "cache-test-password", tls: { rejectUnauthorized: true }, connectTimeout: 5000 });
  });
  it.each(["false", "invalid"])("rejects production Redis TLS %s", tls => {
    production(); vi.stubEnv("REDIS_TLS", tls); expect(() => redisConfig()).toThrow("TLS");
  });
  it("requires starter Redis authentication too", () => {
    production(); vi.stubEnv("WORKSPACEX_DEPLOY_PROFILE", "starter"); vi.stubEnv("REDIS_PASSWORD", ""); expect(() => redisConfig()).toThrow("REDIS_PASSWORD");
  });
});
