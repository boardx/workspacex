import {expect,it} from 'vitest';
import {AudioFinalCollector} from '../../src/application/agent-run/audio-final-collector';
it('retains repeated speech with distinct identities and replaces a revision without duplicating it',()=>{
 const c=new AudioFinalCollector();
 c.add({itemId:'1',eventId:'a',text:'yes',confidence:null});
 c.add({itemId:'2',eventId:'b',text:'yes',confidence:null});
 c.add({itemId:'2',eventId:'b',text:'yes',confidence:null});
 expect(c.text()).toBe('yes\nyes');
 c.add({itemId:'1',eventId:'c',text:'corrected',confidence:null});
 expect(c.text()).toBe('corrected\nyes');
});
it('allows a single anonymous final but refuses ambiguous multiple finals',()=>{
 const c=new AudioFinalCollector();c.add({text:'one',confidence:null});expect(c.text()).toBe('one');
 expect(()=>c.add({text:'one',confidence:null})).toThrow('identity_ambiguous');
});
it('rejects conflicting replay of an event identity',()=>{
 const c=new AudioFinalCollector();c.add({eventId:'a',itemId:'1',text:'one',confidence:null});
 expect(()=>c.add({eventId:'a',itemId:'1',text:'changed',confidence:null})).toThrow('event_conflict');
});
