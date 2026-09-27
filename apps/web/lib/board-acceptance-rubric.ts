export const BOARD_ACCEPTANCE_RUBRIC={
  version:1,
  journeys:['brainstorm','organize','panel','diagram','visual-research','ai-ready'] as const,
  metrics:{ttfiMs:5000,tenStickiesMs:30000,organizeActions:2,connectionActions:2,screenshotPasteActions:1,aiClusterActions:2},
  performance:{objectCounts:[1000,5000,10000] as const,requiredMeasurements:['coldRenderMs','warmRenderMs','viewportP95Ms','selectionP95Ms','convergenceP95Ms','reconnectMs','peakHeapBytes','retainedHeapBytes','longTasks','wsBytes','queueDepth','renderedVisible'] as const},
  soak:{clients:50,writers:20,durationMs:30*60*1000,convergenceP95Ms:300},
  requiredLanes:['journeys','performance-1k','performance-5k','performance-10k','collaboration-50','storage','import','accessibility','security','api-ws-objectstore'] as const,
} as const;
export type BoardAcceptanceLane=typeof BOARD_ACCEPTANCE_RUBRIC.requiredLanes[number];
export interface BoardLaneEvidence{lane:BoardAcceptanceLane;sha:string;command:string;startedAt:string;endedAt:string;exitCode:number;environment:string;artifactSha256:string;counterproof:boolean}
export function evaluateBoardAcceptance(sha:string,rows:readonly BoardLaneEvidence[]){const failures:string[]=[];if(!/^[a-f0-9]{40}$/.test(sha))failures.push('INVALID_SHA');for(const lane of BOARD_ACCEPTANCE_RUBRIC.requiredLanes){const matching=rows.filter(value=>value.lane===lane);if(matching.length!==1){failures.push(matching.length?`DUPLICATE:${lane}`:`MISSING:${lane}`);continue;}const row=matching[0]!;if(row.sha!==sha)failures.push(`SHA_MISMATCH:${lane}`);if(row.exitCode!==0)failures.push(`FAILED:${lane}`);if(!row.counterproof)failures.push(`NO_COUNTERPROOF:${lane}`);if(!row.command.trim()||!row.environment.trim())failures.push(`MISSING_CONTEXT:${lane}`);if(!Number.isFinite(Date.parse(row.startedAt))||Date.parse(row.endedAt)<Date.parse(row.startedAt))failures.push(`INVALID_TIME:${lane}`);if(!/^[a-f0-9]{64}$/.test(row.artifactSha256))failures.push(`INVALID_ARTIFACT:${lane}`);}return{approved:failures.length===0,score:failures.length?null:9,failures};}
