import {chatFileUpload} from '@repo/contracts';
/** Public projection is a closed status/code set; internal provider errors never escape. */
export function attachmentExtractionPresentation(status:unknown,error:unknown):Pick<chatFileUpload.Attachment,'extractionStatus'|'extractionError'> {
 const checked=chatFileUpload.AttachmentExtractionStatus.safeParse(status);if(!checked.success)return{};
 return{extractionStatus:checked.data,extractionError:checked.data==='failed'?(error==='credit_required'||error==='credit_accounting_unavailable'?error:'extraction_failed'):null};
}
