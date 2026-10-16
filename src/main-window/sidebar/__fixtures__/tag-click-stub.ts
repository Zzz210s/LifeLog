/**
 * `TagsSection` 的 `click` 接线哑桩(仅测试):只关心渲染 / 收窄搜索 / 菜单候选的用例不必铺一整套
 * 回调与状态。真实接线(光标 + 预览 + 意图执行)在 `use-tag-click`,
 * 端到端证据见 `tag-cursor-flow.dom.test.ts` 与 `__fixtures__/click-flow-harness`。
 */
import type { TagClickApi } from '../use-tag-click';

export function stubTagClick(over: Partial<TagClickApi> = {}): TagClickApi {
  return {
    clickMode: 'filter',
    cursorPath: null,
    previewPath: null,
    apply: () => {},
    onListBlankClick: () => {},
    changeClickMode: () => {},
    onlyThis: () => {},
    cursor: null,
    preview: null,
    flash: null,
    showFlash: () => {},
    ...over,
  };
}
