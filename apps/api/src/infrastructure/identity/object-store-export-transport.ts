/**
 * The default `ExportTransport` (F17): move one approved artifact's bytes to the target
 * organization's key space.
 *
 * ## What it does, and the deployment fact that makes that enough
 *
 * In phase-00 both organizations live in the SAME deployment and the same object store, so
 * the move is a read plus a write-once inside that store. **Nothing leaves the machine on
 * this path** -- which is exactly what the aperture ledger shows when the DB-backed export
 * tests run, and that absence is itself an assertion worth having: the ordinary export does
 * not egress, so any permit in the ledger during ordinary work would be a finding.
 *
 * ## Why it is nevertheless called inside the aperture
 *
 * Because the seam is the point. The moment a target organization lives in another
 * deployment, THIS is the method that opens a socket, and its author inherits the approval
 * check rather than having to remember it. A transport wired outside `aperture.send` would
 * be a transport the guard has no opinion about, and it would look identical today.
 *
 * ## Refuses to invent bytes
 *
 * A missing source object throws. The alternative -- writing a zero-length object, or
 * skipping the version -- produces a copy that exists, passes every row-level assertion, and
 * is empty. `size_bytes > 0` in the schema exists for the same reason: the shape a failed
 * materialization takes when nobody checks is a file of length zero.
 */
import type { ObjectStore } from "../../application/artifact/ports";
import { ObjectExistsError } from "../../application/artifact/ports";
import type { ExportTransport } from "../../application/identity/local-org-ports";

export class ObjectStoreExportTransport implements ExportTransport {
  constructor(private readonly store: ObjectStore) {}

  async push(input: {
    readonly artifactId: string;
    readonly toOrgId: string;
    readonly sourceObjectKey: string;
    readonly targetObjectKey: string;
    readonly mime: string;
  }): Promise<void> {
    const bytes = await this.store.get(input.sourceObjectKey);
    if (bytes === null) {
      throw new Error(
        `export source object missing at ${input.sourceObjectKey} -- refusing to create an empty copy`,
      );
    }
    try {
      await this.store.putOnce(input.targetObjectKey, bytes, input.mime);
    } catch (e) {
      // The target key is minted from two fresh uuids in this very request, so a collision
      // is not a retry of the same export -- it is an id collision, and continuing would
      // mean this export's row points at somebody else's bytes.
      if (e instanceof ObjectExistsError) {
        throw new Error(`export target key ${input.targetObjectKey} was already taken`);
      }
      throw e;
    }
  }
}
