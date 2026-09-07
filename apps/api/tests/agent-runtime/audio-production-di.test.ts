import {beforeAll,expect,it} from 'vitest';
import {ensureDatabase,migrateOnce} from '../support/db';
import {STANDARD_AUDIO_SERVICE} from '../../src/application/agent-run/standard-audio-tools';
import {DefaultStandardAudioService} from '../../src/infrastructure/agent-run/standard-audio-service';
beforeAll(async()=>{await ensureDatabase();await migrateOnce();});
it('production kernel binds audio service only when native ownership and provider credentials are configured',async()=>{
 const names=['NATIVE_SESSION_SOCKET','NATIVE_SESSION_BINDING_KEY','KERNEL_ASR_API_KEY','KERNEL_ASR_PROVIDER','KERNEL_ASR_BASE_URL','KERNEL_ASR_MODEL','KERNEL_QUIET'] as const;
 const old=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 const {createApp}=await import('../../src/main');
 try{
  process.env.NATIVE_SESSION_SOCKET='/tmp/wx-image-di-not-contacted.sock';process.env.NATIVE_SESSION_BINDING_KEY='c'.repeat(64);process.env.KERNEL_ASR_API_KEY='test-only-configured-key';process.env.KERNEL_ASR_PROVIDER='realtime';process.env.KERNEL_ASR_BASE_URL='ws://127.0.0.1:1';process.env.KERNEL_ASR_MODEL='fixture-asr';process.env.KERNEL_QUIET='1';
  const configured=await createApp();try{expect(configured.get(STANDARD_AUDIO_SERVICE)).toBeInstanceOf(DefaultStandardAudioService);}finally{await configured.close();}
  process.env.KERNEL_ASR_API_KEY='';const absent=await createApp();try{expect(absent.get(STANDARD_AUDIO_SERVICE)).toBeNull();}finally{await absent.close();}
 }finally{for(const name of names){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}}
},60000);
