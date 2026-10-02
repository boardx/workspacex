import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copiedSubgraphExpectation,copiedSubgraphProof} from './connector-copy-oracle.mjs';

test('UI copy oracle refuses old IDs, incorrect 24px translation, lost advanced fields and stale bound endpoints',()=>{
 const original=[{id:'a',orderKey:'a',parentId:null,geometry:{x:10,y:20,width:100,height:80,rotation:0}},{id:'b',orderKey:'b',parentId:null,geometry:{x:400,y:220,width:100,height:80,rotation:90}},{id:'edge',orderKey:'edge',parentId:null,geometry:{x:110,y:60,width:290,height:200,rotation:0},connector:{from:'a',to:'b',fromAnchor:'right',toAnchor:'left',type:'curve',strokeWidth:12,route:{kind:'curve',startOffset:{x:40,y:-70},endOffset:{x:-80,y:25}},label:'中文 English',labelPosition:{t:.73,normalOffset:-29},semanticRelation:'depends_on',startStyle:'circle',endStyle:'diamond',lineStyle:'dotted'}},{id:'free',orderKey:'free',parentId:null,geometry:{x:30,y:90,width:500,height:0,rotation:0},connector:{fromPoint:{x:30,y:90},toPoint:{x:530,y:90},type:'elbow',route:{kind:'elbow',waypoints:[{x:200,y:120}]},strokeWidth:7,label:'free',labelPosition:{t:.3,normalOffset:40}}}];
 const identities=original.map(item=>({...item,id:`new-${item.id}`})),expected=copiedSubgraphExpectation(original,identities);assert.deepEqual(copiedSubgraphProof(original,expected),expected);
 const mutate=change=>{const actual=structuredClone(expected);change(actual);assert.throws(()=>copiedSubgraphProof(original,actual));};
 mutate(actual=>{actual[0].id='a';});mutate(actual=>{actual[1].id=actual[0].id;});mutate(actual=>{actual[0].geometry.x-=1;});mutate(actual=>{actual[2].connector.from='a';});mutate(actual=>{actual[3].connector.fromPoint.x-=24;});mutate(actual=>{actual[3].connector.route.waypoints[0].y-=24;});mutate(actual=>{actual[2].connector.route.startOffset.x+=24;});
 for(const field of ['strokeWidth','label','labelPosition','semanticRelation','fromAnchor','toAnchor','startStyle','endStyle','lineStyle'])mutate(actual=>{delete actual[2].connector[field];});
 assert.throws(()=>copiedSubgraphProof(original,expected.slice(0,3)));assert.throws(()=>copiedSubgraphExpectation([...original,{...original[0],id:'other'}],[...expected,{...expected[0],id:'other-new'}]));
});
