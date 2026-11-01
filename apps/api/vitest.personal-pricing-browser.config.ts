import {defineConfig} from "vitest/config";
import base from "./vitest.billing-cashier.config";
export default defineConfig({...base,test:{...base.test,include:["tests/billing/personal-pricing-browser.integration.ts", "tests/billing/personal-stripe-pricing-browser.integration.ts"]}});
