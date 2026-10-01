import { afterAll } from "vitest";
import { cleanupSeededOrganizations } from "./db";

// Registered before each file's own hooks: Vitest runs afterAll hooks in stack
// order, so apps/workers close before their seeded tenant rows are removed.
// DB-free files seed nothing, and therefore do not open a database connection.
afterAll(() => cleanupSeededOrganizations(), 120_000);
