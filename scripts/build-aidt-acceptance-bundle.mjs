/** Produce an explicitly allowlisted, credential-free control-plane bundle for the Dev host. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, lstatSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { acceptanceProfile, V2_VOICE_PROFILE } from '../apps/web/e2e/support/devapp-aidt-v2-profile.mjs';

export const BASELINE_BUNDLE_FILES = Object.freeze([
  '.nvmrc',
  'apps/web/e2e/support/devapp-aidt-auth-readonly.mjs',
  'apps/web/e2e/support/devapp-aidt-acceptance-guard.mjs',
  'apps/web/e2e/support/devapp-aidt-survey.mjs',
  'apps/web/e2e/support/devapp-aidt-acceptance.mjs',
  'apps/web/e2e/support/devapp-aidt-entry-proof.mjs',
  'apps/web/e2e/support/devapp-aidt-journey.mjs',
  'apps/web/e2e/support/devapp-aidt-print-evidence.mjs',
  'apps/web/e2e/support/devapp-aidt-chat-evidence.mjs',
  'apps/web/e2e/support/devapp-aidt-qa-identity.mjs',
  'apps/web/e2e/support/devapp-aidt-agent-review.mjs',
  'scripts/image-release-host-permissions.py',
]);
// These helpers contain no product implementation, credentials, storage state or traces.
export const V2_CONTROL_BUNDLE_FILES = Object.freeze([
  'devapp-aidt-v2-profile.mjs', 'devapp-aidt-v2-plan.mjs', 'devapp-aidt-v2-print.mjs', 'devapp-aidt-v2-request-guard.mjs',
  'devapp-aidt-v2-native-feedback.mjs', 'devapp-aidt-v2-action-window.mjs', 'devapp-aidt-v2-ui.mjs', 'devapp-aidt-v2-crud-model.mjs', 'devapp-aidt-v2-crud.mjs', 'devapp-aidt-v2-definition.mjs',
  'devapp-aidt-v2-design.mjs', 'devapp-aidt-v2-research.mjs', 'devapp-aidt-v2-s1.mjs', 'devapp-aidt-v2-s2.mjs',
  'devapp-aidt-v2-s3.mjs', 'devapp-aidt-v2-s4.mjs', 'devapp-aidt-v2-s5.mjs', 'devapp-aidt-v2-s6.mjs',
  'devapp-aidt-v2-negative-candidates.mjs', 'devapp-aidt-v2-negative-dialogs.mjs', 'devapp-aidt-v2-negative-service.mjs',
  'devapp-aidt-v2-asr.mjs', 'devapp-aidt-v2-asr-review.mjs', 'devapp-aidt-v2-s2-asr.mjs', 'devapp-aidt-v2-cases.mjs', 'devapp-aidt-v2-report.mjs', 'devapp-aidt-v2-journey.mjs',
].map(file => 'apps/web/e2e/support/' + file));
export const V2_PERSONA_CATALOGUE_PATH = 'apps/web/lib/interview-personas/experts-persona.json';
export const V2_FIXTURE_BUNDLE_FILES = Object.freeze(['apps/web/e2e/fixtures/aidt-v2/synthetic-prototype-test.wav', 'apps/web/e2e/fixtures/aidt-v2/synthetic-prototype-test.txt', 'apps/web/e2e/fixtures/aidt-v2/README.md']);
/** The baseline importer now sees profile dispatch imports; it therefore also needs these safe files. */
export const V2_DISPATCH_BUNDLE_FILES = Object.freeze([
  'devapp-aidt-v2-profile.mjs', 'devapp-aidt-v2-plan.mjs', 'devapp-aidt-v2-print.mjs', 'devapp-aidt-v2-request-guard.mjs', 'devapp-aidt-v2-native-feedback.mjs', 'devapp-aidt-v2-action-window.mjs',
].map(file => 'apps/web/e2e/support/' + file));
export function candidateActionsFromSource(source) {
  const block = source.match(/export const AIDT_CANDIDATE_ACTIONS = \{([\s\S]*?)\} as const;/)?.[1];
  const pairs = [...(block ?? '').matchAll(/^\s*([a-z]+):\s*"(\[AIDT:[A-Z:-]+:[0-9]+\])",?\s*$/gm)].map(match => [match[1], match[2]]);
  const expected = ['problem','ideation','prototype','test','interview','persona','hmw'];
  if (!block || pairs.length !== expected.length || new Set(pairs.map(([key]) => key)).size !== expected.length
      || pairs.some(([key]) => !expected.includes(key)) || new Set(pairs.map(([,value]) => value)).size !== expected.length) throw new Error('CANDIDATE_ACTION_VOCABULARY_INVALID');
  return Object.fromEntries(pairs);
}
export async function buildAcceptanceBundle(root, env = process.env) {
  const sha = env.GITHUB_SHA, profile = acceptanceProfile(env);
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || typeof root !== 'string' || !root) throw new Error('BUNDLE_ARGUMENTS_INVALID');
  root = resolve(root); mkdirSync(root, { recursive: true, mode: 0o700 });
  const files = [...new Set([...BASELINE_BUNDLE_FILES, ...(profile === V2_VOICE_PROFILE ? [...V2_CONTROL_BUNDLE_FILES,...V2_FIXTURE_BUNDLE_FILES,V2_PERSONA_CATALOGUE_PATH] : V2_DISPATCH_BUNDLE_FILES)])];
  const importer = readFileSync('pnpm-lock.yaml', 'utf8').split('\n  apps/web:\n')[1]?.split('\n  apps/')[0];
  const playwright = importer?.match(/\n      '@playwright\/test':\n        specifier: [^\n]+\n        version: (\d+\.\d+\.\d+)\n/)?.[1];
  if (!playwright) throw new Error('PLAYWRIGHT_LOCK_VERSION_MISSING');
  const source = readFileSync('packages/contracts/src/aidt-run-context.ts', 'utf8');
  const identities = source.match(/export const AIDT_STAGE_IDENTITIES = \[([\s\S]*?)\] as const;/)?.[1];
  const names = [...(identities ?? '').matchAll(/skill: "([a-z][a-z0-9-]+)"/g)].map(match => match[1]);
  const summary = source.match(/export const AIDT_SUMMARY_STABLE_NAME = "([a-z][a-z0-9-]+)";/)?.[1];
  if (names.length !== 6 || new Set(names).size !== 6 || !summary) throw new Error('CANONICAL_SKILL_NAMES_INVALID');
  let profileMetadata = {};
  if (profile === V2_VOICE_PROFILE) {
    const candidateActions = candidateActionsFromSource(readFileSync('packages/contracts/src/aidt-candidate-request.ts', 'utf8'));
    const { createV2VoicePlan } = await import('../apps/web/e2e/support/devapp-aidt-v2-plan.mjs');
    const plan = createV2VoicePlan();
    const audioPath=V2_FIXTURE_BUNDLE_FILES[0],audioInfo=lstatSync(audioPath);
    if(!audioInfo.isFile()||audioInfo.isSymbolicLink()||audioInfo.size<44||audioInfo.size>262144)throw new Error('V2_SYNTHETIC_AUDIO_FIXTURE_BOUND');
    const audio=readFileSync(audioPath);if(audio.subarray(0,4).toString()!=='RIFF'||audio.subarray(8,12).toString()!=='WAVE')throw new Error('V2_SYNTHETIC_AUDIO_FIXTURE_INVALID');
    const groundtruthPath=V2_FIXTURE_BUNDLE_FILES[1],groundtruthInfo=lstatSync(groundtruthPath);if(!groundtruthInfo.isFile()||groundtruthInfo.isSymbolicLink()||groundtruthInfo.size<10||groundtruthInfo.size>16384)throw new Error('V2_SYNTHETIC_GROUNDTRUTH_BOUND');const groundtruth=readFileSync(groundtruthPath);
    const catalogueInfo=lstatSync(V2_PERSONA_CATALOGUE_PATH);if(!catalogueInfo.isFile()||catalogueInfo.isSymbolicLink()||catalogueInfo.size<1||catalogueInfo.size>1048576)throw new Error('V2_PERSONA_CATALOGUE_BOUND');const catalogue=readFileSync(V2_PERSONA_CATALOGUE_PATH);JSON.parse(catalogue.toString('utf8'));
    profileMetadata = { personaCatalogue:{path:V2_PERSONA_CATALOGUE_PATH,bytes:catalogue.length,sha256:createHash('sha256').update(catalogue).digest('hex')}, candidateActions, planManifestSha256: plan.manifestSha256, planLimits: plan.limits, syntheticAudioFixture:{path:audioPath,bytes:audio.length,sha256:createHash('sha256').update(audio).digest('hex'),mime:'audio/wav',synthetic:true,groundtruthSentToModel:false,groundtruth:{path:groundtruthPath,bytes:groundtruth.length,sha256:createHash('sha256').update(groundtruth).digest('hex')}} };
  }
  for (const file of files) {
    const info = lstatSync(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) throw new Error('BUNDLE_FILE_INVALID');
    mkdirSync(dirname(resolve(root, file)), { recursive: true, mode: 0o700 }); copyFileSync(file, resolve(root, file));
  }
  const interviewStarter = JSON.parse(readFileSync('skills/aidt-methods/aidt-empathize/starter.json', 'utf8')).initial;
  if (typeof interviewStarter !== 'string' || !interviewStarter.includes('问题') || !interviewStarter.includes('初稿')) throw new Error('INTERVIEW_STARTER_INVALID');
  writeFileSync(resolve(root, 'acceptance-source.json'), JSON.stringify({ controlSource: sha, profile, interviewStarter, teachingSkillNames: [...names, summary], playwrightVersion: playwright, ...profileMetadata }));
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { '@playwright/test': playwright, '@actions/artifact': '2.3.2' } }));
  const listed = [...files, 'acceptance-source.json', 'package.json'];
  writeFileSync(resolve(root, 'SHA256SUMS'), listed.map(file => `${createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')}  ${file}`).join('\n') + '\n');
  return { kind: 'aidt-acceptance-bundle', controlSource: sha, profile, fileCount: listed.length, playwrightVersion: playwright };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('BUNDLE_ARGUMENTS_INVALID');
  console.log(JSON.stringify(await buildAcceptanceBundle(process.argv[2])));
}
