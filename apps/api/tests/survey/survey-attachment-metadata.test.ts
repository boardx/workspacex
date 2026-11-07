import {it,expect,vi} from 'vitest';
import {SurveyAttachmentService} from '../../src/application/survey/survey-attachment-service';
it('uses owner authorization and exposes no object key or bytes',async()=>{
 const readOwner=vi.fn(async()=>({attachmentId:'a',name:'反馈.pdf',mime:'application/pdf',sizeBytes:5,objectKey:'private/a'}));
 const service=new SurveyAttachmentService({readOwner} as never,{} as never,{} as never);
 expect(await service.ownerMetadata('org' as never,'survey','owner','response','a')).toEqual({attachmentId:'a',name:'反馈.pdf',mime:'application/pdf',sizeBytes:5});
 expect(readOwner).toHaveBeenCalledWith('org','survey','owner','response','a');
 readOwner.mockRejectedValueOnce(new Error('not_found'));
 await expect(service.ownerMetadata('org' as never,'survey','wrong-owner','response','a')).rejects.toThrow('not_found');
});
