/** Compiled by API typecheck: dispatch rejects incomplete/unknown worker messages. */
import type { WorkerValidationInput } from '../../src/infrastructure/whiteboard/update-validator-input';
function checkedDispatch(send: (input: WorkerValidationInput) => void): void {
  send({ mode: 'commands', snapshot: new Uint8Array(), commands: [] });
  send({ mode: 'update', snapshot: new Uint8Array(), update: new Uint8Array() });
  // @ts-expect-error A command payload cannot omit its commands.
  send({ mode: 'commands', snapshot: new Uint8Array() });
  // @ts-expect-error A document update cannot omit its update bytes.
  send({ mode: 'update', snapshot: new Uint8Array() });
  // @ts-expect-error Undeclared operations cannot cross the worker boundary.
  send({ mode: 'unknown-operation', snapshot: new Uint8Array() });
}
void checkedDispatch;
