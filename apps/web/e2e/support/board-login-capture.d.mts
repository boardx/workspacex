import type {Page} from '@playwright/test';
export function captureBoardLogin(page: Page, login: () => Promise<string>): Promise<{status: number; body: unknown; jsonParsed: boolean; token: string; posts: number}>;
