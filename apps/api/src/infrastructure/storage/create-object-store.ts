import type { ObjectStore } from "../../application/artifact/ports";
import type { PhysicalPurgePort } from "../../application/files/physical-delete-ports";
import { FsPhysicalPurge } from "./fs-physical-purge";
import { FsObjectStore } from "./fs-object-store";
import { objectStoreRoot } from "./object-store-root";
import { objectStoreConfig } from "./object-store-config";
import { OssObjectStore, OssPhysicalPurge } from "./oss-object-store";
import { createOssSdkClient } from "./oss-sdk-client";

export async function createStorageBackends(env: NodeJS.ProcessEnv = process.env): Promise<StorageBackends> {
  const config = objectStoreConfig(env);
  if (config.backend === "fs") {
    const root = config.root ?? objectStoreRoot();
    return { objects: new FsObjectStore(root), purge: new FsPhysicalPurge(root) };
  }
  const client = await createOssSdkClient(config.oss, env);
  const store = new OssObjectStore(client, config.oss.bucket, config.oss.prefix);
  await store.assertReady();
  return { objects: store, purge: new OssPhysicalPurge(client, config.oss.bucket, config.oss.prefix) };
}

export interface StorageBackends { objects: ObjectStore; purge: PhysicalPurgePort; }

export async function createObjectStore(env: NodeJS.ProcessEnv = process.env): Promise<ObjectStore> {
  return (await createStorageBackends(env)).objects;
}
