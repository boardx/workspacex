import {expect} from 'vitest';
import {EventType} from '@ag-ui/core';
import {AGUI_EXECUTION_EVENT_NAME,ExecutionEvent} from '@repo/contracts/execution-journal';
/** Validate the new journal independently; unknown CUSTOM events remain in old assertions. */
export function withoutExecutionJournal<T extends {type:unknown;name?:unknown;value?:unknown}>(events:readonly T[]):T[]{
 const journal=events.filter(e=>e.type===EventType.CUSTOM&&e.name===AGUI_EXECUTION_EVENT_NAME).map(e=>ExecutionEvent.parse(e.value));
 expect(journal.length).toBeGreaterThan(0);expect(new Set(journal.map(e=>e.runId)).size).toBe(1);
 for(let i=1;i<journal.length;i++)expect(journal[i]!.seq).toBeGreaterThan(journal[i-1]!.seq);
 expect(journal.some(e=>e.kind==='status'&&e.status==='succeeded')).toBe(true);
 return events.filter(e=>!(e.type===EventType.CUSTOM&&e.name===AGUI_EXECUTION_EVENT_NAME));
}
