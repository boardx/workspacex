import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  BrowserClickInput,
  BrowserFillFormInput,
  BrowserNavigateInput,
  BrowserScreenshotOutput,
  STANDARD_BROWSER_CONTRACTS,
  STANDARD_BROWSER_LIMITS,
  StandardBrowserInvocation,
} from '../src/standard-browser-tools';

const ref = `element:${'a'.repeat(64)}`;
const page = `page:${'b'.repeat(64)}`;

it('keeps model input separate from trusted run identity', () => {
  expect(BrowserNavigateInput.safeParse({ url: 'https://example.com' }).success).toBe(true);
  expect(BrowserNavigateInput.safeParse({ url: 'https://example.com', orgId: 'forged' }).success).toBe(false);
  expect(BrowserClickInput.safeParse({ pageRef: page, elementRef: ref }).success).toBe(true);
  expect(BrowserClickInput.safeParse({ pageRef: `page:${'c'.repeat(64)}`, elementRef: 'e1' }).success).toBe(false);
  expect(BrowserFillFormInput.safeParse({ pageRef: page, fields: [{ ref, value: 'Grace' }] }).success).toBe(true);
});

it('requires screenshot output to remain a workspace file, not a fabricated artifact', () => {
  const output = { pageRef: page, workspacePath: `/workspace/browser-${'d'.repeat(64)}.png`, mime: 'image/png', width: 1280, height: 720, sha256: 'e'.repeat(64), sizeBytes: 100, fullPage: false };
  expect(BrowserScreenshotOutput.parse(output)).toEqual(output);
  expect(BrowserScreenshotOutput.safeParse({ ...output, workspacePath: '/tmp/other-run.png' }).success).toBe(false);
  expect(BrowserScreenshotOutput.shape).not.toHaveProperty('artifactId');
});

it('generated Python browser schema is exact', () => {
  const options = { target: 'jsonSchema7', $refStrategy: 'none' } as const;
  const tools = Object.fromEntries(Object.entries(STANDARD_BROWSER_CONTRACTS).map(([name, contract]) => [name, {
    input: zodToJsonSchema(contract.input, options),
    output: zodToJsonSchema(contract.output, options),
  }]));
  const actual = JSON.parse(readFileSync(new URL('../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_browser_schema.json', import.meta.url), 'utf8'));
  expect(actual).toEqual({ limits: STANDARD_BROWSER_LIMITS, input: zodToJsonSchema(StandardBrowserInvocation, options), tools });
});
