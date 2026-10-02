import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function needsWebBrowser(plan) {
  if (!Array.isArray(plan.tasks)) throw new Error('Turbo dry-run tasks are required');
  return plan.tasks.some(task => task.taskId === 'web#test');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const selected = needsWebBrowser(JSON.parse(readFileSync(0, 'utf8')));
  process.stdout.write(`web_test=${selected}\n`);
}
