/**
 * `[[` 补全的笔记 MRU 注入面(结构类型):与 `#` 补全的 `TagMruSource` 同形,id = 笔记 id 的
 * 十进制字符串(与候选项 id 同一口径)。真源是既有那份浮层设置里的 `ui.mru.notes`
 * (`PaletteSettings.mruNotes`),三处输入点在同一窗口里共用同一个内存实例(跨窗靠同一 KV 键持久化)。
 */
import type { MruEntry } from './quickpick/model';

export interface NoteMruSource {
  /** 按次数降序(同次数按最近使用在前),供空查询的「最近用过」档 */
  entries(): readonly MruEntry[];
  /** 采纳一次:+1(并在有落盘调度时标脏) */
  touch(id: string): void;
}
