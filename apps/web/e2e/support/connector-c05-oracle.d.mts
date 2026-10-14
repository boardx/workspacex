import type {WhiteboardConnector} from '@repo/contracts/whiteboard-document';
type Point={x:number;y:number};
export function independentProcessIds(ids:number[]):number[];
export function cubicSamples(start:Point,end:Point,route:{kind:'curve';startOffset:Point;endOffset:Point}):Point[];
export function acceptedGesture(before:{epoch:number;seq:number},after:{epoch:number;seq:number},submitted:Array<{process:number;updateId?:string;gestureId?:string;epoch?:number}>,acks:Array<{process:number;updateId?:string;gestureId?:string;seq?:number}>,actors:number[]):void;
export function retainedConnector(expected:Record<string,unknown>,actual:Record<string,unknown>):void;
export function curveMeasurement(start:Point,end:Point,route:{kind:'curve';startOffset:Point;endOffset:Point},position:{t:number;normalOffset:number},target?:Point):{point:Point;t?:number;normalOffset?:number};
export function glyphBounds(data:number[]):{x:number;y:number;width:number;height:number;count:number};
export function glyphProof(actual:number[],expected:number[]):void;
export function strokeProof(samples:Array<{offset:number;ink:boolean}>,expectedWidth:number):void;

export function connectorStorageReference(storage:Record<string,unknown>):WhiteboardConnector;

export function navigationPrefetchAbort(input:{method:string;pathname:string;errorText:string;prefetch:string|undefined;knownProjectPath?:string}):boolean;

export function strokeRasterProof(actual:Array<{offset:number;ink:boolean;coverage:number}>,reference:Array<{offset:number;ink:boolean;coverage:number}>,integral?:{actual:number;reference:number;step:number}):void;
