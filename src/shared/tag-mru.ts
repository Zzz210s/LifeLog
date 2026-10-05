/**
 * 「固定标签 + 标签 MRU」的注入面(结构类型):两处候选都用它,但**实例只能有一份**。
 *
 * 仓内 `PaletteSettings` 的内存实例已有三份(输入栏 `InputBar`、主窗 `StreamView`、
 * 主窗候选 `use-app-palette`)——这是三个窗口/接线各读一次库的既有事实,不是本类型要解决的事。
 * 本类型的作用是让**新的消费方**(标签菜单携带面板)顺着组件树拿既有那份,而不是 `usePaletteSettings`
 * 再建第四份:菜单在 `App` 之下,拿得到 `useAppPalette` 里那一份。
 */
import type { MruEntry } from './quickpick/model';

export interface TagMruSource {
  /** 固定项(`ui.pinned.tags`),数组顺序即固定档顺序 */
  readonly pinnedTags: readonly string[];
  /** 标签 MRU(`ui.mru.tags`,id = 标签完整路径);只有输入栏采纳时才 touch */
  readonly mruTags: { touch(id: string): void; entries(): MruEntry[] };
}
