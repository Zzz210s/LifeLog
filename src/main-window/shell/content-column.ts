/**
 * 内容列宽度档(视觉刷新 V4,设计 §4-7 / D10):有侧栏时 768(max-w-3xl);
 * 侧栏隐藏后画面只剩一列,放宽到 1024(max-w-5xl),避免两侧空出大片白。
 *
 * 宽度只由「侧栏是否可见」这一个既有状态决定(不新造状态);返回的是 Tailwind 类名,
 * 与 App 里那个既当布局容器又当焦点归位锚点的 div 拼在一起用。
 */
export function contentColumnClass(sidebarVisible: boolean): string {
  return sidebarVisible ? 'max-w-3xl' : 'max-w-5xl';
}
