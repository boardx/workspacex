import {strict as assert} from 'node:assert';
export function deniedConnectorWrite(before,after,status,expectedStatus){
 assert([403,404].includes(expectedStatus));assert.equal(status,expectedStatus);assert.deepEqual(after,before);
}
export function cancelledConnectorGesture(before,after,frames){
 assert.deepEqual(after,before);
 assert(!frames.some(frame=>frame.direction==='sent'&&frame.type==='update'));
 assert(!frames.some(frame=>frame.direction==='received'&&frame.type==='ack'));
}
