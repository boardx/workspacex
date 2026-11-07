import { afterEach, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { ownedSurveyApi, ownedSurveyIdentity } from "../e2e/support/survey-owned-organization";

afterEach(() => vi.unstubAllEnvs());

it("keeps identity query scope out of the API base and reads the requested organization", async () => {
  vi.stubEnv("WORKSPACEX_ISOLATION_ID", "survey-r1-url-test");
  const fetch = vi.fn(async () => ({ ok: () => true, status: () => 200, json: async () => ({}) }));
  const page = { evaluate: async () => "fixture-session", request: { fetch } } as unknown as Page;
  const api = ownedSurveyApi(page, "http://127.0.0.1:3000/__fullstack_api/identity/me?orgId=local-original");

  await ownedSurveyIdentity(page, "http://127.0.0.1:3000/__fullstack_api/identity/me?orgId=local-original", "org-new");
  expect(fetch).toHaveBeenLastCalledWith("http://127.0.0.1:3000/__fullstack_api/identity/me?orgId=org-new", expect.any(Object));
  await api("/surveys");
  expect(fetch).toHaveBeenLastCalledWith("http://127.0.0.1:3000/__fullstack_api/surveys", expect.any(Object));
});

it("passes the explicit scope with an API origin that has no rewrite prefix", async () => {
  vi.stubEnv("WORKSPACEX_ISOLATION_ID", "survey-r1-url-test");
  const fetch = vi.fn(async () => ({ ok: () => true, status: () => 200, json: async () => ({}) }));
  const page = { evaluate: async () => "fixture-session", request: { fetch } } as unknown as Page;
  await ownedSurveyIdentity(page, "http://127.0.0.1:3000/identity/me?orgId=old", "local-original");
  expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:3000/identity/me?orgId=local-original", expect.any(Object));
});
