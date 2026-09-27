import {describe,expect,it} from 'vitest';
import {BOARD_ACCEPTANCE_RUBRIC,evaluateBoardAcceptance,type BoardLaneEvidence} from '@/lib/board-acceptance-rubric';
const sha='a'.repeat(40),row=(lane:BoardLaneEvidence['lane']):BoardLaneEvidence=>({lane,sha,command:`verify ${lane}`,startedAt:'2026-09-27T00:00:00.000Z',endedAt:'2026-09-27T00:01:00.000Z',exitCode:0,environment:'ci',artifactSha256:'b'.repeat(64),counterproof:true});
describe('Board nine point rubric',()=>{
  it('requires every production lane on one exact SHA with a counterproof',()=>{const rows=BOARD_ACCEPTANCE_RUBRIC.requiredLanes.map(row);expect(evaluateBoardAcceptance(sha,rows)).toEqual({approved:true,score:9,failures:[]});for(const omitted of BOARD_ACCEPTANCE_RUBRIC.requiredLanes){const result=evaluateBoardAcceptance(sha,rows.filter(value=>value.lane!==omitted));expect(result.approved).toBe(false);expect(result.score).toBeNull();expect(result.failures).toContain(`MISSING:${omitted}`);}});
  it('never rounds partial evidence up to nine',()=>{const rows=BOARD_ACCEPTANCE_RUBRIC.requiredLanes.map(row);rows[0]={...rows[0]!,sha:'c'.repeat(40)};rows[1]={...rows[1]!,counterproof:false};expect(evaluateBoardAcceptance(sha,rows)).toMatchObject({approved:false,score:null,failures:['SHA_MISMATCH:journeys','NO_COUNTERPROOF:performance-1k']});});
});
