/**
 * MRU 计数侧(D6):会话内内存,落盘由调用方注入(退出/空闲时 save);模块本身**不做 IO**。
 *
 * 存储格式是 id → 次数 的普通对象(设计 §5 `ui.mru.*` 默认 `{}`)。坏数据一律容错重建:
 * 坏 JSON / 非对象 / 非法条目都只是"没记住",不能让坏数据把浮层搞挂。
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

/** 解析持久化文本:坏 JSON 或非对象返回空表;非法条目逐条丢弃 */
function parse(text: string | null): Map<string, Usage> {
  const map = new Map<string, Usage>();
  if (!text) return map;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return map;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return map;

  let seq = 0;
  for (const [id, value] of Object.entries(parsed)) {
    if (id === '' || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    map.set(id, { count: Math.floor(value), seq: seq++ });
  }
  return map;
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
  let nextSeq = records.size;
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
      const plain: Record<string, number> = {};
      for (const [id, usage] of records) plain[id] = usage.count;
      try {
        storage.write(JSON.stringify(plain));
      } catch {
        return false; // 写盘失败保留脏标记,由下次 save 重试
      }
      changed = false;
      return true;
    },
  };
}
