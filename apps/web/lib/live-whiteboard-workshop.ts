import * as C from '@repo/contracts/whiteboard-workshop';
import { apiRequest } from './api-client';
const path = (boardId:string, suffix:string) => `/whiteboards/${encodeURIComponent(boardId)}/workshop/${suffix}`;
export const listWorkshopComments = async (id:string) => C.CommentList.parse(await apiRequest(path(id,'comments'),{method:'GET'})).items;
export const addWorkshopComment = async (id:string,input:C.CreateComment) => C.Comment.parse(await apiRequest(path(id,'comments'),{method:'POST',body:C.CreateComment.parse(input)}));
export const deleteWorkshopComment = async (id:string,commentId:string) => C.WorkshopOk.parse(await apiRequest(path(id,`comments/${encodeURIComponent(commentId)}`),{method:'DELETE'}));
export const getWorkshopDraft = async (id:string) => C.PrivateDraft.parse(await apiRequest(path(id,'draft'),{method:'GET'}));
export const saveWorkshopDraft = async (id:string,input:C.SavePrivateDraft) => C.PrivateDraft.parse(await apiRequest(path(id,'draft'),{method:'PUT',body:C.SavePrivateDraft.parse(input)}));
export const listWorkshopVotes = async (id:string) => C.VoteList.parse(await apiRequest(path(id,'votes'),{method:'GET'})).items;
export const createWorkshopVote = async (id:string,input:C.CreateVote) => C.Vote.parse(await apiRequest(path(id,'votes'),{method:'POST',body:C.CreateVote.parse(input)}));
export const castWorkshopVote = async (id:string,voteId:string,input:C.CastVote) => C.Vote.parse(await apiRequest(path(id,`votes/${encodeURIComponent(voteId)}/ballots`),{method:'POST',body:C.CastVote.parse(input)}));
export const closeWorkshopVote = async (id:string,voteId:string) => C.Vote.parse(await apiRequest(path(id,`votes/${encodeURIComponent(voteId)}/close`),{method:'POST'}));
export const getWorkshopTimer = async (id:string) => C.Timer.parse(await apiRequest(path(id,'timer'),{method:'GET'}));
export const startWorkshopTimer = async (id:string,input:C.StartTimer) => C.Timer.parse(await apiRequest(path(id,'timer'),{method:'PUT',body:C.StartTimer.parse(input)}));
export const stopWorkshopTimer = async (id:string) => C.Timer.parse(await apiRequest(path(id,'timer'),{method:'DELETE'}));

export const publishWorkshopDraft = async (id:string,input:C.PublishDraft) => C.PublishedDraft.parse(await apiRequest(path(id,'draft/publish'),{method:'POST',body:C.PublishDraft.parse(input)}));
