import { afterEach, expect, it, vi } from 'vitest';
import { SharedStage } from '@repo/contracts/aidt-stages';
import { aidtContextCanonicalJson } from '@repo/contracts/aidt-run-context';
import * as projector from '../../src/application/aidt-run-context/summary-excerpt';
import { readAidtAuditFieldVisibility, verifyAidtAuditExcerpt } from './audit-saved-excerpt';

function row() {
  return SharedStage.parse({projectId:'p',stageId:6,revision:7,updatedBy:'student',updatedAt:'2026-11-16T00:00:00Z',sourceStageRevisions:[{stageId:5,revision:4}],content:{schemaVersion:1,draft:{fields:{returnStep:'5',returnReason:'当前回到原型；旧轮次补访仍保留',questionSnapshot:JSON.stringify({question:'怎样理解先取号？',beforeTestBelief:'本来以为大家都懂',prototypeVersionId:'actual-v1',sourceStageRevision:4}),iterationPrototypeReference:JSON.stringify({designId:'actual-design',versionId:'actual-v2'}),feedback:'长材料😀\\"\n'.repeat(300),verificationQuestionConfirmation:'重复指纹不是独立新证据'},ideas:[{id:'idea-1',title:'学生点子',description:'学生说明'}],selectedIdeaId:'idea-1'}}});
}
const payload = (stage: ReturnType<typeof row>) => ({draft:stage.content.draft,sourceStageRevisions:stage.sourceStageRevisions});
afterEach(()=>vi.restoreAllMocks());

it('keeps old raw canonical full/prefix snapshots auditable without rewriting saved or projected bytes',()=>{
  const stage=row(), full=aidtContextCanonicalJson(payload(stage)), before=aidtContextCanonicalJson(stage);
  expect(verifyAidtAuditExcerpt({stage,excerpt:full,truncated:false,purpose:'summary'}).format).toBe('raw-canonical-prefix');
  expect(verifyAidtAuditExcerpt({stage,excerpt:full.slice(0,50),truncated:true,purpose:'stage'}).format).toBe('raw-canonical-prefix');
  expect(()=>verifyAidtAuditExcerpt({stage,excerpt:full.slice(0,50),truncated:false,purpose:'summary'})).toThrow('TRUNCATION_MISMATCH');
  expect(aidtContextCanonicalJson(stage)).toBe(before);
});

it.each([120,180,250,500,1200,5000])('rebuilds actual bounded SUM projections at cap %i and independently checks saved leaves',cap=>{
  const stage=row(), projection=projector.projectAidtSummaryExcerpt(stage,cap);
  const result=verifyAidtAuditExcerpt({stage,excerpt:projection.excerpt,truncated:true,purpose:'summary'});
  expect(result.format).toBe('summary-field-projection');
  expect(result.independentlyCheckedLeaves).toBeGreaterThanOrEqual(0);
  const parsed=JSON.parse(projection.excerpt);
  if(parsed.draft?.fields?.feedback!==undefined)expect(stage.content.draft.fields.feedback!.startsWith(parsed.draft.fields.feedback)).toBe(true);
});

it('checks actual old/current teaching values and JSON-expanded V2 references rather than only matching a shared formatter',()=>{
  const stage=row(), projection=projector.projectAidtSummaryExcerpt(stage,5000), parsed=JSON.parse(projection.excerpt);
  expect(parsed.draft.fields.returnStep).toBe('5');
  expect(parsed.draft.fields.iterationPrototypeReference.versionId).toBe('actual-v2');
  expect(parsed.draft.fields.questionSnapshot.prototypeVersionId).toBe('actual-v1');
  expect(parsed.draft.fields.verificationQuestionConfirmation).toBeUndefined();
  const old=row();old.revision=4;old.content.draft.fields.returnStep='2';old.content.draft.fields.returnReason='旧轮次回共情补访';
  const historical=projector.projectAidtSummaryExcerpt(old,1200).excerpt;
  expect(JSON.parse(historical).draft.fields.returnStep).toBe('2');
  expect(JSON.parse(historical).draft.fields.returnReason).toBe('旧轮次回共情补访');
  expect(()=>verifyAidtAuditExcerpt({stage,excerpt:historical,truncated:true,purpose:'summary'})).toThrow('VALUE_NOT_SAVED_PREFIX');
});

