/**
 * 编辑面板实时标签数的显示口径与竞态守卫(纯逻辑,便于单测)。
 * 解析结果的唯一真源是后端命令 `parse_note_source`(与保存路径共用同一实现),
 * 前端不复制标签语法 —— 这里只处理"什么时候敢用解析值、什么时候回退"。
 */

/** 输入停止后多久发起解析(防抖;连打时不产生请求风暴) */
export const SOURCE_TAG_DEBOUNCE_MS = 250;

/** 一次成功解析的读数,按**源码文本**记名(与 use-tag-complete 的按词元记名同一手法) */
export interface SourceTagPreview {
  source: string;
  count: number;
}

/**
 * 显示用标签数:只有"解析结果对应**当前**源码"时才用解析值;
 * 其余情形(尚未返回 / 请求失败 / 源码已变)一律回退**已保存**标签数 —— 不闪烁成 0。
 */
export function displayedTagCount(
  preview: SourceTagPreview | null,
  source: string,
  savedCount: number
): number {
  return preview !== null && preview.source === source ? preview.count : savedCount;
}

/** 请求序号守卫:发起时取号,只有号仍是最新时才采纳响应;换源/卸载时作废在途请求 */
export interface RequestGate {
  next: () => number;
  isCurrent: (id: number) => boolean;
  invalidate: () => void;
}

export function createRequestGate(): RequestGate {
  let current = 0;
  return {
    next: () => ++current,
    isCurrent: (id) => id === current,
    invalidate: () => {
      current++;
    },
  };
}
