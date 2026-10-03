#!/usr/bin/env node
// Build-time dependency only. Runtime bundle contains source-owned consumers.
const path=require('node:path');
const {createRequire}=require('node:module');
const esbuild=require(createRequire(require.resolve('tsx')).resolve('esbuild'));
const root=path.resolve(__dirname,'../..');
esbuild.buildSync({entryPoints:[path.join(root,'packages/cloud-deploy/src/cn-maintenance-host/entry.ts')],outfile:path.join(root,'.harness/scripts/vm/cn-maintenance-host-controller.cjs'),bundle:true,platform:'node',format:'cjs',target:'node20',legalComments:'none',banner:{js:'// Generated from packages/cloud-deploy/src/cn-maintenance-host/entry.ts. Source-bound tool artifact; READY=false.'}});
