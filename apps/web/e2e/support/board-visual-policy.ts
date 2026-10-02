export const visualViewports = [{width:1440,height:900},{width:1280,height:720},{width:1024,height:768}] as const;
export const productionCoreToolIds = ['board-add-sticky', 'board-add-shape', 'board-add-draw'] as const;

export function validateVisualMeasurement(value: {canvasAvailable:number;toolbarCount:number;toolbarHeight:number;controls:Array<{name:string;width:number;height:number;reachable:boolean}>}) {
  const failures:string[]=[];
  if (!Number.isFinite(value.canvasAvailable) || value.canvasAvailable < .8) failures.push('CANVAS_OCCLUDED');
  if (value.toolbarCount > 1 || value.toolbarHeight > 64) failures.push('CONTEXT_TOOLBAR');
  const names = new Set(value.controls.map(control => control.name));
  if (value.controls.length !== productionCoreToolIds.length || names.size !== productionCoreToolIds.length || productionCoreToolIds.some(name => !names.has(name)) || value.controls.some(control=>!Number.isFinite(control.width) || !Number.isFinite(control.height) || control.width<44 || control.height<44 || !control.reachable)) failures.push('CORE_CONTROL_UNREACHABLE');
  return failures;
}
