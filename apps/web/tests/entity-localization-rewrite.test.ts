import { afterEach, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
// @ts-expect-error executable Next config has no declaration file
import config from "../next.config.mjs";
const original = { full: process.env.FULLSTACK_E2E_API_ORIGIN, chat: process.env.CHAT_READ_E2E_API_ORIGIN };
afterEach(() => {
  for (const [key,value] of [["FULLSTACK_E2E_API_ORIGIN",original.full],["CHAT_READ_E2E_API_ORIGIN",original.chat]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
for (const prefixed of [false,true]) it(`routes display update reads and writes without intercepting admin pages: prefixed=${prefixed}`, async () => {
  if (prefixed) process.env.FULLSTACK_E2E_API_ORIGIN = "http://127.0.0.1:3207"; else delete process.env.FULLSTACK_E2E_API_ORIGIN;
  process.env.CHAT_READ_E2E_API_ORIGIN = "http://127.0.0.1:3207";
  const { afterFiles } = await config.rewrites(), prefix = prefixed ? "/__fullstack_api" : "";
  for (const path of ["/admin/entity-display-updates","/admin/entity-display-updates/offer"]) {
    const match = afterFiles.find((rule: { source: string }) => getPathMatch(rule.source)(prefix+path));
    expect(match?.destination).toMatch(/^http:\/\/127\.0\.0\.1:3207\/admin\/entity-display-updates/);
  }
  for (const path of ["/admin","/admin/agent","/admin/skill"]) expect(afterFiles.some((rule: { source: string }) => getPathMatch(rule.source)(prefix+path))).toBe(false);
});
