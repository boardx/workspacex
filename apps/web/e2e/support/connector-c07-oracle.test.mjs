import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {restoredConnectorHistory} from './connector-c07-oracle.mjs';
test('history restore oracle rejects lost edge fields identities or overwritten peer endpoint',()=>{
 const a={id:'c07-a',geometry:{x:0,y:0}},b={id:'c07-b',geometry:{x:300,y:100}},edge={id:'c07-edge',geometry:{x:100,y:0,width:200,height:100},connector:{from:'c07-a',to:'c07-b',strokeWidth:8,label:'C07',route:{kind:'curve',startOffset:{x:1,y:2},endOffset:{x:-1,y:2}},labelPosition:{t:.7,normalOffset:-23}},style:{stroke:'#E11D48'}};
 const remoteB={...b,geometry:{x:400,y:180}},restoredEdge={...edge,geometry:{x:100,y:0,width:300,height:180}},original=[a,b,edge],restored=[a,remoteB,restoredEdge];restoredConnectorHistory(original,remoteB,restored);
 assert.throws(()=>restoredConnectorHistory(original,remoteB,[a,remoteB]));
 assert.throws(()=>restoredConnectorHistory(original,remoteB,[a,b,restoredEdge]));
 assert.throws(()=>restoredConnectorHistory(original,remoteB,[{...a,id:'recreated-a'},remoteB,restoredEdge]));
 for(const field of ['strokeWidth','label','route','labelPosition','from','to']){const broken=structuredClone(restoredEdge);delete broken.connector[field];assert.throws(()=>restoredConnectorHistory(original,remoteB,[a,remoteB,broken]));}
 assert.throws(()=>restoredConnectorHistory(original,remoteB,[a,remoteB,edge]));
});
