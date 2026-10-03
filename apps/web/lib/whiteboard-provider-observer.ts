/** Private host dependency; the normal application has no receipt observer. */
export type WhiteboardAcceptedReceipt = Readonly<{providerInstance:string;socketGeneration:number;updateId:string;gestureId:string;seq:number}>;
export type WhiteboardReceiptObserver = (receipt:WhiteboardAcceptedReceipt)=>void|Promise<void>;
export function createWhiteboardReceiptObserver():WhiteboardReceiptObserver|undefined{return undefined;}
