export function portableObjectExpectation<T extends {id:string;parentId:string|null;connector?:Record<string,unknown>}>(objects:T[],requestId:string):T[];
export function exactInterchangeObjects(expected:unknown[],actual:unknown[]):true;
export function portableExportProof(exported:{contentBase64:string;sizeBytes:number;sha256:string},expectedObjects:unknown[],revision:{epoch:number;seq:number}):unknown;
