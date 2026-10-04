import type {WhiteboardReceiptObserver} from '../../lib/whiteboard-provider-observer';
/** Included only by the explicitly opted-in isolated fullstack build. */
export function createWhiteboardReceiptObserver():WhiteboardReceiptObserver|undefined{
 const binding=process.env.WSX_BOARD_RECEIPT_BINDING,marker=process.env.WSX_BOARD_RECEIPT_MARKER;
 if(typeof binding!=='string'||!/^boardProviderReceipt[0-9a-f]{32}$/.test(binding)||typeof marker!=='string')return undefined;
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,binding);
 if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function')return undefined;
 const notify=descriptor.value as (value:unknown)=>Promise<void>;
 return receipt=>notify({adapter:'board-provider-receipt-v1',marker,...receipt});
}
