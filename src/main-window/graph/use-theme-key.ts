/**
 * 当前生效主题的标识(亮/暗),供画布判断"要不要因为换主题而重绘"。
 * 主题三态(亮/暗/跟随系统)最终都落到 `documentElement` 的 `dark` class 上
 * (见 shared/theme-mode),所以这里盯 class 属性就够了:系统主题变化时那次切换
 * 也会改 class,不需要再监听 matchMedia。
 */
import { useEffect, useState } from 'react';

export function useThemeKey(): string {
  const read = (): string => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  const [key, setKey] = useState(read);
  useEffect(() => {
    const el = document.documentElement;
    const mo = new MutationObserver(() => setKey(read()));
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return key;
}
