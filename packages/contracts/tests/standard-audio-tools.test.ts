import {expect,it} from 'vitest';
import {AudioTranscribeInput,AudioTranscribed} from '../src/standard-audio-tools';
it('audio inputs use attachment identity and reject caller scope or URL overrides',()=>{
 expect(AudioTranscribeInput.parse({attachmentId:'original'})).toEqual({attachmentId:'original'});
 expect(AudioTranscribeInput.safeParse({attachmentId:'original',orgId:'forged'}).success).toBe(false);
 expect(AudioTranscribeInput.safeParse({attachmentId:'original',url:'https://audio.test'}).success).toBe(false);
});
it('audio output contains verified file identity rather than invented transcript or artifact IDs',()=>{
 const out={workspacePath:`/workspace/transcribed-${'a'.repeat(64)}.json`,sha256:'b'.repeat(64),sourceHash:'c'.repeat(64),segments:[{id:'chunk-0',startMs:0,endMs:1000,text:'你好'}],warnings:['source_chunk_boundaries_not_word_timestamps']};
 expect(AudioTranscribed.safeParse(out).success).toBe(true);
 expect(AudioTranscribed.safeParse({...out,transcriptId:'invented'}).success).toBe(false);
 expect(AudioTranscribed.safeParse({...out,artifactId:'invented'}).success).toBe(false);
});
