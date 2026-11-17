import {defineConfig} from "@playwright/test";
import native from "./playwright.aidt-native.config";
export default defineConfig({...native,projects:[...(native.projects??[]),{name:"audit",testMatch:["aidt-feedback-loop-audit.spec.ts"]}]});
