import type { AttachmentToMarkdownPort } from '../chat/attachment-to-markdown.port';
import { SURVEY_PROPOSAL_FILE_MAX_BYTES } from '@repo/contracts/survey-markdown-proposal';
import { sniffKind } from '../../domain/files/mime-sniff';
import { scanForMalware } from '../../domain/files/malware-scan';
import { SurveyProposalError } from './generate-markdown-proposal';
export async function extractSurveyProposalFile(converter:AttachmentToMarkdownPort,input:{name:string;base64:string}):Promise<string>{
  const invalid=()=>new SurveyProposalError('SURVEY_AI_INPUT_INVALID');
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw invalid();
  const bytes=Buffer.from(input.base64,'base64');
  if(!bytes.length||bytes.length>SURVEY_PROPOSAL_FILE_MAX_BYTES||bytes.toString('base64')!==input.base64||!scanForMalware(bytes).clean)throw invalid();
  const extension=input.name.split('.').pop()?.toLowerCase();const kind=sniffKind(bytes);
  if(['md','markdown','txt'].includes(extension??'')&&kind==='text'){
    try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw invalid();}
  }
  const format=extension==='pdf'&&kind==='pdf'?'pdf':extension==='docx'&&kind==='zip'?'docx':null;
  if(!format)throw invalid();
  const converted=await converter.convert(bytes,format);
  if(!converted.ok)throw invalid();return converted.markdown;
}
