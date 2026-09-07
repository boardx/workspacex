import 'reflect-metadata';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {describe,it,expect,vi} from 'vitest';
import {KernelModule} from '../../src/kernel.module';
import {STANDARD_SCHEDULE,SCHEDULED_RUN_NOTIFIER} from '../../src/application/agent-run/standard-schedule';
import {StandardScheduleRuntime} from '../../src/infrastructure/agent-run/standard-schedule-runtime';
import {StandardScheduleController} from '../../src/interface/controllers/standard-schedule.controller';

describe('production scheduler composition',()=>{
 it('registers real controller and optional notifier, and defaults disabled without constructing a worker',()=>{
  const providers=Reflect.getMetadata('providers',KernelModule) as Array<{provide?:symbol;useFactory?:(...args:unknown[])=>unknown;inject?:unknown[]}>;
  const binding=providers.find(p=>p.provide===STANDARD_SCHEDULE)!;
  expect(binding).toBeDefined();
  expect(binding.inject).toContainEqual({token:SCHEDULED_RUN_NOTIFIER,optional:true});
  expect(Reflect.getMetadata('controllers',KernelModule)).toContain(StandardScheduleController);
  const prior=process.env.KERNEL_STANDARD_SCHEDULER;
  delete process.env.KERNEL_STANDARD_SCHEDULER;
  try{expect(binding.useFactory!()).toBeNull();}finally{
   if(prior===undefined)delete process.env.KERNEL_STANDARD_SCHEDULER;else process.env.KERNEL_STANDARD_SCHEDULER=prior;
  }
 });
 it('Nest initialization starts official provider and close drains it',async()=>{
  const start=vi.fn(async()=>{}),stop=vi.fn(async()=>{}),deliver=vi.fn(async()=>{}),invoke=vi.fn(async()=>({cancelled:true}));
  const runtime=new StandardScheduleRuntime({start,stop},{deliver,invoke});
  @Module({providers:[{provide:STANDARD_SCHEDULE,useValue:runtime}]}) class Composition{}
  const app=await NestFactory.createApplicationContext(Composition,{logger:false});
  expect(start).toHaveBeenCalledTimes(1);
  await app.close();expect(stop).toHaveBeenCalledTimes(1);
 });
 it('partial startup failure stops provider and propagates sanitized unavailability',async()=>{
  const stop=vi.fn(async()=>{});
  const runtime=new StandardScheduleRuntime({start:async()=>{throw new Error('secret DSN');},stop},
   {deliver:async()=>{},invoke:async()=>({})});
  await expect(runtime.onModuleInit()).rejects.toThrow('schedule_provider_start_failed');
  expect(stop).toHaveBeenCalledTimes(1);
 });
});
