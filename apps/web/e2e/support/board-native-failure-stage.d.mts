export const NATIVE_FAILURE_STAGES: Readonly<Record<string,readonly string[]>>;
export function fixedNativeFailure(suite: 'R01'|'R08',stage:string):string;
export function parseNativeFailure(message:unknown,file:unknown):{suite:string;stage:string;primaryFailure:string;secondaryStage?:string}|null;
