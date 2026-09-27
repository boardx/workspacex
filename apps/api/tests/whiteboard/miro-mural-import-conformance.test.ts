import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import './import-parser.test';
import './import-service.test';

it('maps both vendor sources through one canonical command and report path', () => {
  const source = readFileSync(new URL('../../src/application/whiteboard/import-service.ts', import.meta.url), 'utf8');
  expect(source).toContain('mapImportedBoard');
  expect(source).toContain('WhiteboardImportReport');
  expect(source).toContain('writeCommands');
});
