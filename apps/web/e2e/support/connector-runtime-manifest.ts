import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sha256} from '../board-runtime-evidence';
import {apiOrigin} from '../board-acceptance-support';

// The reviewed shared producer supplies the single runtime verifier implementation.
const verifierDigest='a4583b4b4e5a60f8fde66e37c2eb1089668f889a568c2bf1db9f8ba13e6728e6';
const root=resolve(__dirname,'../../../..');
type Manifest={ready:boolean;head:string;startedAt:string;deploymentMarker:string;sourceFiles:string[];sourceHashes:Record<string,string>};
type Verifier={listRuntimeSourceFiles(root:string):string[];verifyRuntimeManifest(input:{manifestPath:string;root:string;base:string;origin:string;sourceFiles:string[]}):unknown};
let firstManifestSha256:string|undefined;

export async function verifyConnectorRuntimeManifest(previous?:{manifestSha256:string;verifierSha256:string;proof:unknown}){
 const manifestPath=process.env.BOARD_CONNECTOR_RUNTIME_MANIFEST,verifierPath=process.env.BOARD_CONNECTOR_RUNTIME_VERIFIER,base=process.env.BOARD_CONNECTOR_WEB_URL;
 assert(manifestPath&&verifierPath&&base,'Explicit source-bound runtime manifest and verifier are mandatory');
 assert.equal(sha256(await readFile(verifierPath)),verifierDigest,'Unreviewed runtime verifier cannot satisfy acceptance');
 const manifestBytes=await readFile(manifestPath),manifest=JSON.parse(manifestBytes.toString('utf8')) as Manifest;
 assert.equal(manifest.ready,true,'Runtime producer must attest readiness');assert.match(manifest.head,/^[a-f0-9]{40}$/);
 assert.equal(manifest.head,process.env.BOARD_ACCEPTANCE_SHA,'Exact runtime source must be explicitly requested');
 assert.equal(manifest.deploymentMarker,process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER);assert.match(manifest.deploymentMarker,/^[a-f0-9-]{36}$/);
 assert(Number.isFinite(Date.parse(manifest.startedAt)));assert.equal(manifest.startedAt,process.env.BOARD_ACCEPTANCE_RUNTIME_STARTED_AT);
 const manifestSha256=sha256(manifestBytes);if(firstManifestSha256)assert.equal(manifestSha256,firstManifestSha256,'Runtime startup attestation changed during acceptance');else firstManifestSha256=manifestSha256;
 assert(Array.isArray(manifest.sourceFiles)&&manifest.sourceFiles.length>0);assert.equal(new Set(manifest.sourceFiles).size,manifest.sourceFiles.length);
 for(const path of manifest.sourceFiles)assert(typeof path==='string'&&path&&!path.startsWith('/')&&!path.split('/').includes('..'),'Manifest paths must be candidate-relative');
 assert.deepEqual(Object.keys(manifest.sourceHashes).sort(),[...manifest.sourceFiles].sort(),'Cannot select a subset of startup source hashes');
 const verifier=await import(pathToFileURL(await realpath(verifierPath)).href) as Verifier;assert.equal(typeof verifier.verifyRuntimeManifest,'function');
 assert.equal(typeof verifier.listRuntimeSourceFiles,'function');
 const required=verifier.listRuntimeSourceFiles(root);assert(required.length>100,'Full tracked runtime/test closure is required');
 const proof=verifier.verifyRuntimeManifest({manifestPath,root,base,origin:apiOrigin(),sourceFiles:manifest.sourceFiles});
 if(previous){assert.equal(manifestSha256,previous.manifestSha256,'Case startup manifest changed');assert.equal(verifierDigest,previous.verifierSha256);assert.deepEqual(proof,previous.proof,'Case runtime process/source identity changed');}
 assert.equal(sha256(await readFile(verifierPath)),verifierDigest,'Verifier changed while checking runtime');assert.deepEqual(await readFile(manifestPath),manifestBytes,'Startup manifest changed while checking runtime');
 return{manifestSha256,verifierSha256:verifierDigest,requiredSourceCount:required.length,sourceCount:manifest.sourceFiles.length,proof};
}
