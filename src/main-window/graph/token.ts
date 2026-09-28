/**
 * 画布取色:颜色一律从主题令牌读,不写死色值(全局约束;设计 §3.3)。
 * 令牌值是**读到的那一刻**才生效的,所以亮暗切换必须靠重绘/重建 plan 才能体现
 * (调用方用 useThemeKey 拿到主题键,放进 GraphCanvas 的守卫与 plan 的依赖里)。
 * 令牌缺失(jsdom、名字写错)退回 transparent:画布上不会留上一次主题的残色。
 */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'transparent';
}
