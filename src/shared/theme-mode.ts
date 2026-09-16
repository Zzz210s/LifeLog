// 主题三态:设置值的解析与「是否需要暗色」的纯判定(单测见 theme-mode.test.ts)。
// 这里只放纯数据与纯逻辑;DOM 落点(class 切换、系统主题监听、广播)在 shared/use-theme-mode.ts。
export type ThemeMode = 'system' | 'light' | 'dark';

/** 设置表里的键(与既有 input_* 键同表,通用 KV,新增键无需改 Rust) */
export const THEME_KEY = 'theme';

/** 默认跟随系统(设计文档 5.3) */
export const THEME_DEFAULT: ThemeMode = 'system';

/** 主窗 -> 输入栏的主题广播事件名(输入栏只换内部配色,窗口本身保持透明) */
export const THEME_EVENT = 'lifelog://theme';

/** 首帧主题镜像的 localStorage 键:index.html / input.html 的 <head> 内联脚本读它。
    真源仍是设置表的 THEME_KEY,镜像只是首帧优化(缺失/非法时退化为跟随系统)。 */
export const THEME_MIRROR_KEY = 'lifelog.theme';

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

/** 镜像值 + 系统偏好 -> 是否先落暗色(镜像缺失/非法时退化为跟随系统) */
export function mirrorDark(mirror: string | null | undefined, systemPrefersDark: boolean): boolean {
  if (mirror === 'dark') return true;
  if (mirror === 'light') return false;
  return systemPrefersDark;
}

/** 读回镜像值(键不存在或 storage 不可用一律 null;异常静默) */
export function readThemeMirror(): string | null {
  try {
    return localStorage.getItem(THEME_MIRROR_KEY);
  } catch {
    return null;
  }
}

/** 把三态写入镜像(供 use-theme-mode 在每次应用主题后调用;异常静默,不阻断主题落地) */
export function writeThemeMirror(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_MIRROR_KEY, mode);
  } catch {
    // 镜像写失败只是失去首帧优化,退化为修复前的行为
  }
}

/** 广播载荷 -> 三态:非字符串载荷返回 null(调用方忽略该事件);
    字符串载荷按 parseThemeMode 解析,非法字符串同样回退 system(与设置读取同一条规则)。 */
export function parseThemePayload(payload: unknown): ThemeMode | null {
  return typeof payload === 'string' ? parseThemeMode(payload) : null;
}
