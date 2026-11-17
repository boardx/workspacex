import { afterEach, expect, it, vi } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { operations } from "@repo/contracts/aidt-courses";
// @ts-expect-error executable Next configuration has no declaration file
import config from "../next.config.mjs";
const origin = "http://127.0.0.1:3207";
type Rewrite = { source: string; destination: string };
afterEach(() => vi.unstubAllEnvs());
it.each([false, true])("covers every approved course operation without taking over native AIDT pages (prefixed=%s)", async prefixed => {
  vi.stubEnv("FULLSTACK_E2E_API_ORIGIN", prefixed ? origin : undefined);
  vi.stubEnv("CHAT_READ_E2E_API_ORIGIN", origin);
  const prefix = prefixed ? "/__fullstack_api" : "";
  const { afterFiles } = await config.rewrites();
  for (const operation of Object.values(operations)) {
    const concrete = operation.path.replace(":courseId", "crs-1").replace(":projectId", "prj-1");
    const rule = afterFiles.find((value: Rewrite) => getPathMatch(value.source)(prefix + concrete) !== false);
    expect(rule?.destination).toBe(origin + operation.path);
  }
  const courseRules = afterFiles.filter((rule: Rewrite) => rule.source.startsWith(`${prefix}/aidt/`));
  expect(courseRules).toHaveLength(3);
  for (const page of ["/aidt", "/aidt/prj-native", "/aidt/prj-native?step=1", "/aidt/courses/not-an-api"]) {
    expect(courseRules.some((rule: Rewrite) => getPathMatch(rule.source)(page.split("?")[0]!) !== false)).toBe(false);
  }
});
it("does not create an origin or proxy when none is configured", async () => {
  vi.stubEnv("FULLSTACK_E2E_API_ORIGIN", ""); vi.stubEnv("CHAT_READ_E2E_API_ORIGIN", "");
  const result = await config.rewrites();
  expect((result.afterFiles ?? []).some((rule: Rewrite) => rule.source.includes("/aidt/"))).toBe(false);
});

it.each([false, true])("keeps the approved raw content path explicit and its existing family intact (prefixed=%s)", async prefixed => {
  vi.stubEnv("FULLSTACK_E2E_API_ORIGIN", prefixed ? origin : undefined); vi.stubEnv("CHAT_READ_E2E_API_ORIGIN", origin);
  const prefix = prefixed ? "/__fullstack_api" : "";
  const { afterFiles } = await config.rewrites();
  expect(afterFiles.find((rule: Rewrite) => rule.source === `${prefix}/ingestion-runs/:ingestionRunId/content`)?.destination).toBe(`${origin}/ingestion-runs/:ingestionRunId/content`);
  expect(afterFiles.find((rule: Rewrite) => rule.source === `${prefix}/ingestion-runs/:path*`)?.destination).toBe(`${origin}/ingestion-runs/:path*`);
});
