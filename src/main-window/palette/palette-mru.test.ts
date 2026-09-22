/** 浮层设置装配的单测:默认值、坏数据容错、MRU 载入/标脏/落盘(退出与空闲都走 saveMru) */
import { describe, expect, it, vi } from 'vitest';
import { PALETTE_LIMIT_DEFAULT, PALETTE_SETTING_KEYS } from './palette-settings';
import { MRU_CAPACITY, loadPaletteSettings } from './palette-mru';
import type { SettingIo } from './palette-mru';

function io(initial: Record<string, string> = {}): SettingIo & { writes: Array<[string, string]> } {
  const writes: Array<[string, string]> = [];
  return {
    writes,
    read: async (key: string) => initial[key] ?? null,
    write: async (key: string, value: string) => {
      writes.push([key, value]);
    },
  };
}

describe('palette-mru:读取与默认值', () => {
  it('四个键都缺失时:空 MRU、无固定标签、上限回缺省', async () => {
    const s = await loadPaletteSettings(io());
    expect(s.mruCommands.entries()).toEqual([]);
    expect(s.mruNotes.entries()).toEqual([]);
    expect(s.pinnedTags).toEqual([]);
    expect(s.limit).toBe(PALETTE_LIMIT_DEFAULT);
  });

  it('坏 JSON / 非法条目不影响装配(逐条丢弃,不抛)', async () => {
    const s = await loadPaletteSettings(
      io({
        [PALETTE_SETTING_KEYS.mruCommands]: '{坏',
        [PALETTE_SETTING_KEYS.mruNotes]: '[{"id":"n1","count":"NaN"}]',
        [PALETTE_SETTING_KEYS.pinnedTags]: '["工作", 3, ""]',
        [PALETTE_SETTING_KEYS.limit]: 'abc',
      }),
    );
    expect(s.mruCommands.entries()).toEqual([]);
    expect(s.mruNotes.entries()).toEqual([]);
    expect(s.pinnedTags).toEqual(['工作']);
    expect(s.limit).toBe(PALETTE_LIMIT_DEFAULT);
  });

  it('读取抛异常时同样回默认(不阻断浮层)', async () => {
    const broken: SettingIo = {
      read: async () => {
        throw new Error('设置表坏了');
      },
      write: async () => {},
    };
    const s = await loadPaletteSettings(broken);
    expect(s.mruCommands.entries()).toEqual([]);
    expect(s.limit).toBe(PALETTE_LIMIT_DEFAULT);
  });

  it('已有 MRU 文本按最近序载入,容量受 MRU_CAPACITY 约束', async () => {
    const many = Array.from({ length: MRU_CAPACITY + 5 }, (_, i) => ({ id: `n${i}`, count: 1 }));
    const s = await loadPaletteSettings(
      io({
        [PALETTE_SETTING_KEYS.mruNotes]: JSON.stringify(many),
        [PALETTE_SETTING_KEYS.limit]: '5',
      }),
    );
    expect(s.mruNotes.entries()).toHaveLength(MRU_CAPACITY);
    expect(s.limit).toBe(5);
  });
});

describe('palette-mru:只在有改动时落盘', () => {
  it('未 touch 时 saveMru 不写;touch 后写回对应键并清脏', async () => {
    const store = io();
    const s = await loadPaletteSettings(store);
    s.saveMru();
    expect(store.writes).toEqual([]);

    s.mruNotes.touch('42');
    s.saveMru();
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0][0]).toBe(PALETTE_SETTING_KEYS.mruNotes);
    expect(JSON.parse(store.writes[0][1])).toEqual([{ id: '42', count: 1 }]);

    s.saveMru(); // 已清脏:不再写
    expect(store.writes).toHaveLength(1);
  });

  it('落盘失败静默(不抛),同一份快照不重复写', async () => {
    const write = vi.fn(async () => {
      throw new Error('磁盘满');
    });
    const s = await loadPaletteSettings({ read: async () => null, write });
    s.mruCommands.touch('note.new');
    expect(() => s.saveMru()).not.toThrow();
    s.saveMru(); // 本次已清脏,不重复写
    expect(write).toHaveBeenCalledTimes(1);
  });
});
