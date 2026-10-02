This offline parser bundles the complete parse implementation from Eemeli Aro's yaml 2.9.0, licensed under ISC (see LICENSE). The official npm archive was verified against the exact SHA-512 integrity in pnpm-lock.yaml. manifest.json records upstream archive, dist source, license, generator and output hashes.

Runtime imports only relative files and Node built-ins. No package install, NODE_PATH or network is required. The small require adapter permits only upstream process/buffer Node built-ins and rejects all other external module names.

Reproduce using the repository's installed yaml 2.9.0 and esbuild 0.28.1: `node .harness/scripts/vendor-yaml-parser.mjs --verify`. Update deliberately with `--generate`; the version, lock integrity, dist source and license must first match the reviewed manifest. `cn-offline-yaml.test.ts` mechanically checks regeneration and YAML semantics, and the frozen CLI suite runs from a clean temporary runtime without node_modules.
