"use client";
import type {Attachment} from '@repo/contracts/chat-file-upload';
import {notifyCreditFailure} from '@/lib/credit-guidance';
import {Button} from '@/components/ui/button';
import {useI18n} from '@/lib/i18n/provider';
export function AttachmentExtractionNotice({attachment}:{attachment:Pick<Attachment,'extractionStatus'|'extractionError'>}){
 const {t}=useI18n();
 if(!attachment.extractionStatus||attachment.extractionStatus==='extracted')return null;
 const credit=attachment.extractionError==='credit_required',unavailable=attachment.extractionError==='credit_accounting_unavailable';
 const messageKey=credit?'chatAttachments.extractionCredit':unavailable?'chatAttachments.extractionAccounting':attachment.extractionStatus==='pending'?'chatAttachments.extractionPending':attachment.extractionStatus==='unsupported'?'chatAttachments.extractionUnsupported':'chatAttachments.extractionFailed';
 return <div className="mt-1 space-y-1 text-12 text-muted-foreground" role="status"><p>{t(messageKey)}</p>{(credit||unavailable)&&<Button size="xs" variant="outline" onClick={()=>notifyCreditFailure({code:attachment.extractionError})}>{t('chatAttachments.creditGuide')}</Button>}</div>;
}
