import { z } from 'zod';
import { NativeSessionResolveInput } from './native-session-binding';

export const STANDARD_BROWSER_TOOLS = [
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_fill_form',
  'browser_take_screenshot',
] as const;

export const STANDARD_BROWSER_LIMITS = {
  deadlineMs: 30_000,
  maxResponseBytes: 2 * 1024 * 1024,
  maxSnapshotChars: 250_000,
  maxElements: 2_000,
  maxFields: 100,
  viewportWidth: 1_280,
  viewportHeight: 720,
} as const;

export const BrowserPageRef = z.string().regex(/^page:[a-f0-9]{64}$/);
export const BrowserElementRef = z.string().regex(/^element:[a-f0-9]{64}$/);

export const BrowserNavigateInput = z.object({
  url: z.string().url().max(4096).refine(value => {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  }, 'public HTTP(S) URL required'),
}).strict();

export const BrowserSnapshotInput = z.object({
  pageRef: BrowserPageRef,
}).strict();

export const BrowserClickInput = z.object({
  pageRef: BrowserPageRef,
  elementRef: BrowserElementRef,
}).strict();

export const BrowserFillFormInput = z.object({
  pageRef: BrowserPageRef,
  fields: z.array(z.object({
    ref: BrowserElementRef,
    value: z.union([z.string().max(100_000), z.boolean()]),
  }).strict()).min(1).max(STANDARD_BROWSER_LIMITS.maxFields),
}).strict();

export const BrowserTakeScreenshotInput = z.object({
  pageRef: BrowserPageRef,
  fullPage: z.boolean().optional(),
}).strict();

export const BrowserPage = z.object({
  pageRef: BrowserPageRef,
  url: z.string().url(),
  title: z.string().max(4_096),
  generation: z.number().int().nonnegative(),
}).strict();

export const BrowserNavigateOutput = BrowserPage;
export const BrowserSnapshotOutput = BrowserPage.extend({
  snapshot: z.string().max(STANDARD_BROWSER_LIMITS.maxSnapshotChars),
  elements: z.array(z.object({
    elementRef: BrowserElementRef,
  }).strict()).max(STANDARD_BROWSER_LIMITS.maxElements),
}).strict();

export const BrowserClickOutput = BrowserPage.extend({
  outcome: z.literal('clicked'),
}).strict();

export const BrowserFillFormOutput = BrowserPage.extend({
  filled: z.array(BrowserElementRef).max(STANDARD_BROWSER_LIMITS.maxFields),
}).strict();

export const BrowserScreenshotOutput = z.object({
  pageRef: BrowserPageRef,
  workspacePath: z.string().regex(/^\/workspace\/browser-[a-f0-9]{64}\.png$/),
  mime: z.literal('image/png'),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(1_000_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive(),
  fullPage: z.boolean(),
}).strict();

const identity = NativeSessionResolveInput.omit({ runId: true }).extend({
  bindingId: z.string().uuid(),
  toolCallId: z.string().min(1).max(256),
  permissionRequestId: z.string().uuid().optional(),
});

export const StandardBrowserInvocation = z.discriminatedUnion('toolName', [
  identity.extend({ toolName: z.literal('browser_navigate'), toolArgs: BrowserNavigateInput }).strict(),
  identity.extend({ toolName: z.literal('browser_snapshot'), toolArgs: BrowserSnapshotInput }).strict(),
  identity.extend({ toolName: z.literal('browser_click'), toolArgs: BrowserClickInput }).strict(),
  identity.extend({ toolName: z.literal('browser_fill_form'), toolArgs: BrowserFillFormInput }).strict(),
  identity.extend({ toolName: z.literal('browser_take_screenshot'), toolArgs: BrowserTakeScreenshotInput }).strict(),
]);

export const STANDARD_BROWSER_CONTRACTS = {
  browser_navigate: { input: BrowserNavigateInput, output: BrowserNavigateOutput },
  browser_snapshot: { input: BrowserSnapshotInput, output: BrowserSnapshotOutput },
  browser_click: { input: BrowserClickInput, output: BrowserClickOutput },
  browser_fill_form: { input: BrowserFillFormInput, output: BrowserFillFormOutput },
  browser_take_screenshot: { input: BrowserTakeScreenshotInput, output: BrowserScreenshotOutput },
} as const;
