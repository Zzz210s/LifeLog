/**
 * MRU 计数侧(D6):会话内内存,落盘由调用方注入(退出/空闲时 save);模块本身**不做 IO**。
 *
 * 落盘格式是**数组** `[{id, count}]`,按最近序升序(数组尾 = 最近):最近序由数组顺序承载,
 * 不能寄托在 JSON 键序上 —— 整数形态的 id(笔记 / 标签 id)在对象里按数值升序枚举,会丢最近序。
 * 旧格式(id → 次数 的普通对象,设计 §5 `ui.mru.*` 的初始形态)仍可读,顺序退化为键序。
 * 坏数据一律容错重建:坏 JSON / 非对象 / 非法条目都只是"没记住",不能让坏数据把浮层搞挂。
 */

export interface MruStorage {
  read(): string | null;
  write(text: string): void;
}

export interface MruEntry {
  readonly id: string;
  readonly count: number;
}

export interface Mru {
  /** 接受一次:+1;空 id 忽略 */
  touch(id: string): void;
  count(id: string): number;
  /** 按次数降序(同次数按最近使用在前),供空查询的「最近用过」档 */
  entries(): MruEntry[];
  /** 自上次 save 后是否有改动(决定退出时是否真要写盘) */
  hasChanges(): boolean;
  /** 有改动才写;写失败不抛且保留脏标记(下次再试)。返回是否真的落盘 */
  save(): boolean;
}

interface Usage {
  count: number;
  /** 最近使用序号,越大越近;用于同次数的淘汰与排序 */
  seq: number;
}

const DEFAULT_CAPACITY = 50;
const NOOP_STORAGE: MruStorage = { read: () => null, write: () => {} };

/** 合法次数:正有限数向下取整;其余(非数字 / 0 / 负数 / Infinity)给 undefined = 条目丢弃 */
function readCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

/** 新格式的一条记录 `{id, count}`;结构不对给 undefined */
function readRecord(entry: unknown): { id: string; count: number } | undefined {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
  const { id, count } = entry as { id?: unknown; count?: unknown };
  const parsed = readCount(count);
  if (typeof id !== 'string' || id === '' || parsed === undefined) return undefined;
  return { id, count: parsed };
}

/**
 * 解析持久化文本:数组 = 新格式(数组序即最近序,尾为最近,重复 id 取最后一次出现);
 * 对象 = 旧格式(id → 次数,顺序退化为键序)。非法条目逐条丢弃,坏 JSON / 非对象给空表。
 */
function parse(text: string | null): Map<string, Usage> {
  const map = new Map<string, Usage>();
  if (!text) return map;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return map;
  }
  if (typeof parsed !== 'object' || parsed === null) return map;

  let seq = 0;
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const record = readRecord(entry);
      if (record) map.set(record.id, { count: record.count, seq: seq++ });
    }
    return map;
  }

  for (const [id, value] of Object.entries(parsed)) {
    const count = readCount(value);
    if (id === '' || count === undefined) continue;
    map.set(id, { count, seq: seq++ });
  }
  return map;
}

/** 下一个可用序号:比载入的所有 seq 都大(丢弃条目会让序号不连续,不能用 size) */
function nextSeqOf(records: Map<string, Usage>): number {
  let next = 0;
  for (const usage of records.values()) next = Math.max(next, usage.seq + 1);
  return next;
}

export function createMru(options: { capacity?: number; storage?: MruStorage } = {}): Mru {
  const capacity = Math.max(0, Math.floor(options.capacity ?? DEFAULT_CAPACITY));
  const storage = options.storage ?? NOOP_STORAGE;

  let records: Map<string, Usage>;
  try {
    records = parse(storage.read());
  } catch {
    records = new Map(); // 读数失败(权限/磁盘)同样按空表处理
  }
  let nextSeq = nextSeqOf(records);
  let changed = false;

  /** 超容量时淘汰:先比次数(少者出),再比最近使用(久者出) */
  function evict(): void {
    while (records.size > capacity) {
      let victim = '';
      let worst: Usage | undefined;
      for (const [id, usage] of records) {
        if (!worst || usage.count < worst.count || (usage.count === worst.count && usage.seq < worst.seq)) {
          victim = id;
          worst = usage;
        }
      }
      if (worst === undefined) break;
      records.delete(victim);
    }
  }

  evict(); // 载入即裁剪:旧版更大的表或调小 capacity 都不得越界

  return {
    touch(id: string): void {
      if (!id) return;
      records.set(id, { count: (records.get(id)?.count ?? 0) + 1, seq: nextSeq++ });
      changed = true;
      evict();
    },

    count: (id: string) => records.get(id)?.count ?? 0,

    entries(): MruEntry[] {
      return [...records.entries()]
        .sort((a, b) => b[1].count - a[1].count || b[1].seq - a[1].seq)
        .map(([id, usage]) => ({ id, count: usage.count }));
    },

    hasChanges: () => changed,

    save(): boolean {
      if (!changed) return false;
      const ordered = [...records.entries()]
        .sort((a, b) => a[1].seq - b[1].seq) // 按最近序升序落盘:数组顺序承载最近序
        .map(([id, usage]) => ({ id, count: usage.count }));
      try {
        storage.write(JSON.stringify(ordered));
      } catch {
        return false; // 写盘失败保留脏标记,由下次 save 重试
      }
      changed = false;
      return true;
    },
  };
}
