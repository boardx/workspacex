import {PayloadTooLargeException} from '@nestjs/common';
import {json,type Express,type Request,type Response,type NextFunction} from 'express';
import {InputOnlyRuntimeModelRequestAdmission} from '@repo/contracts/runtime-model-usage';

// Admission carries the exact serialized provider request. JSON escaping can take
// six bytes per UTF-16 character; derive the allowance from the contract, with
// bounded room for ownership metadata. Never widen public or receipt routes.
export const RUNTIME_ADMISSION_BODY_MAX_BYTES=
  InputOnlyRuntimeModelRequestAdmission.shape.serializedBody.maxLength! * 6 + 64 * 1024;
export function registerRuntimeAdmissionBodyParser(app:Pick<Express,'post'>):void {
 const parser=json({limit:RUNTIME_ADMISSION_BODY_MAX_BYTES});
 app.post('/internal/agent-runs/:runId/model-requests/admit',
  (req:Request,res:Response,next:NextFunction)=>parser(req,res,(error?:unknown)=>{
   if(typeof error==='object'&&error!==null&&'type' in error&&error.type==='entity.too.large'){
    next(new PayloadTooLargeException());return;
   }
   next(error);
  }));
}
