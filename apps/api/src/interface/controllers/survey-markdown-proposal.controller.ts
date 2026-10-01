import { BadRequestException,Body,Controller,ForbiddenException,Inject,NotFoundException,Post,ServiceUnavailableException } from '@nestjs/common';
import { SurveyMarkdownProposalInputSchema } from '@repo/contracts/survey-markdown-proposal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { assertPrincipal,type Principal } from '../../domain/principal';
import { toOrgId } from '../../domain/org-id';
import { IDENTITY_REPOSITORY,type IdentityRepository } from '../../application/identity/ports';
import { PERSONAL_TRANSCRIPTION_REPOSITORY,type PersonalTranscriptionRepository } from '../../application/recording/personal-transcription-ports';
import { readPersonalTranscription,PersonalTranscriptionNotFound } from '../../application/recording/personal-transcription-usecases';
import { SURVEY_MARKDOWN_GENERATOR,SurveyProposalError,type SurveyMarkdownGenerator } from '../../application/survey/generate-markdown-proposal';
import { ATTACHMENT_TO_MARKDOWN,type AttachmentToMarkdownPort } from '../../application/chat/attachment-to-markdown.port';
import { extractSurveyProposalFile } from '../../application/survey/proposal-file';

@Controller('/surveys/markdown-proposals')
export class SurveyMarkdownProposalController {
  constructor(@Inject(SURVEY_MARKDOWN_GENERATOR) private readonly generator:SurveyMarkdownGenerator,
    @Inject(IDENTITY_REPOSITORY) private readonly identities:IdentityRepository,
    @Inject(PERSONAL_TRANSCRIPTION_REPOSITORY) private readonly transcripts:PersonalTranscriptionRepository,
    @Inject(ATTACHMENT_TO_MARKDOWN) private readonly converter:AttachmentToMarkdownPort){}
  @Post() async generate(@CurrentPrincipal() principal:Principal,@Body() body:unknown) {
    assertPrincipal(principal);
    const parsed=SurveyMarkdownProposalInputSchema.safeParse(body);
    if(!parsed.success)throw new BadRequestException({reasonCode:'SURVEY_AI_INPUT_INVALID'});
    const orgId=toOrgId(principal.orgId);
    if(!await this.identities.findOrgMembership(principal.userId,orgId))throw new ForbiddenException();
    let text=parsed.data.text;
    let name:string|undefined;
    if(parsed.data.transcriptionId){
      try{
        const source=await readPersonalTranscription({identities:this.identities,repository:this.transcripts},{userId:principal.userId,orgId,transcriptionId:parsed.data.transcriptionId});
        if(await this.transcripts.hasActiveCapture({orgId,ownerUserId:principal.userId,transcriptionId:source.sessionId}))throw new BadRequestException({reasonCode:'SURVEY_TRANSCRIPTION_ACTIVE'});
        text=[text,source.content].filter(Boolean).join('\n\n');name=source.name;
      }catch(error){if(error instanceof PersonalTranscriptionNotFound)throw new NotFoundException();throw error;}
    }
    try{
      if(parsed.data.file){text=[text,await extractSurveyProposalFile(this.converter,parsed.data.file)].filter(Boolean).join('\n\n');name=parsed.data.file.name;}
      return await this.generator.generate({text,kind:parsed.data.file?'file':parsed.data.transcriptionId?'transcription':'text',name,referenceId:parsed.data.transcriptionId});}
    catch(error){if(error instanceof SurveyProposalError){if(error.code==='SURVEY_AI_UNAVAILABLE')throw new ServiceUnavailableException({reasonCode:error.code});throw new BadRequestException({reasonCode:error.code});}throw error;}
  }
}
