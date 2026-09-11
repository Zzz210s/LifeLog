import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * 外链统一交系统默认浏览器打开。Tauri webview 无地址栏、无后退按钮,
 * 一旦同窗导航到外站就等于应用被锁死;故失败时仅告警,绝不回退到默认导航。
 */
export async function openExternal(href: string): Promise<void> {
  try {
    await openUrl(href);
  } catch (e) {
    console.warn('打开外部链接失败:', href, e);
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
