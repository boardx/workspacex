import {describe,it,expect} from 'vitest';
import {usageMidnight,usageBucketEnd,bucketDay,usageBuckets,formatUsageCost} from '../../lib/ai-usage-chart';
describe('usage chart calendar and precision',()=>{
 it('groups Monday weeks across year and month boundaries',()=>{expect(bucketDay('2027-01-01','week')).toBe('2026-12-28');expect(bucketDay('2026-11-01','month')).toBe('2026-11-01');});
 it('keeps integer precision beyond JS safe range',()=>{expect(usageBuckets([{day:'2026-10-01',totalTokens:'9007199254740993',callCount:1},{day:'2026-10-02',totalTokens:'1',callCount:2}],'month')[0]).toEqual({day:'2026-10-01',totalTokens:9007199254740994n,callCount:3});expect(formatUsageCost('1','CNY')).toBe('CNY 0.000001');});
});

it('handles Beijing midnight and DST boundaries',()=>{expect(usageMidnight('2026-10-01','Asia/Shanghai')).toBe('2026-09-30T16:00:00.000Z');expect(usageMidnight('2026-03-08','America/New_York')).toBe('2026-03-08T05:00:00.000Z');expect(usageMidnight('2026-03-09','America/New_York')).toBe('2026-03-09T04:00:00.000Z');expect(usageBucketEnd('2026-12-01','month')).toBe('2027-01-01');});
