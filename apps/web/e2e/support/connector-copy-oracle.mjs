import {exactInterchangeObjects} from './connector-c08-oracle.mjs';

export function copiedSubgraphExpectation(original,copies){
 if(copies.length!==original.length||new Set(original.map(item=>item.orderKey)).size!==original.length)throw new Error('Ambiguous copy identity');
 const sourceIds=new Set(original.map(item=>item.id)),mapping=new Map();
 for(const item of original){const matches=copies.filter(copy=>copy.orderKey===item.orderKey);if(matches.length!==1||typeof matches[0].id!=='string'||!matches[0].id||sourceIds.has(matches[0].id))throw new Error('Copy identity is not fresh and bijective');mapping.set(item.id,matches[0].id);}
 if(new Set(mapping.values()).size!==original.length)throw new Error('Copy identity collision');
 const point=value=>({x:value.x+24,y:value.y+24});
 return original.map(item=>({...structuredClone(item),id:mapping.get(item.id),geometry:{...item.geometry,x:item.geometry.x+24,y:item.geometry.y+24},parentId:item.parentId===null?null:mapping.get(item.parentId),...(item.connector?{connector:{...structuredClone(item.connector),...(item.connector.from?{from:mapping.get(item.connector.from)}:{}),...(item.connector.to?{to:mapping.get(item.connector.to)}:{}),...(item.connector.fromPoint?{fromPoint:point(item.connector.fromPoint)}:{}),...(item.connector.toPoint?{toPoint:point(item.connector.toPoint)}:{}),...(item.connector.route?.kind==='elbow'?{route:{kind:'elbow',waypoints:item.connector.route.waypoints.map(point)}}:{})}}:{})}));
}

export function copiedSubgraphProof(original,copies){const expected=copiedSubgraphExpectation(original,copies);exactInterchangeObjects(expected,copies);return expected;}
