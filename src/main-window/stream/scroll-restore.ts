// 进编辑时的滚动位置还原(纯函数,便于单测)。
//
// 为什么需要:编辑面板比原卡片高(实测 +57 ~ +81 CSS px),浏览器**滚动锚定**会在内容尺寸变化后
// 补偿性地改 `scrollTop`,于是被点的卡片会整体上移(实测被视口裁掉的卡片上移 200px = 直接跳回卡片顶部)。
// 单靠 `focus({preventScroll:true})` 只能挡掉"焦点元素滚进视野"这一条路,挡不住滚动锚定。
// 做法:进编辑前记下 `scrollTop`,面板挂载并聚焦完成后写回同一个值 —— 卡片与视口都不动。
//
// 边界:`saved` 为 null(父层没记,例如整表刷新)时不动作;`scrollTop` 已是目标值时也不写
// (避免把浏览器的锚定结果反复钉住而影响后续滚动)。
export function applyScrollRestore(el: { scrollTop: number } | null, saved: number | null): boolean {
  if (!el || saved === null || !Number.isFinite(saved)) return false;
  if (el.scrollTop === saved) return false;
  el.scrollTop = saved;
  return true;
}
