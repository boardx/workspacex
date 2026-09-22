import type { z } from 'zod';
import type {
  BrowserClickInput,
  BrowserClickOutput,
  BrowserFillFormInput,
  BrowserFillFormOutput,
  BrowserNavigateInput,
  BrowserNavigateOutput,
  BrowserSnapshotInput,
  BrowserSnapshotOutput,
  BrowserTakeScreenshotInput,
  BrowserScreenshotOutput,
} from '@repo/contracts/standard-browser-tools';
import type { ExecutionAuthorityContext } from './tool-execution-authority';
import type { DraftSessionFiles } from './skill-draft';

export const STANDARD_BROWSER_SERVICE = Symbol('StandardBrowserService');

export type BrowserContext = ExecutionAuthorityContext & {
  readonly bindingId: string;
  readonly toolCallId: string;
};

export type BrowserInvocation =
  | { toolName: 'browser_navigate'; toolArgs: z.infer<typeof BrowserNavigateInput> }
  | { toolName: 'browser_snapshot'; toolArgs: z.infer<typeof BrowserSnapshotInput> }
  | { toolName: 'browser_click'; toolArgs: z.infer<typeof BrowserClickInput> }
  | { toolName: 'browser_fill_form'; toolArgs: z.infer<typeof BrowserFillFormInput> }
  | { toolName: 'browser_take_screenshot'; toolArgs: z.infer<typeof BrowserTakeScreenshotInput> };

export type BrowserInvocationOutput =
  | z.infer<typeof BrowserNavigateOutput>
  | z.infer<typeof BrowserSnapshotOutput>
  | z.infer<typeof BrowserClickOutput>
  | z.infer<typeof BrowserFillFormOutput>
  | z.infer<typeof BrowserScreenshotOutput>;

export interface StandardBrowserService {
  invoke(context: BrowserContext, invocation: BrowserInvocation): Promise<BrowserInvocationOutput>;
  release(bindingId: string): Promise<void>;
}

export type BrowserReceiptClaim =
  | { readonly kind: 'claimed' }
  | { readonly kind: 'succeeded'; readonly result: BrowserInvocationOutput }
  | { readonly kind: 'unconfirmed' };

/**
 * Why a browser action's outcome is unknown. The adapter's outward contract string stays
 * `browser_execution_unconfirmed_no_replay` for every one of these, so an environment gap
 * (BLOCKED) and a contract violation (FAIL) are otherwise indistinguishable -- the receipt
 * carries this classification so the difference is decidable from data, not from a log line
 * or a temporary `console.error` stub.
 *
 * Single source of truth: the persisted column is a free `text` deliberately, so this union
 * is not restated as a SQL CHECK that would then drift away from it.
 */
export const BROWSER_FAILURE_CLASSES = [
  /** The browser runtime/session could not be created at all (missing Chromium, dead transport). */
  'session_launch_failed',
  /** Playwright MCP accepted the call and reported a tool-level failure. */
  'upstream_tool_error',
  /** The action deadline fired, or the call was aborted, before an outcome was known. */
  'timeout',
  /** An upstream response or preview payload exceeded an adapter limit. */
  'oversize',
  /** A page or element handle no longer names anything this generation. */
  'stale_ref',
  /** Authorization, the network gate, or the preview gate refused the action after it was claimed. */
  'policy_denied',
  /** Upstream or workspace data failed an adapter contract check (schema, readback, PNG shape). */
  'contract_violation',
  /** Nothing above matched. Deliberately not a synonym for any of them. */
  'unknown',
] as const;

export type BrowserFailureClass = (typeof BROWSER_FAILURE_CLASSES)[number];

/**
 * Durable before-dispatch receipt. A prior pending/unconfirmed action is never dispatched
 * again: the caller only knows that its outcome is unknown, not that it did not happen.
 */
export interface BrowserExecutionReceipts {
  claim(context: BrowserContext, invocation: BrowserInvocation, argsDigest: string, deadlineAt: Date): Promise<BrowserReceiptClaim>;
  succeed(context: BrowserContext, invocation: BrowserInvocation, argsDigest: string, result: BrowserInvocationOutput): Promise<void>;
  markUnconfirmed(context: BrowserContext, invocation: BrowserInvocation, argsDigest: string, failure: BrowserFailureClass): Promise<void>;
}

export interface BrowserWorkspace extends DraftSessionFiles {}
