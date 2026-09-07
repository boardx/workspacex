import type { z } from "zod";
import { chat } from "@repo/contracts";
export type NotificationThread = Pick<z.infer<typeof chat.ThreadCard>,"id"|"title"|"status"|"lastActivityAt">;
export interface TaskNotice { threadId:string; status:NotificationThread["status"]; cursor:string }
export interface TaskNoticeState { observed:Record<string,string>; unread:TaskNotice[] }
export const emptyTaskNotices=():TaskNoticeState=>({observed:{},unread:[]});
const interesting=new Set(["done","failed","awaiting-approval","paused"]);
export function reconcileTaskNotices(state:TaskNoticeState,cards:readonly NotificationThread[],active:string|null):TaskNoticeState {
  const visible=new Set(cards.map(card=>card.id));
  const observed={...state.observed};
  let unread=state.unread.filter(notice=>visible.has(notice.threadId)&&notice.threadId!==active);
  for(const card of cards){
    const cursor=JSON.stringify([card.lastActivityAt,card.status]);
    const prior=observed[card.id];
    if(prior!==cursor){
      unread=unread.filter(notice=>notice.threadId!==card.id);
      if(card.id!==active&&interesting.has(card.status)&&(prior!==undefined||card.status==="paused"||card.status==="awaiting-approval"))
        unread.push({threadId:card.id,status:card.status,cursor});
    }
    observed[card.id]=cursor;
  }
  // Keep cursors for temporarily absent pages, but never render their stale notices.
  return {observed,unread};
}
export function readTaskNotices(key:string):TaskNoticeState {
  try {
    const raw=JSON.parse(localStorage.getItem(key)??"null") as unknown;
    if(!raw||typeof raw!=="object")return emptyTaskNotices();
    const value=raw as TaskNoticeState;
    if(!value.observed||typeof value.observed!=="object"||Array.isArray(value.observed)||!Object.values(value.observed).every(item=>typeof item==="string")||!Array.isArray(value.unread))return emptyTaskNotices();
    return {observed:value.observed,unread:value.unread.filter(item=>item&&typeof item.threadId==="string"&&typeof item.cursor==="string"&&interesting.has(item.status))};
  }catch{return emptyTaskNotices();}
}
