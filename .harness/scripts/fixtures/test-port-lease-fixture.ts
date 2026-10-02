import { acquireTestPortLease } from "../lib/test-port-lease";

const lease = acquireTestPortLease(Number(process.argv[3]), process.argv[2]!);
process.send?.({ held: lease !== null });
if (lease) {
  process.once("message", () => {
    lease.release();
    process.disconnect();
  });
} else {
  process.disconnect();
}
