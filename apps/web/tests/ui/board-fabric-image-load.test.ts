// @vitest-environment jsdom
import { expect,it } from 'vitest';
import { Group,FabricImage } from 'fabric';
import { createFabricObject } from '@/components/whiteboard/fabric/board-fabric-surface';
import type { BoardFabricObject } from '@/components/whiteboard/fabric/board-fabric-object';
it('keeps the crop pixel window and geometry when durable bytes load asynchronously',()=>{
 const object:BoardFabricObject={id:'image',kind:'image',revision:1,orderKey:'a',style:{fill:'#FFFFFF',textColor:'#000000'},content:{text:''},geometry:{x:100,y:80,width:200,height:100,rotation:17},imageAssetUrl:'blob:verified',boardContent:{version:1,type:'image',status:'ready',assetId:'board-image-'+'a'.repeat(64),sourceUrl:null,mimeType:'image/png',intrinsicWidth:640,intrinsicHeight:480,crop:{x:.1,y:.2,width:.5,height:.5},opacity:1,borderColor:'#000000',borderWidth:0,cornerRadius:0,fileName:'image.png',replacementOf:null,failureCode:null,byteSize:100,contentDigest:'sha256:'+'a'.repeat(64),magicMimeType:'image/png',persistence:'durable'}};
 const group=createFabricObject(object) as Group,bitmap=group.getObjects().find(value=>value instanceof FabricImage) as FabricImage;
 const before=bitmap.calcTransformMatrix(),element=bitmap.getElement() as HTMLImageElement;
 Object.defineProperties(element,{naturalWidth:{value:640},naturalHeight:{value:480}});element.width=640;element.height=480;
 element.onload?.call(element,new Event('load'));
 expect(bitmap.width).toBe(320);expect(bitmap.height).toBe(240);expect(bitmap.cropX).toBe(64);expect(bitmap.cropY).toBe(96);expect(bitmap.calcTransformMatrix()).toEqual(before);group.dispose();
});
