// 主题三态:设置值的解析与「是否需要暗色」的纯判定(单测见 theme-mode.test.ts)。
// 这里只放纯数据与纯逻辑;DOM 落点(class 切换、系统主题监听、广播)在 shared/use-theme-mode.ts。
export type ThemeMode = 'system' | 'light' | 'dark';

/** 设置表里的键(与既有 input_* 键同表,通用 KV,新增键无需改 Rust) */
export const THEME_KEY = 'theme';

/** 默认跟随系统(设计文档 5.3) */
export const THEME_DEFAULT: ThemeMode = 'system';

/** 主窗 -> 输入栏的主题广播事件名(输入栏只换内部配色,窗口本身保持透明) */
export const THEME_EVENT = 'lifelog://theme';

/** 设置页「外观」分区的三个单选(数组顺序即界面顺序) */
export const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
];

/** 设置值 -> 三态:缺失、空串与非法值一律回退 system(不猜测用户意图,也不落库改写) */
export function parseThemeMode(raw: string | null | undefined): ThemeMode {
  return raw === 'light' || raw === 'dark' ? raw : THEME_DEFAULT;
}

/** 三态 + 系统偏好 -> 是否暗色(system 时完全跟随系统) */
export function resolveDark(mode: ThemeMode, systemPrefersDark: boolean): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return systemPrefersDark;
}

/** 广播载荷 -> 三态:只接受字符串,载荷异常时回退默认值(输入栏不该被坏载荷带偏) */
export function parseThemePayload(payload: unknown): ThemeMode | null {
  return typeof payload === 'string' ? parseThemeMode(payload) : null;
}
