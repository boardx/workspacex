import type {Browser,BrowserContext,BrowserType,Page} from '@playwright/test';
export function createOwnedLifecycleBrowser(chromium:BrowserType,budget:{testBudgetMs:number;teardownBudgetMs:number;chromiumSandbox?:boolean}):Promise<{browser:Browser;context:BrowserContext;page:Page;close:()=>Promise<void>;assertLive:()=>void}>;
