import base from "./vitest.config";
import { defineConfig } from "vitest/config";
export default defineConfig({ ...base, test: { ...base.test,
  include: ["tests/files/cloud-*.real-db.test.ts"], maxWorkers: 1, minWorkers: 1 } });
