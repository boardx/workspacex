import { describe, it, expect } from 'vitest';
import { parseUsecase, serializeUsecase } from '../src/diagrams/usecase';
import { validateModel } from '../src/model';

const SAMPLE = `系统: 在线商城
actor 顾客
actor 管理员
顾客 -> (浏览商品)
顾客 -> (下单)
(下单) include (支付)
(下单) extend (使用优惠券)
管理员 -> (管理库存)`;

const roles = (model: ReturnType<typeof parseUsecase>, role: string) =>
  model.nodes.filter((n) => n.data?.role === role);

describe('parseUsecase', () => {
  it('parses actors and auto-creates usecases', () => {
    const model = parseUsecase(SAMPLE);
    expect(model.kind).toBe('usecase');
    const actors = roles(model, 'actor');
    const usecases = roles(model, 'usecase');
    expect(actors.map((a) => a.data?.name)).toEqual(['顾客', '管理员']);
    // 浏览商品 / 下单 / 支付 / 使用优惠券 / 管理库存 — all auto-created.
    expect(usecases.map((u) => u.data?.name)).toEqual([
      '浏览商品',
      '下单',
      '支付',
      '使用优惠券',
      '管理库存',
    ]);
    // Actor label uses the emoji stick figure.
    expect(actors[0]!.label).toBe('🧍\n顾客');
    expect(actors[0]!.shape).toBe('text');
    expect(usecases[0]!.shape).toBe('stadium');
    expect(validateModel(model)).toEqual([]);
  });

  it('builds association edges as straight open lines', () => {
    const model = parseUsecase(SAMPLE);
    const open = model.edges.filter((e) => e.kind === 'open');
    expect(open).toHaveLength(3);
    expect(open[0]!.source).toBe('actor:顾客');
    expect(open[0]!.target).toBe('uc:浏览商品');
    expect(open.every((e) => e.data?.straight === true)).toBe(true);
  });

  it('builds include/extend as dotted edges with guillemet labels', () => {
    const model = parseUsecase(SAMPLE);
    const dotted = model.edges.filter((e) => e.kind === 'dotted');
    expect(dotted).toHaveLength(2);
    const inc = dotted.find((e) => e.label === '«include»')!;
    expect(inc.source).toBe('uc:下单');
    expect(inc.target).toBe('uc:支付');
    const ext = dotted.find((e) => e.label === '«extend»')!;
    expect(ext.source).toBe('uc:下单');
    expect(ext.target).toBe('uc:使用优惠券');
  });

  it('stores the system name in meta and as a locked title', () => {
    const model = parseUsecase(SAMPLE);
    expect(model.meta?.system).toBe('在线商城');
    const title = model.nodes.find((n) => n.data?.role === 'systemTitle')!;
    expect(title.label).toBe('在线商城');
    expect(title.data?.locked).toBe(true);
  });

  it('accepts full-width brackets, arrows and colon', () => {
    const model = parseUsecase(`系统：商城
actor 顾客
顾客 → （下单）
（下单） include （支付）`);
    expect(model.meta?.system).toBe('商城');
    expect(roles(model, 'usecase').map((u) => u.data?.name)).toEqual(['下单', '支付']);
    expect(model.edges.map((e) => e.kind)).toEqual(['open', 'dotted']);
  });

  it('omits system box/title when there is no content', () => {
    const model = parseUsecase('actor 甲\n甲 -> (乙)');
    expect(model.meta?.system).toBeUndefined();
    expect(model.nodes.find((n) => n.data?.role === 'systemTitle')).toBeUndefined();
    // Boundary box still wraps the usecases (untitled).
    expect(model.nodes.find((n) => n.data?.role === 'systemBox')).toBeDefined();
  });
});

describe('layout', () => {
  it('places actors in the left column and usecases inside the system box', () => {
    const model = parseUsecase(SAMPLE);
    for (const a of roles(model, 'actor')) expect(a.x).toBeLessThan(300);
    const box = model.nodes.find((n) => n.data?.role === 'systemBox')!;
    expect(box.data?.locked).toBe(true);
    for (const u of roles(model, 'usecase')) {
      expect(u.x - u.width / 2).toBeGreaterThanOrEqual(box.x - box.width / 2);
      expect(u.x + u.width / 2).toBeLessThanOrEqual(box.x + box.width / 2);
      expect(u.y - u.height / 2).toBeGreaterThanOrEqual(box.y - box.height / 2);
      expect(u.y + u.height / 2).toBeLessThanOrEqual(box.y + box.height / 2);
    }
  });

  it('clamps usecase width to [150, 300]', () => {
    const model = parseUsecase(`actor 甲
甲 -> (短)
甲 -> (一个非常非常非常非常非常非常非常长的用例名称)`);
    const [short, long] = roles(model, 'usecase');
    expect(short!.width).toBe(150);
    expect(long!.width).toBe(300);
  });
});

describe('serializeUsecase', () => {
  const lineSet = (s: string) => new Set(s.split('\n').filter((l) => l.trim() !== ''));

  it('round-trips: serialize(parse(x)) has the same semantic lines', () => {
    const text = serializeUsecase(parseUsecase(SAMPLE));
    expect(lineSet(text)).toEqual(lineSet(SAMPLE));
  });

  it('is idempotent across a second parse/serialize cycle', () => {
    const once = serializeUsecase(parseUsecase(SAMPLE));
    const twice = serializeUsecase(parseUsecase(once));
    expect(twice).toBe(once);
  });

  it('normalizes full-width input to canonical half-width output', () => {
    const text = serializeUsecase(
      parseUsecase('系统：商城\nactor 顾客\n顾客 → （下单）\n（下单） extend （优惠）'),
    );
    expect(text).toBe('系统: 商城\nactor 顾客\n顾客 -> (下单)\n(下单) extend (优惠)');
  });

  it('emits sections in canonical order: system, actors, assoc, include/extend', () => {
    const lines = serializeUsecase(parseUsecase(SAMPLE)).split('\n');
    expect(lines[0]).toBe('系统: 在线商城');
    expect(lines[1]).toBe('actor 顾客');
    expect(lines[2]).toBe('actor 管理员');
    expect(lines.slice(3, 6)).toEqual([
      '顾客 -> (浏览商品)',
      '顾客 -> (下单)',
      '管理员 -> (管理库存)',
    ]);
    expect(lines.slice(6)).toEqual(['(下单) include (支付)', '(下单) extend (使用优惠券)']);
  });
});
