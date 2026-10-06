import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {portableObjectExpectation,exactInterchangeObjects,portableExportProof} from './connector-c08-oracle.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const objects=[{id:'a',parentId:null,geometry:{x:10,y:20,width:100,height:80,rotation:90},text:'A',style:{}},{id:'b',parentId:null,geometry:{x:400,y:220,width:100,height:80,rotation:0},text:'B',style:{}},{id:'edge',parentId:null,geometry:{x:110,y:60,width:290,height:200,rotation:0},text:'中文 English',style:{stroke:'#E11D48'},connector:{from:'a',to:'b',fromAnchor:'right',toAnchor:'left',type:'curve',route:{kind:'curve',startOffset:{x:40,y:-70},endOffset:{x:-80,y:25}},strokeWidth:24,label:'中文 English',labelPosition:{t:.73,normalOffset:-29},semanticRelation:'depends_on',startStyle:'circle',endStyle:'diamond',lineStyle:'dotted'}}];
test('C08 exact canonical interchange rejects lost advanced fields, stale references and identity collisions',()=>{
 const expected=portableObjectExpectation(objects,'request-1');assert.equal(exactInterchangeObjects(expected,[...expected].reverse()),true);assert.notEqual(expected[2].connector.from,'a');assert.equal(expected[2].connector.from,expected[0].id);
 for(const field of ['route','strokeWidth','label','labelPosition','fromAnchor','toAnchor','semanticRelation','startStyle','endStyle','lineStyle']){const actual=structuredClone(expected);delete actual[2].connector[field];assert.throws(()=>exactInterchangeObjects(expected,actual));}
 for(const field of ['from','to']){const actual=structuredClone(expected);actual[2].connector[field]=objects[2].connector[field];assert.throws(()=>exactInterchangeObjects(expected,actual));}
 const duplicate=structuredClone(expected);duplicate[1].id=duplicate[0].id;assert.throws(()=>exactInterchangeObjects(expected,duplicate));assert.throws(()=>exactInterchangeObjects(expected,expected.slice(0,2)));
 const free=structuredClone(objects);delete free[2].connector.from;delete free[2].connector.to;free[2].connector.fromPoint={x:-30,y:40};free[2].connector.toPoint={x:330,y:-80};assert.deepEqual(portableObjectExpectation(free,'r')[2].connector,free[2].connector);
});
test('C08 byte envelope rejects stale revision and independently damaged outer or object digests',()=>{
 const objectBytes=Buffer.from(JSON.stringify(objects)),bundle={format:'workspacex.board.bundle.v1',revision:{epoch:2,seq:7},objects:{path:'objects.json',sha256:sha(objectBytes),sizeBytes:objectBytes.length,content:objects},media:[]};
 const encoded=value=>{const bytes=Buffer.from(JSON.stringify(value));return{contentBase64:bytes.toString('base64'),sha256:sha(bytes),sizeBytes:bytes.length};};
 const exported=encoded(bundle);assert.equal(portableExportProof(exported,objects,bundle.revision).format,bundle.format);
 assert.throws(()=>portableExportProof({...exported,sha256:'0'.repeat(64)},objects,bundle.revision));assert.throws(()=>portableExportProof({...exported,sizeBytes:exported.sizeBytes+1},objects,bundle.revision));assert.throws(()=>portableExportProof(exported,objects,{epoch:2,seq:8}));
 const damaged=structuredClone(bundle);damaged.objects.sha256='0'.repeat(64);assert.throws(()=>portableExportProof(encoded(damaged),objects,bundle.revision));damaged.objects.sha256=bundle.objects.sha256;damaged.objects.content[2].connector.label='old';assert.throws(()=>portableExportProof(encoded(damaged),objects,bundle.revision));
});
