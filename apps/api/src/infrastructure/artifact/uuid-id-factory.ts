/**
 * The production `IdFactory`.
 *
 * Prefixed UUIDs rather than bare ones. Ids appear in object storage keys, in
 * `acl_bindings.object_id` and in provenance targets, and in all three places a bare UUID
 * tells a reader nothing about what it names -- while a mis-typed id (a version id passed
 * where an artifact id was wanted) is a silent lookup miss rather than an error.
 */
import { randomUUID } from "node:crypto";
import type { IdFactory } from "../../application/artifact/ports";

export class UuidIdFactory implements IdFactory {
  next(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }
}
