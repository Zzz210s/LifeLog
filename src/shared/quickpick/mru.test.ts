import { describe, expect, it } from 'vitest';
import { createMru, type MruStorage } from './mru';

/** 内存假存储:记录写入次数与被写入的原始文本(落盘由调用方注入,模块本身无 IO) */
function fakeStorage(initial: string | null = null): MruStorage & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    read: () => initial,
    write: (text: string) => {
      writes.push(text);
    },
  };
}

describe('MRU:计数递增', () => {
  it('未记录的 id 计数为 0,touch 后递增', () => {
    const mru = createMru({ capacity: 5, storage: fakeStorage() });
    expect(mru.count('a')).toBe(0);
    mru.touch('a');
    mru.touch('a');
    mru.touch('b');
    expect(mru.count('a')).toBe(2);
    expect(mru.count('b')).toBe(1);
  });

  it('entries 按次数降序;同次数按最近使用在前', () => {
    const mru = createMru({ capacity: 5, storage: fakeStorage() });
    mru.touch('a');
    mru.touch('b');
    mru.touch('c');
    mru.touch('a');
    expect(mru.entries()).toEqual([
      { id: 'a', count: 2 },
      { id: 'c', count: 1 },
      { id: 'b', count: 1 },
    ]);
  });

  it('空 id 直接忽略(不写坏数据)', () => {
    const mru = createMru({ capacity: 5, storage: fakeStorage() });
    mru.touch('');
    expect(mru.entries()).toEqual([]);
  });
});

describe('MRU:容量淘汰', () => {
  it('超出容量时淘汰次数最少的;同次数淘汰最久未用', () => {
    const mru = createMru({ capacity: 2, storage: fakeStorage() });
    mru.touch('a');
    mru.touch('b');
    mru.touch('c');
    expect(mru.entries().map((e) => e.id).sort()).toEqual(['b', 'c']);
    expect(mru.count('a')).toBe(0);
  });

  it('次数高的保留,即使更久没用过', () => {
    const mru = createMru({ capacity: 2, storage: fakeStorage() });
    mru.touch('a');
    mru.touch('a');
    mru.touch('b');
    mru.touch('c');
    expect(mru.entries()).toEqual([
      { id: 'a', count: 2 },
      { id: 'c', count: 1 },
    ]);
  });
});

describe('MRU:hasChanges 与落盘时机', () => {
  it('初始无改动;touch 标脏;save 写入后才清脏', () => {
    const storage = fakeStorage();
    const mru = createMru({ capacity: 5, storage });
    expect(mru.hasChanges()).toBe(false);
    expect(mru.save()).toBe(false);
    expect(storage.writes).toHaveLength(0);

    mru.touch('a');
    expect(mru.hasChanges()).toBe(true);
    expect(mru.save()).toBe(true);
    expect(JSON.parse(storage.writes[0])).toEqual({ a: 1 });
    expect(mru.hasChanges()).toBe(false);

    mru.save();
    expect(storage.writes).toHaveLength(1);
  });

  it('写入格式是 id → 次数 的普通对象(设计 §5 的 ui.mru.*)', () => {
    const storage = fakeStorage();
    const mru = createMru({ capacity: 5, storage });
    mru.touch('cmd.export');
    mru.touch('cmd.export');
    mru.touch('note.new');
    mru.save();
    expect(JSON.parse(storage.writes[0])).toEqual({ 'cmd.export': 2, 'note.new': 1 });
  });

  it('二次创建从注入的存储读回(退出落盘的语义)', () => {
    const storage = fakeStorage();
    const first = createMru({ capacity: 5, storage });
    first.touch('a');
    first.touch('b');
    first.save();

    const second = createMru({ capacity: 5, storage: fakeStorage(storage.writes[0]) });
    // 载入时按 JSON 键顺序把靠后的键当作更近(同次数排序的兜底)
    expect(second.entries()).toEqual([
      { id: 'b', count: 1 },
      { id: 'a', count: 1 },
    ]);
    expect(second.count('a')).toBe(1);
    expect(second.hasChanges()).toBe(false);
  });
});

describe('MRU:坏数据容错重建', () => {
  it('坏 JSON 不抛,touch/save 照常', () => {
    const storage = fakeStorage('{oops');
    const mru = createMru({ capacity: 5, storage });
    expect(mru.entries()).toEqual([]);
    mru.touch('a');
    mru.save();
    expect(JSON.parse(storage.writes[0])).toEqual({ a: 1 });
  });

  it('非对象 / 数组 / 非法条目一律丢弃', () => {
    expect(createMru({ capacity: 5, storage: fakeStorage('["a"]') }).entries()).toEqual([]);
    expect(createMru({ capacity: 5, storage: fakeStorage('"a"') }).entries()).toEqual([]);
    expect(createMru({ capacity: 5, storage: fakeStorage('null') }).entries()).toEqual([]);

    const mru = createMru({
      capacity: 5,
      storage: fakeStorage('{"a":-3,"b":"x","c":2,"d":1.9,"":5,"e":null}'),
    });
    expect(mru.entries()).toEqual([
      { id: 'c', count: 2 },
      { id: 'd', count: 1 },
    ]);
  });

  it('storage.read 抛错也当空表处理', () => {
    const mru = createMru({
      capacity: 5,
      storage: {
        read: () => {
          throw new Error('磁盘炸了');
        },
        write: () => {},
      },
    });
    expect(mru.entries()).toEqual([]);
  });
});
