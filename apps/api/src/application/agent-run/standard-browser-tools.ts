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
 * Durable before-dispatch receipt. A prior pending/unconfirmed action is never dispatched
 * again: the caller only knows that its outcome is unknown, not that it did not happen.
 */
export interface BrowserExecutionReceipts {
  claim(context: BrowserContext, invocation: BrowserInvocation, argsDigest: string, deadlineAt: Date): Promise<BrowserReceiptClaim>;
  succeed(context: BrowserContext, invocation: BrowserInvocation, argsDigest: string, result: BrowserInvocationOutput): Promise<void>;
  markUnconfirmed(context: BrowserContext, invocation: BrowserInvocation, argsDigest: string): Promise<void>;
}

export interface BrowserWorkspace extends DraftSessionFiles {}
