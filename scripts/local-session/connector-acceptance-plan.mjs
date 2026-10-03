// Planned coverage is deliberately separate from executed browser evidence.
export const connectorTypes = ['straight', 'elbow', 'curve'];
export const connectorPositions = {
  horizontal: {a:[260,300],b:[960,300],from:'right',to:'left'},
  'horizontal-reverse': {a:[960,300],b:[260,300],from:'left',to:'right'},
  vertical: {a:[620,100],b:[620,540],from:'bottom',to:'top'},
  'vertical-reverse': {a:[620,540],b:[620,100],from:'top',to:'bottom'},
  'diagonal-down-right': {a:[260,130],b:[960,540],from:'right',to:'left'},
  'diagonal-down-left': {a:[960,130],b:[260,540],from:'left',to:'right'},
  'diagonal-up-right': {a:[260,540],b:[960,130],from:'right',to:'left'},
  'diagonal-up-left': {a:[960,540],b:[260,130],from:'left',to:'right'},
};
export const connectorPlan = connectorTypes.flatMap(type => Object.entries(connectorPositions).map(([direction,position]) => ({id:`${type}-${direction}`,type,direction,...position})));
export function selectConnectorScenes({directions=Object.keys(connectorPositions),types=connectorTypes}={}) {
  if (!directions.length || !types.length || new Set(directions).size !== directions.length || new Set(types).size !== types.length || directions.some(d=>!Object.hasOwn(connectorPositions,d)) || types.some(t=>!connectorTypes.includes(t))) throw new Error('Invalid or duplicate connector scene selection');
  return types.flatMap(type=>directions.map(direction=>connectorPlan.find(s=>s.type===type&&s.direction===direction)));
}
export const positionChecks = ['real pointer creation/cue/zero-held-write/cardinal-fields/one-operation','unselected-path-pixels','reload-and-handle-reselection'];
export function classifyPositionCoverage(results,{chrome=false,exerciseHandles=false}={}) {
  const ids=results.map(r=>r.id),unique=new Set(ids);
  const exact=ids.length===connectorPlan.length&&unique.size===ids.length&&connectorPlan.every(s=>unique.has(s.id));
  const executed=exact&&results.every(r=>positionChecks.every(name=>r.checks?.some(c=>c.name===name)));
  const checksPassed=executed&&results.every(r=>r.ok===true&&positionChecks.every(name=>r.checks.some(c=>c.name===name&&c.ok===true)));
  const flagsComplete=chrome&&exerciseHandles;
  const optionalChecksPassed=results.every(r=>['selected-no-blue-bbox','compact-menu-real-controls',...(r.id.startsWith('straight-')?[]:['actual-route-edit'])].every(name=>r.checks?.some(c=>c.name===name&&c.ok===true)));
  return {fullPositionMatrixExecuted:executed,fullPositionMatrixPassed:checksPassed,flagsComplete,scope:checksPassed&&flagsComplete&&optionalChecksPassed?'position-matrix-only':'subset',coverageComplete:false,fullRequiredSuiteComplete:false};
}

export function classifyCoverage(results) {
  const unique = new Set(results.map(item => item.id));
  const passed = unique.size === results.length && connectorPlan.every(item =>
    results.some(result => result.id === item.id && result.ok === true),
  );
  return { passed, coverageComplete: false, gaps: [
    'independently authenticated permission and concurrent editing matrix',
    'hardware touchpad and IME checks',
    'complete C01-C21 capability suite',
  ] };
}
