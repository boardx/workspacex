import { defineConfig } from "@playwright/test";
import fullstack from "./playwright.fullstack-smoke.config";
const outputDir = process.env.AIDT_E2E_OUTPUT_DIR ?? "test-results/aidt-native";

/** Opt-in local acceptance lane. It retains the canonical real API/PG fixtures;
 * flags remain explicit and no server is published beyond loopback. */
export default defineConfig({
  ...fullstack,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: `${outputDir}/results.json` }]],
  projects: fullstack.projects?.filter(project => project.name === "seeded").map(project => ({
    ...project,
    testMatch: ["project-aidt-native.spec.ts", "aidt-member-collaboration.spec.ts", "aidt-entity-chat.spec.ts", "aidt-interview-recording-scroll.spec.ts", "aidt-definition-entities.spec.ts", "aidt-test-entities.spec.ts"],
    dependencies: [],
  })),
  webServer: (Array.isArray(fullstack.webServer) ? fullstack.webServer : fullstack.webServer ? [fullstack.webServer] : []).map(server => ({
    ...server,
    command: server.command.replace("next start -p", "next start -H 127.0.0.1 -p"),
  })),
  outputDir,
});
