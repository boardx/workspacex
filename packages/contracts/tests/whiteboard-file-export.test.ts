import { describe,expect,it } from 'vitest';
import * as C from '../src/whiteboard-file-export';

describe('Board file export contract',()=>{
  it('offers only real artifact formats and no client-asserted hidden-content switch',()=>{
    expect(C.BoardFileExportFormat.options).toEqual(['png','svg','pdf','sticky-csv']);
    expect(C.BoardFileExportInput.parse({format:'png',background:'transparent'})).toEqual({format:'png',background:'transparent'});
    expect(C.BoardFileExportInput.safeParse({format:'png',background:'#ffffff',includeHidden:true}).success).toBe(false);
  });
  it('keeps progress, bounds failures, page order and loss report explicit',()=>{
    expect(C.BoardFileExportStatus.parse({jobId:'d34d20d0-f4cf-4bb8-bca0-8c7d3d20d925',boardId:'57d83843-21e2-40ae-8c1c-571d0ad63c80',format:'pdf',status:'running',progress:40,filename:'board.pdf',mimeType:'application/pdf',objectCount:3,pageOrder:['frame-a'],losses:[{code:'FONT_FALLBACK',count:1,sampleObjectIds:['note-a'],message:'Bundled font used.'}],sizeBytes:null,errorCode:null})).toMatchObject({status:'running',progress:40,pageOrder:['frame-a']});
  });
});
