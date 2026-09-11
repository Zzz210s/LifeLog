import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * 外链统一交系统默认浏览器打开。Tauri webview 无地址栏、无后退按钮,
 * 一旦同窗导航到外站就等于应用被锁死;故失败时绝不回退到默认导航,
 * 而是通过可选回调交给调用方(由调用方走既有错误机制,如 setError('action', ...))。
 */
export async function openExternal(
  href: string,
  onError?: (message: string) => void
): Promise<void> {
  try {
    await openUrl(href);
  } catch (e) {
    console.warn('打开外部链接失败:', href, e);
    onError?.(`无法打开链接: ${href}`);
  }
}

/**
 * 点击事件目标 -> 最近的可导航链接 href;非链接返回 null。
 * 供 MarkdownBody 判断是否拦截默认导航(preventDefault 由调用方执行)。
 */
export function linkHrefFrom(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest('a[href]');
  const href = anchor?.getAttribute('href');
  return href ? href : null;
}
