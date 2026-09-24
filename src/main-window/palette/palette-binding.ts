/**
 * 前缀 -> (固定项 / 最近用过 / 上限) 的纯推导(自 `use-app-palette` 抽出以守 200 行红线)。
 *
 * 三个 id 空间**不能串**:笔记 id 是数字、命令 id 是点分 ASCII、标签是路径 —— 把标签固定项
 * 传给笔记列表,"标签名恰好等于某条笔记 id"这种巧合就会改变列表顺序。`@`(统一输入框的
 * 「打开笔记」)与默认档(`''`)共用同一份笔记 MRU:两处的行 id 都是笔记 id。
 */
import type { MruEntry } from '../../shared/quickpick/model';
import type { PaletteSettings } from './palette-mru';

export interface PaletteBinding {
  pinned: readonly string[];
  mru: readonly MruEntry[];
  /** 缺省交给列表模型(不在这里填默认值) */
  limit: number | undefined;
}

export function paletteBinding(prefix: string, settings: PaletteSettings | null): PaletteBinding {
  const pinned = prefix === '#' ? (settings?.pinnedTags ?? []) : [];
  const notesMru = prefix === '' || prefix === '@';
  const mru =
    prefix === '>' ? (settings?.mruCommands.entries() ?? []) : notesMru ? (settings?.mruNotes.entries() ?? []) : [];
  return { pinned, mru, limit: settings?.limit };
}
