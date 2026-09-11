import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
const probe=vi.hoisted(() => ({ events: [] as string[], cancel: undefined as (()=>void)|undefined, failDirectoryOnce: false }));
vi.mock("node:fs/promises", async importOriginal => {
  const real=await importOriginal<typeof import("node:fs/promises")>();
  return { ...real,
    async open(...args: Parameters<typeof real.open>) {
      const handle=await real.open(...args); const directory=(await handle.stat()).isDirectory(); const sync=handle.sync.bind(handle);
      handle.sync=async () => {
        probe.events.push(directory ? "directory-sync" : "file-sync");
        if (directory && probe.failDirectoryOnce) { probe.failDirectoryOnce=false; throw new Error("simulated sync failure"); }
        await sync(); if (!directory) probe.cancel?.();
      };
      return handle;
    },
    async link(...args: Parameters<typeof real.link>) { probe.events.push("publish"); return real.link(...args); },
  };
});
import { ensureDeploymentSecret } from "../src/secrets";
import { runtimeEnvironment } from "../src/runtime-environment";
import { deploymentExample } from "../src/examples";
vi.mock("../src/trusted-path", () => ({ assertTrustedPath: vi.fn() }));
const roots:string[]=[];
async function directory() { const path=await mkdtemp(join(tmpdir(),"secret-durability-")); roots.push(path); return path; }
afterEach(async () => { probe.cancel=undefined; probe.events=[]; probe.failDirectoryOnce=false; await Promise.all(roots.splice(0).map(path => rm(path,{recursive:true,force:true}))); });
it("syncs the published directory entry before returning a usable stable secret", async () => {
  const root=await directory(); const value=await ensureDeploymentSecret(root,"key");
  expect(probe.events).toEqual(["file-sync","publish","directory-sync","directory-sync"]);
  expect(await readFile(join(root,"key"),"utf8")).toBe(value);
});
it("does not return success if the published entry could not be synced", async () => {
  const root=await directory(); probe.failDirectoryOnce=true;
  await expect(ensureDeploymentSecret(root,"key")).rejects.toThrow("sync failure");
  const value=await readFile(join(root,"key"),"utf8");
  expect(await ensureDeploymentSecret(root,"key")).toBe(value);
});
it("cancellation after writing the temporary secret prevents publication and cleans up", async () => {
  const root=await directory(); const controller=new AbortController(); probe.cancel=()=>controller.abort();
  await expect(ensureDeploymentSecret(root,"key",{signal:controller.signal})).rejects.toThrow("SECRET_OPERATION_CANCELLED");
  expect(probe.events).not.toContain("publish"); expect(await readdir(root)).toEqual([]);
});
it("runtime generation propagates cancellation to all eight key publishers", async () => {
  const root=await directory(); const controller=new AbortController(); probe.cancel=()=>controller.abort();
  await expect(runtimeEnvironment(deploymentExample("starter"),root,{WORKSPACEX_MODEL_KEY:"fixture"},{signal:controller.signal})).rejects.toThrow("SECRET_OPERATION_CANCELLED");
  expect(probe.events).not.toContain("publish"); expect(await readdir(root)).toEqual([]);
});
