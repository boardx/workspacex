import { whiteboardRoom as C } from '@repo/contracts';
import type { z } from 'zod';
import { apiRequest } from './api-client';
const path=(template:string,values:Record<string,string>)=>Object.entries(values).reduce((out,[key,value])=>out.replace(`:${key}`,encodeURIComponent(value)),template);
export type RoomPairing=z.infer<typeof C.Pairing>;
export type RoomGrant=z.infer<typeof C.RoomGrant>;
export type RoomState=z.infer<typeof C.RoomState>;
export type RoomViewport=z.infer<typeof C.RoomViewport>;
export async function createRoomPairing(boardId:string,requestId:string){const op=C.operations.createPairing;return C.Pairing.parse(await apiRequest(path(op.path,{boardId}),{method:op.method,body:C.CreatePairing.parse({requestId})}));}
export async function readPairingStatus(boardId:string,pairingId:string,signal?:AbortSignal){const op=C.operations.pairingStatus;return C.PairingStatus.parse(await apiRequest(path(op.path,{boardId,pairingId}),{method:op.method,body:{},signal}));}
export async function joinRoom(input:z.infer<typeof C.JoinRoom>){const op=C.operations.joinRoom;return C.RoomGrant.parse(await apiRequest(op.path,{method:op.method,sessionToken:null,body:C.JoinRoom.parse(input)}));}
export async function readRoom(sessionId:string,input:z.infer<typeof C.RoomCredential>){const op=C.operations.readRoom;return C.RoomState.parse(await apiRequest(path(op.path,{sessionId}),{method:op.method,sessionToken:null,body:C.RoomCredential.parse(input)}));}
export async function publishRoomViewport(boardId:string,sessionId:string,input:z.infer<typeof C.PublishViewport>){const op=C.operations.publishViewport;return C.RoomViewport.parse(await apiRequest(path(op.path,{boardId,sessionId}),{method:op.method,body:C.PublishViewport.parse(input)}));}
export async function revokeRoom(boardId:string,sessionId:string){const op=C.operations.revokeRoom;return op.out.parse(await apiRequest(path(op.path,{boardId,sessionId}),{method:op.method}));}
