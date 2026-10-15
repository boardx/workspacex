import { defineConfig } from "@playwright/test";
import fullstack from "./playwright.fullstack-smoke.config";
const seeded = fullstack.projects?.find(project => project.name === "seeded");
if (!seeded) throw new Error("BOARD_DOWNLOAD_SEEDED_PROJECT_MISSING");
export default defineConfig({ ...fullstack, projects: [{ ...seeded, name: "board-download", testMatch: ["board-download.spec.ts"], dependencies: [] }] });
