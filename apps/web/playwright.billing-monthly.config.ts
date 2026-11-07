import {defineConfig} from "@playwright/test";
import billing from "./playwright.billing-entry.config";
export default defineConfig({...billing,expect:{timeout:15000},testMatch:["billing-subscription-live.spec.ts","billing-entry.browser.ts"],webServer:billing.webServer});
