/**
 * 笔记卡片 chip 的折叠与显示层去重(2026-10-12「引用并入关系」后):
 * 数据层只有「关系」一个概念 —— `lines(from_id, to_id, name_id)` 上 `name_id` 空 = 无名字关系
 * (标签 `#X`、`[[链接]]`),非空 = 有名字的关系。卡片上因此**只有一套 chip**,不再按
 * 主题/属性分两排(D10 的两排口径随本次合并作废)。
 *
 * 顺序 = **数据给的稳定序**(`read_full` 按目标路径升序读回,`note.tags` 即该序):不重排,
 * 免得同一条目每次渲染顺序漂移;有名字的关系若有,也在这个序里,不做「有名字的在前」的特殊排。
 * 全部无副作用,可单测;UI 在 NoteChips 里消费。
 */

/** 折叠阈值:原「主题 6 + 属性 4」两排的可见额度之和,合并成单排后沿用同一总可见量 */
export const CHIP_MAX = 10;

/** 折叠:超过 max 只保留前 max 个,并给出被折叠的条数(渲染为 `+N`) */
export function collapseChips(
  list: readonly string[],
  max: number
): { shown: string[]; hidden: number } {
  if (list.length <= max) return { shown: [...list], hidden: 0 };
  return { shown: list.slice(0, max), hidden: list.length - max };
}

/**
 * 祖先折叠(子蕴含父,spec D9 的显示层配套):若某标签的**后代**也在同一张卡片的标签集合里,
 * 就把祖先从 chip 行里去掉 —— `#信息/本科` 已经蕴含 `#信息`,两个都显示只是噪声。
 * 只影响显示:库里标签数据一个字节不动,点父标签筛全部后代的能力(可选性)也不受影响。
 * 判定按路径前缀(与筛选的"含子级"同一口径),保持输入顺序,无副作用可单测。
 */
export function collapseAncestors(tags: readonly string[]): string[] {
  // 标签数量级很小(单个条目几个到十几个),直接两两比对,不引入额外结构
  return tags.filter((t) => !tags.some((o) => o !== t && o.startsWith(t + '/')));
}
