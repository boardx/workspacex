import { afterAll } from "vitest";
import { cleanupSeededOrganizations } from "./fixture-ownership";

// Registered before each file's own hooks: Vitest runs afterAll hooks in stack
// order, so apps/workers close before their seeded tenant rows are removed.
// Import only the inert ownership registry. Eagerly importing db here loads pg
// before file-local mocks and evaluates Node URL code inside jsdom suites.
// DB-free files seed nothing, and therefore do not load any database modules.
afterAll(() => cleanupSeededOrganizations(), 120_000);
