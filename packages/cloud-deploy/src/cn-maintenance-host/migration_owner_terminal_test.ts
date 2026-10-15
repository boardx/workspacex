import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {terminalFixture as fixture} from './migration_owner_terminal_test_fixture';
import {verifyOwnerTerminal,recordPublicTransport} from './migration_owner_terminal';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
test('reuses original native completion and public validators, returns raw evidence digests only',async()=>{const f=fixture(),result=await f.run();assert.equal(result.epochSha256,f.value.epoch.sha256);assert.equal('accepted'in result,false);});
test('serialized authority cannot validate a terminal document',async()=>{const f=fixture(),raw=Buffer.from(JSON.stringify(f.value));await assert.rejects(verifyOwnerTerminal({...f.f.authority},raw,sha(raw),f.binding,f.f.release,f.read,f.now));});
test('raw substitution fails independent digest',async()=>{const f=fixture(),raw=Buffer.from(JSON.stringify(f.value));await assert.rejects(verifyOwnerTerminal(f.f.authority,raw,'0'.repeat(64),f.binding,f.f.release,f.read,f.now),/RAW_PIN/);});
test('failed browser check is rejected by the existing browser schema',async()=>{const f=fixture();(f.value.publicTranscript[2]!.value as {pdfDownload:boolean}).pdfDownload=false;await assert.rejects(f.run());});
test('missing, reordered or trailing transcript cannot stand for original reads',async()=>{for(const mode of ['missing','reorder','trailing']){const f=fixture();if(mode==='missing')f.value.publicTranscript.pop();if(mode==='reorder')f.value.publicTranscript.reverse();if(mode==='trailing')f.value.publicTranscript.push(f.value.publicTranscript[0]!);await assert.rejects(f.run());}});
test('changed source evidence is rejected independently of terminal raw hash',async()=>{const f=fixture();f.files.set(f.value.completion.path,Buffer.from('{}'));await assert.rejects(f.run(),/EVIDENCE_PIN/);});
test('actual rejected transport call appends no event',async()=>{const reject=async()=>{throw Error('actual failure');};const recorded=recordPublicTransport({readPublicIdentity:reject,verifyCanonical:reject,runBrowserSmoke:reject,readObservation:reject});await assert.rejects(recorded.transport.verifyCanonical(),/actual failure/);assert.deepEqual(recorded.snapshot(),[]);});

test('clear CAS mismatch cannot be replaced by a valid browser transcript',async()=>{const f=fixture();f.value.holdCas.readback.generation='0'.repeat(32);await assert.rejects(f.run(),/HOLD_CAS/);});
test('original canonical and browser receipts are required, not transcript summaries',async()=>{
 const f=fixture();delete (f.value as Partial<typeof f.value>).publicReceipts;await assert.rejects(f.run());
});
test('canonical/browser raw receipts must use the exact attempt and lane paths',async()=>{
 for(const lane of ['canonical','browser'] as const){const f=fixture();f.value.publicReceipts[lane].path='/etc/workspacex-cn/another-attempt/'+lane+'.json';await assert.rejects(f.run(),/PUBLIC_RECEIPT_PATH/);}
});
test('valid checks in transcript cannot hide changed original receipt bytes',async()=>{
 for(const lane of ['canonical','browser'] as const){const f=fixture();f.files.set(f.value.publicReceipts[lane].path,Buffer.from('{}'));await assert.rejects(f.run(),/EVIDENCE_PIN/);}
});
test('rehashing a foreign receipt does not bypass original identity binding',async()=>{
 const f=fixture(),ref=f.value.publicReceipts.browser,foreign=JSON.parse(f.files.get(ref.path)!.toString());foreign.identity.attemptId='foreign';const raw=Buffer.from(JSON.stringify(foreign));f.files.set(ref.path,raw);ref.sha256=sha(raw);await assert.rejects(f.run(),/RECEIPT_BINDING/);
});
test('rehashing different receipt checks cannot override recorded actual transport return',async()=>{
 const f=fixture(),ref=f.value.publicReceipts.browser,changed=JSON.parse(f.files.get(ref.path)!.toString());changed.checks.pdfDownload=false;const raw=Buffer.from(JSON.stringify(changed));f.files.set(ref.path,raw);ref.sha256=sha(raw);await assert.rejects(f.run(),/BROWSER_RECEIPT/);
});
test('original acceptance receipt change during final reread rejects terminal',async()=>{
 const f=fixture(),raw=Buffer.from(JSON.stringify(f.value));let reads=0;
 const read=(path:string)=>{if(path===f.value.publicReceipts.canonical.path&&++reads===2)return Buffer.from('{}');return f.read(path);};
 await assert.rejects(verifyOwnerTerminal(f.f.authority,raw,sha(raw),f.binding,f.f.release,read,f.now),/EVIDENCE_CHANGED/);
});
