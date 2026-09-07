import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  STANDARD_BROWSER_CONTRACTS,
  STANDARD_BROWSER_LIMITS,
  StandardBrowserInvocation,
} from '../src/standard-browser-tools';

const options = { target: 'jsonSchema7', $refStrategy: 'none' } as const;
const tools = Object.fromEntries(Object.entries(STANDARD_BROWSER_CONTRACTS).map(([name, contract]) => [
  name,
  {
    input: zodToJsonSchema(contract.input, options),
    output: zodToJsonSchema(contract.output, options),
  },
]));
const content = `${JSON.stringify({ limits: STANDARD_BROWSER_LIMITS, input: zodToJsonSchema(StandardBrowserInvocation, options), tools }, null, 2)}\n`;
const path = resolve(import.meta.dirname, '../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_browser_schema.json');

if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== content) throw new Error('standard browser schema stale');
} else {
  writeFileSync(path, content);
}
