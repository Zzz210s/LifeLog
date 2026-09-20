/**
 * 笔记卡片 chip 的分组与折叠(spec 2026-09-20 §5.3 / D10 / D11):
 * 主题标签一排(沿用现有样式)、属性标签一排(更小、底色弱化);
 * 超出阈值**只折叠不隐藏**(`+N` 点击展开整排),悬浮 title 与点击行为都不变。
 * 判定按**路径首段**,全部无副作用,可单测;UI 在 NoteChips 里消费。
 */

/** 属性根(路径首段):命中即为属性标签,其余一律算主题标签(D10,固定清单) */
export const ATTR_ROOTS = ['状态', '产地', '渠道', '平台', '作者国籍', '日期'];

/** 折叠阈值:主题最多 6 个、属性最多 4 个(D11,可调;超出显示 +N) */
export const TOPIC_MAX = 6;
export const ATTR_MAX = 4;

export interface ChipGroups {
  /** 主题标签(保持输入顺序 = 笔记的标签顺序) */
  topic: string[];
  /** 属性标签(路径首段命中 ATTR_ROOTS) */
  attrs: string[];
}

/** 路径首段(标签路径的根) */
export function chipRoot(path: string): string {
  const i = path.indexOf('/');
  return i < 0 ? path : path.slice(0, i);
}

/** 按路径首段分组:属性根命中进 attrs,其余进 topic;两排都保持输入顺序 */
export function groupChips(tags: readonly string[]): ChipGroups {
  const topic: string[] = [];
  const attrs: string[] = [];
  for (const t of tags) {
    if (ATTR_ROOTS.includes(chipRoot(t))) attrs.push(t);
    else topic.push(t);
  }
  return { topic, attrs };
}

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
  // 标签数量级很小(单条笔记几个到十几个),直接两两比对,不引入额外结构
  return tags.filter((t) => !tags.some((o) => o !== t && o.startsWith(t + '/')));
}
