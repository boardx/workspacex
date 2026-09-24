import { defineConfig } from "vitest/config";

/** D3 CRM 源站无库单测；RLS 的真库断言在主套件 tests/crm/crm-contacts-rls.test.ts。 */
export default defineConfig({ test: { include: ["tests/crm/crm-contact-unit.test.ts"] } });