it.each(['invented-value','invented-field','invented-root','invented-array-path'] as const)('rejects %s even if the production formatter were to repeat the same wrong value',kind=>{
  const stage=row(), projected=projector.projectAidtSummaryExcerpt(stage,5000), parsed=JSON.parse(projected.excerpt);
  if(kind==='invented-value')parsed.draft.fields.returnStep='2';
  if(kind==='invented-field')parsed.draft.fields.notSaved='invented';
  if(kind==='invented-root')parsed.otherGroup='private';
  if(kind==='invented-array-path')parsed.draft.ideas={length:1};
  const forged=JSON.stringify(parsed);
  vi.spyOn(projector,'projectAidtSummaryExcerpt').mockReturnValue({...projected,excerpt:forged});
  expect(()=>verifyAidtAuditExcerpt({stage,excerpt:forged,truncated:true,purpose:'summary'})).toThrow(/AUDIT_PROJECTED_/);
});

it('accepts only true saved string prefixes for partial fields and reports the partial path',()=>{
  const stage=row(), projected=projector.projectAidtSummaryExcerpt(stage,1200);
  const checked=verifyAidtAuditExcerpt({stage,excerpt:projected.excerpt,truncated:true,purpose:'summary'});
  expect(checked.partialPaths).toContain('draft.fields.feedback');
  const parsed=JSON.parse(projected.excerpt);parsed.draft.fields.feedback+=' fabricated ending';
  const forged=JSON.stringify(parsed);vi.spyOn(projector,'projectAidtSummaryExcerpt').mockReturnValue({...projected,excerpt:forged});
  expect(()=>verifyAidtAuditExcerpt({stage,excerpt:forged,truncated:true,purpose:'summary'})).toThrow('VALUE_NOT_SAVED_PREFIX');
});

it('reports expanded reference values separately from raw encoded-string visibility',()=>{
  const stage=row(), projected=projector.projectAidtSummaryExcerpt(stage,1200).excerpt;
  const checked=verifyAidtAuditExcerpt({stage,excerpt:projected,truncated:true,purpose:'summary'});
  const reference=readAidtAuditFieldVisibility(stage,projected,'iterationPrototypeReference',checked.format);
  expect(reference).toMatchObject({savedFieldExists:true,fieldRepresentation:'expanded-json-reference',fieldStartVisible:true,entireSavedValueVisible:true,entireEncodedFieldVisible:false,encodedFieldCharactersVisible:null});
  expect(readAidtAuditFieldVisibility(stage,projected,'feedback',checked.format)).toMatchObject({fieldStartVisible:true,entireSavedValueVisible:false});
  expect(readAidtAuditFieldVisibility(stage,projected,'verificationQuestionConfirmation',checked.format)).toMatchObject({savedFieldExists:true,fieldStartVisible:false,entireSavedValueVisible:false});
  expect(readAidtAuditFieldVisibility(stage,projected,'nonexistent',checked.format)).toEqual({savedFieldExists:false});
});

it('keeps malformed JSON verbatim and preserves ordinary raw-string visibility accounting',()=>{
  const stage=row();stage.content.draft.fields.questionSnapshot='{malformed student reference';
  const excerpt=projector.projectAidtSummaryExcerpt(stage,5000).excerpt;
  expect(JSON.parse(excerpt).draft.fields.questionSnapshot).toBe(stage.content.draft.fields.questionSnapshot);
  expect(()=>verifyAidtAuditExcerpt({stage,excerpt,truncated:true,purpose:'summary'})).not.toThrow();
  const full=aidtContextCanonicalJson(payload(stage));
  expect(readAidtAuditFieldVisibility(stage,full,'questionSnapshot','raw-canonical-prefix')).toMatchObject({entireSavedValueVisible:true,entireEncodedFieldVisible:true});
});

it('rejects summary projections in ordinary stage/return scope and refuses unmarked truncation or changed raw bytes',()=>{
  const stage=row(), excerpt=projector.projectAidtSummaryExcerpt(stage,1200).excerpt;
  expect(()=>verifyAidtAuditExcerpt({stage,excerpt,truncated:true,purpose:'stage'})).toThrow('SCOPE_MISMATCH');
  expect(()=>verifyAidtAuditExcerpt({stage,excerpt,truncated:false,purpose:'summary'})).toThrow('SCOPE_MISMATCH');
  const reflection={fields:{returnStep:'2'},trust:'untrusted-student-material'},raw=aidtContextCanonicalJson(reflection);
  expect(verifyAidtAuditExcerpt({stage,excerpt:raw,truncated:false,purpose:'stage',payload:reflection}).format).toBe('raw-canonical-prefix');
  expect(()=>verifyAidtAuditExcerpt({stage,excerpt:raw.replace('"2"','"1"'),truncated:false,purpose:'stage',payload:reflection})).toThrow();
});
