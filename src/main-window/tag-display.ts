/** 标签 chips 的显示名:默认只显示末级名称,悬浮 title 另给完整路径。
 *  maxDepth 保留末 n 级(n<=1 等价于只显示末级);层级未超过 maxDepth 时原样返回。
 *  例:tagDisplayName('工作/项目A/会议') === '会议';maxDepth=2 时为 '项目A/会议'。 */
export function tagDisplayName(path: string, maxDepth = 1): string {
  const parts = path.split('/');
  const keep = Math.max(1, Math.floor(maxDepth) || 1);
  return parts.length <= keep ? path : parts.slice(parts.length - keep).join('/');
}
