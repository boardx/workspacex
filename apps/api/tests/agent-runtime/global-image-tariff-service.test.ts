import {it,expect,vi} from 'vitest';
import {GlobalImageTariffSchedule,ActivateGlobalImageTariffs} from '@repo/contracts/billing-consumption';
import {GlobalImageTariffService} from '../../src/application/billing/global-image-tariff-service';
import {ConsumptionSettingsForbidden} from '../../src/application/billing/consumption-settings-service';
import {toOrgId} from '../../src/domain/org-id';
import {resolveNativeCreditTariff} from '../../src/infrastructure/billing/resolve-native-credit-tariff';
const items=([['z-image-turbo','25','1938'],['qwen-image-3.0','50','3876'],['qwen-image-3.0-pro','100','7752']] as const).map(([modelId,customerAmountMinor,hundredthsPerQuantum])=>({modelProvider:'bailian-image',modelId,unit:'image',customerAmountMinor,currency:'CNY',quantum:'1',hundredthsPerQuantum,version:modelId,catalogVersion:'basis-v1'}));
it('requires complete fixed-price same-basis global schedule',()=>{
 const valid={scope:'global',revision:'r1',items};expect(GlobalImageTariffSchedule.parse(valid)).toEqual(valid);
 for(const bad of [{...valid,items:items.slice(1)},{...valid,items:[items[0],items[0],items[2]]},{...valid,items:items.map((r,i)=>i? r:{...r,customerAmountMinor:'100'})},{...valid,items:items.map((r,i)=>i?r:{...r,catalogVersion:'other'})}])expect(GlobalImageTariffSchedule.safeParse(bad).success).toBe(false);
 expect(ActivateGlobalImageTariffs.safeParse({expectedRevision:null,expectedCatalogVersion:'v',orgId:'forged'}).success).toBe(false);
});
it('denies nonoperator before storage and derives audit actor from principal',async()=>{
 const repo={list:vi.fn(async()=>({scope:'global' as const,revision:null,items:[]})),activate:vi.fn(async()=>GlobalImageTariffSchedule.parse({scope:'global',revision:'r1',items}))};
 const service=new GlobalImageTariffService(repo,async u=>u==='operator'),p={orgId:toOrgId('any-org'),userId:'member'};
 await expect(service.list(p)).rejects.toBeInstanceOf(ConsumptionSettingsForbidden);await expect(service.activate(p,{expectedRevision:null,expectedCatalogVersion:'v'})).rejects.toBeInstanceOf(ConsumptionSettingsForbidden);expect(repo.list).not.toHaveBeenCalled();expect(repo.activate).not.toHaveBeenCalled();
 await service.activate({...p,userId:'operator'},{expectedRevision:null,expectedCatalogVersion:'v'});expect(repo.activate).toHaveBeenCalledWith('operator',{expectedRevision:null,expectedCatalogVersion:'v'});
});
it('uses global for any org and never falls back to temporary org rows for unknown image models or units',async()=>{
 const query=vi.fn(async(_sql:string)=>({rows:[{revision:'r1',schedule:items}]}));
 for(const org of ['old-org','new-org'])expect(await resolveNativeCreditTariff({query} as never,org,'bailian-image','qwen-image-3.0','image')).toMatchObject({hundredths_per_quantum:'3876'});
 expect(await resolveNativeCreditTariff({query} as never,'new-org','bailian-image','unknown','image')).toBeUndefined();expect(await resolveNativeCreditTariff({query} as never,'new-org','bailian-image','qwen-image-3.0','pixel')).toBeUndefined();
 expect(query.mock.calls.every(c=>!String(c[0]).includes('credit_native_tariffs'))).toBe(true);
});
it('missing global cannot fall back to old markup',async()=>{const query=vi.fn(async()=>({rows:[]}));expect(await resolveNativeCreditTariff({query} as never,'org','bailian-image','qwen-image-3.0','image')).toBeUndefined();expect(query).toHaveBeenCalledTimes(1);});

it('service forwards lifecycle cleanup to its owned writer repository',async()=>{
 const close=vi.fn(async()=>{});const service=new GlobalImageTariffService({list:async()=>({scope:'global',revision:null,items:[]}),activate:async()=>{throw Error('unused');},close},async()=>true);
 await service.onModuleDestroy();expect(close).toHaveBeenCalledOnce();
});

it('Nest application close releases the nested repository writer',async()=>{
 const {NestFactory}=await import('@nestjs/core');
 const close=vi.fn(async()=>{});
 const service=new GlobalImageTariffService({list:async()=>({scope:'global',revision:null,items:[]}),activate:async()=>{throw Error('unused');},close},async()=>true);
 const app=await NestFactory.createApplicationContext({module:class GlobalTariffLifecycleTest {},providers:[{provide:GlobalImageTariffService,useValue:service}]},{logger:false});
 await app.close();expect(close).toHaveBeenCalledOnce();
});
