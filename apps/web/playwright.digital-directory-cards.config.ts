import { defineConfig } from "@playwright/test";
import fullstack from "./playwright.fullstack-smoke.config";

// Official imports mutate the shared catalog. Own the entire isolated seeded
// runtime instead of running beside seeded empty-catalog or role-pending tests.
export default defineConfig({
  ...fullstack,
  projects: [{ name: "directory-cards", testMatch: ["digital-directory-cards.spec.ts"], retries: 0 }],
  workers: 1,
  fullyParallel: false,
});
