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
    expect(JSON.parse(storage.writes[0])).toEqual([{ id: 'a', count: 1 }]);
    expect(mru.hasChanges()).toBe(false);

    mru.save();
    expect(storage.writes).toHaveLength(1);
  });

  it('写入格式是按最近序升序的数组(最近序由数组顺序承载)', () => {
    const storage = fakeStorage();
    const mru = createMru({ capacity: 5, storage });
    mru.touch('cmd.export');
    mru.touch('cmd.export');
    mru.touch('note.new');
    mru.save();
    expect(JSON.parse(storage.writes[0])).toEqual([
      { id: 'cmd.export', count: 2 },
      { id: 'note.new', count: 1 },
    ]);
  });

  it('二次创建从注入的存储读回(退出落盘的语义)', () => {
    const storage = fakeStorage();
    const first = createMru({ capacity: 5, storage });
    first.touch('a');
    first.touch('b');
    first.save();

    const second = createMru({ capacity: 5, storage: fakeStorage(storage.writes[0]) });
    expect(second.entries()).toEqual([
      { id: 'b', count: 1 },
      { id: 'a', count: 1 },
    ]);
    expect(second.count('a')).toBe(1);
    expect(second.hasChanges()).toBe(false);
  });
});

describe('MRU:整数 id 的最近序往返', () => {
  it('整数 id 走一次 save→reload,顺序与会话内逐项相同', () => {
    const storage = fakeStorage();
    const first = createMru({ capacity: 10, storage });
    for (const id of ['3', '7', '11', '2', '5']) first.touch(id);
    expect(first.entries().map((e) => e.id)).toEqual(['5', '2', '11', '7', '3']);
    expect(first.save()).toBe(true);

    const second = createMru({ capacity: 10, storage: fakeStorage(storage.writes[0]) });
    expect(second.entries()).toEqual(first.entries());
  });

  it('旧格式(id → 次数 对象)仍可读,顺序退化为键序(整数 id 即数值升序)', () => {
    const mru = createMru({ capacity: 10, storage: fakeStorage('{"3":1,"7":1,"11":1}') });
    expect(mru.entries()).toEqual([
      { id: '11', count: 1 },
      { id: '7', count: 1 },
      { id: '3', count: 1 },
    ]);
  });

  it('载入即裁剪到 capacity(不必等下一次 touch)', () => {
    const mru = createMru({
      capacity: 2,
      storage: fakeStorage('[{"id":"a","count":5},{"id":"b","count":4},{"id":"c","count":3}]'),
    });
    expect(mru.entries()).toEqual([
      { id: 'a', count: 5 },
      { id: 'b', count: 4 },
    ]);
  });
});

describe('MRU:坏数据容错重建', () => {
  it('坏 JSON 不抛,touch/save 照常', () => {
    const storage = fakeStorage('{oops');
    const mru = createMru({ capacity: 5, storage });
    expect(mru.entries()).toEqual([]);
    mru.touch('a');
    mru.save();
    expect(JSON.parse(storage.writes[0])).toEqual([{ id: 'a', count: 1 }]);
  });

  it('非对象 / 非法数组元素 / 非法条目一律丢弃', () => {
    expect(createMru({ capacity: 5, storage: fakeStorage('["a"]') }).entries()).toEqual([]);
    expect(createMru({ capacity: 5, storage: fakeStorage('"a"') }).entries()).toEqual([]);
    expect(createMru({ capacity: 5, storage: fakeStorage('null') }).entries()).toEqual([]);

    const badArray = '[{"id":"a"},{"id":"","count":1},{"id":"b","count":-1},{"id":"c","count":"2"},null]';
    expect(createMru({ capacity: 5, storage: fakeStorage(badArray) }).entries()).toEqual([]);

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
