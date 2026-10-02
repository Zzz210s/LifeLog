// 亮暗判定真源是 <html> 的 class(见 shared/theme-mode:applyThemeMode 落 .dark)。
// 不用 matchMedia:显式亮/暗与 system 态最终都已由 useThemeMode 落成 class,读 class 一处即全。
import { useSyncExternalStore } from 'react';

export function isDarkClass(className: string): boolean {
  return className.split(/\s+/).includes('dark');
}

function getSnapshot(): boolean {
  return typeof document === 'undefined' ? false : isDarkClass(document.documentElement.className);
}

function subscribe(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
