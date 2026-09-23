/**
 * 浮层设置的读写装配(设计 §5 / D6):MRU 三份(命令/笔记/标签)+ 固定标签 + 渲染上限。
 *
 * 标签 MRU 由 T8(输入栏 `#` 补全)使用:同一份装配同时供主窗浮层与输入栏读取,
 * 避免第二套 MRU 实现(设计 D6 的「MRU + 固定项」是一套逻辑,两个界面共用)。
 *
 * - 读:五个键一次并发读,任一失败/损坏都回默认(坏数据不能把浮层搞挂);
 *   MRU 文本交给 `createMru` 解析(它自带容错与容量裁剪),固定标签与上限走 palette-settings 的消毒。
 * - 写:**只在接受时标脏,退出/空闲落盘**(`saveMru()` 有改动才写);写失败静默
 *   (IPC 失败时本次快照丢失,下次 touch 会重新标脏)。
 */
import { createMru } from '../../shared/quickpick/mru';
import type { Mru, MruStorage } from '../../shared/quickpick/mru';
import { PALETTE_SETTING_KEYS, parsePinnedTags, sanitizeLimit } from './palette-settings';

export interface SettingIo {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

export interface PaletteSettings {
  mruCommands: Mru;
  mruNotes: Mru;
  /** 标签 MRU(输入栏 `#` 补全的「最近用过」档;id = 标签完整路径) */
  mruTags: Mru;
  pinnedTags: readonly string[];
  limit: number;
  /** 两份 MRU 有改动才落盘;写失败静默(不抛、不阻塞退出) */
  saveMru(): void;
}

/** MRU 容量(命令/笔记各一份;超出按"次数少、最近未用"淘汰) */
export const MRU_CAPACITY = 50;

async function safeRead(io: SettingIo, key: string): Promise<string | null> {
  try {
    return await io.read(key);
  } catch {
    return null; // 读失败 = 没设置
  }
}

/** MRU 的落盘通道:读走创建时注入的初始文本(createMru 只在创建时读一次) */
function storageFor(io: SettingIo, key: string, initial: string | null): MruStorage {
  return {
    read: () => initial,
    write: (text: string) => {
      void io.write(key, text).catch(() => {});
    },
  };
}

export async function loadPaletteSettings(io: SettingIo): Promise<PaletteSettings> {
  const [commands, notes, tags, pinned, limit] = await Promise.all([
    safeRead(io, PALETTE_SETTING_KEYS.mruCommands),
    safeRead(io, PALETTE_SETTING_KEYS.mruNotes),
    safeRead(io, PALETTE_SETTING_KEYS.mruTags),
    safeRead(io, PALETTE_SETTING_KEYS.pinnedTags),
    safeRead(io, PALETTE_SETTING_KEYS.limit),
  ]);
  const mruCommands = createMru({
    capacity: MRU_CAPACITY,
    storage: storageFor(io, PALETTE_SETTING_KEYS.mruCommands, commands),
  });
  const mruNotes = createMru({
    capacity: MRU_CAPACITY,
    storage: storageFor(io, PALETTE_SETTING_KEYS.mruNotes, notes),
  });
  const mruTags = createMru({
    capacity: MRU_CAPACITY,
    storage: storageFor(io, PALETTE_SETTING_KEYS.mruTags, tags),
  });
  return {
    mruCommands,
    mruNotes,
    mruTags,
    pinnedTags: parsePinnedTags(pinned),
    limit: sanitizeLimit(limit),
    saveMru: () => {
      mruCommands.save();
      mruNotes.save();
      mruTags.save();
    },
  };
}
