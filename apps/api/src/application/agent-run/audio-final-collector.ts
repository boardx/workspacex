import {AUDIO_TRANSCRIBE_LIMITS as L} from '@repo/contracts/standard-audio-tools';
import type {AsrTranscript} from '../recording/asr-ports';

/** A source chunk can contain several real utterances; identical text is not duplication. */
export class AudioFinalCollector {
  private readonly events=new Map<string,string>();
  private readonly items=new Map<string,AsrTranscript>();
  private anonymous:AsrTranscript|undefined;
  add(final:AsrTranscript):void {
    if(Buffer.byteLength(final.text,'utf8')>L.maxTextBytes||this.events.size>=256||this.items.size>=256)throw new Error('audio_final_limit');
    const payload=JSON.stringify({itemId:final.itemId,text:final.text,confidence:final.confidence});
    if(final.eventId){
      const previous=this.events.get(final.eventId);
      if(previous!==undefined){if(previous!==payload)throw new Error('audio_final_event_conflict');return;}
      this.events.set(final.eventId,payload);
    }
    if(final.itemId){
      if(this.anonymous)throw new Error('audio_final_identity_ambiguous');
      this.items.set(final.itemId,final);
    }else{
      if(this.anonymous||this.items.size)throw new Error('audio_final_identity_ambiguous');
      this.anonymous=final;
    }
  }
  text():string {
    const text=(this.anonymous?[this.anonymous]:[...this.items.values()]).map(item=>item.text).join('\n');
    if(Buffer.byteLength(text,'utf8')>L.maxTextBytes)throw new Error('audio_final_limit');
    return text;
  }
}
