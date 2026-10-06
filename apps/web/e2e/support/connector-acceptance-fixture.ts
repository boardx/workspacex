import {expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {Board,DeleteBoard,DeleteBoardReceipt} from '@repo/contracts/whiteboard';
import {apiOrigin,boardApi} from '../board-acceptance-support';
export async function deleteOwnedConnectorFixture(api:APIRequestContext,token:string,id:string,ownerId:string,name:string){
 const owned=Board.parse(await (await boardApi(api,token,'GET',`/whiteboards/${id}`)).json());
 expect(owned.id).toBe(id);expect(owned.ownerId).toBe(ownerId);expect(owned.role).toBe('owner');expect(owned.name).toBe(name);
 if(!owned.archived)await boardApi(api,token,'PATCH',`/whiteboards/${id}`,{archived:true,expectedLifecycleRevision:owned.lifecycleRevision});
 const archived=Board.parse(await (await boardApi(api,token,'GET',`/whiteboards/${id}`)).json());expect(archived.archived).toBe(true);expect(archived.ownerId).toBe(ownerId);expect(archived.name).toBe(name);
 const input=DeleteBoard.parse({requestId:randomUUID(),confirmation:'PERMANENTLY_DELETE',expectedLifecycleRevision:archived.lifecycleRevision});
 const receipt=DeleteBoardReceipt.parse(await (await boardApi(api,token,'DELETE',`/whiteboards/${id}`,input)).json());expect(receipt).toEqual({requestId:input.requestId,boardId:id,deleted:true});
 const response=await api.get(`${apiOrigin()}/whiteboards/${id}`,{headers:{authorization:`Bearer ${token}`}});expect(response.status()).toBe(404);
 return {id,ownerVerified:true,nameVerified:true,archived:true,deleted:true,boardDetailStatus:response.status()};
}
