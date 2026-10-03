import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export function createOwnedStickyBoardLifecycle({ctx,base,launchOwner,onReceipt}){
 assert.equal(typeof onReceipt,'function','durable preserve-only receipt writer is required');
 const created=new Map();
 const preserve=async(actor)=>{
  const receipt=created.get(actor.boardId);assert(receipt&&receipt.actor===actor,'cleanup must only inspect a board created by this exact actor');
  const metadata=await ctx.api(actor,'GET',`/whiteboards/${actor.boardId}`);
  assert.equal(metadata.ownerId,receipt.ownerId);assert.equal(metadata.name,receipt.name);assert(Number.isInteger(metadata.lifecycleRevision));
  await onReceipt({...receipt.public,ownerVerified:true,titleVerified:true,lifecycleRevision:metadata.lifecycleRevision});
 };
 const launchFreshOwner=async(options)=>{
  const actor=await launchOwner(options);let board;
  try{
   const name=`R06 native acceptance ${randomUUID()}`;
   board=await ctx.api(actor,'POST','/whiteboards',{requestId:randomUUID(),name});
   assert(board.id,'created board ID is required');assert(!created.has(board.id),'fresh board ID was already tracked');
   actor.boardId=board.id;
   const publicReceipt={boardId:board.id,ownerId:actor.identity.userId,title:name,deleted:false,pendingPermanentDelete:true,cleanupPending:true,ownerVerified:false,titleVerified:false};
   created.set(board.id,{actor,ownerId:actor.identity.userId,name,public:publicReceipt});
   await onReceipt(publicReceipt);
   assert(board.id&&board.ownerId===actor.identity.userId,'created board owner must be the actual authenticated user');
   const metadata=await ctx.api(actor,'GET',`/whiteboards/${board.id}`);
   assert.equal(metadata.ownerId,actor.identity.userId);assert.equal(metadata.name,name);assert(Number.isInteger(metadata.lifecycleRevision));
   await onReceipt({...publicReceipt,ownerVerified:true,titleVerified:true,lifecycleRevision:metadata.lifecycleRevision});
   await actor.page.goto(`${base}/studio/board/${board.id}`);await ctx.surface(actor).waitFor();
   const state=await ctx.state(actor);assert.equal(state.head.role,'owner');assert.equal(state.objects.length,0,'fresh native fixture must not contain API-seeded objects');
   return actor;
  }catch(error){
   const failures=[error];
   if(board?.id&&created.has(board.id))try{await preserve(actor);}catch(cleanupError){failures.push(cleanupError);}
   try{await actor.close();}catch(closeError){failures.push(closeError);}
   throw new AggregateError(failures,'fresh owned board initialization failed');
  }
 };
 const cleanupFreshOwner=async(actor)=>{
  const errors=[];try{await preserve(actor);}catch(error){errors.push(error);}
  try{await actor.close();}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(errors,'tracked board and browser cleanup failed');
 };
 return{launchFreshOwner,cleanupFreshOwner,trackedBoards:()=>Array.from(created.keys())};
}
