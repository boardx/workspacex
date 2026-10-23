"use client";
import type {Attachment} from '@repo/contracts/chat-file-upload';
import {notifyCreditFailure} from '@/lib/credit-guidance';
import {Button} from '@/components/ui/button';
export function AttachmentExtractionNotice({attachment}:{attachment:Pick<Attachment,'extractionStatus'|'extractionError'>}){
 if(!attachment.extractionStatus||attachment.extractionStatus==='extracted')return null;
 const credit=attachment.extractionError==='credit_required',unavailable=attachment.extractionError==='credit_accounting_unavailable';
 return <div className="mt-1 space-y-1 text-12 text-muted-foreground" role="status"><p>{credit?'额度不足，附件尚未完成内容解析。请联系管理员确认计费账户并充值后手动继续。':unavailable?'计费服务暂时不可用，附件内容尚未解析，请联系管理员或稍后再试。':attachment.extractionStatus==='pending'?'附件已上传，内容正在解析。':attachment.extractionStatus==='unsupported'?'附件已上传，暂不支持解析此文件内容。':'附件已上传，但内容解析失败，请联系管理员。'}</p>{(credit||unavailable)&&<Button size="xs" variant="outline" onClick={()=>notifyCreditFailure({code:attachment.extractionError})}>查看处理指引</Button>}</div>;
}
