import type { Provider } from "@nestjs/common";
import { OBJECT_STORE } from "../../application/artifact/ports";
import { PHYSICAL_PURGE_PORT } from "../../application/files/physical-delete-ports";
import { createStorageBackends, type StorageBackends } from "./create-object-store";

const STORAGE_BACKENDS = Symbol("StorageBackends");
/** One backend selection for both ports; a cloud store can never get an FS purge peer. */
export const storageProviders: Provider[] = [
  { provide: STORAGE_BACKENDS, useFactory: () => createStorageBackends() },
  { provide: OBJECT_STORE, useFactory: (s: StorageBackends) => s.objects, inject: [STORAGE_BACKENDS] },
  { provide: PHYSICAL_PURGE_PORT, useFactory: (s: StorageBackends) => s.purge, inject: [STORAGE_BACKENDS] },
];
