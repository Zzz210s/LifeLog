/**
 * 标签分区的操作回执(自 TagsSection 拆出,守 200 行红线):
 * 成功后 1.5s 自动消失(绿),失败停 3s(红);连续操作时重置计时器,只显示最新一条。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TagFlash } from './TagsHeader';

export interface TagFlashApi {
  flash: TagFlash | null;
  /** 显示一条回执;`tone='error'` 时停留更久(失败需要看清原因) */
  showFlash: (text: string, tone?: 'ok' | 'error') => void;
}

export function useTagFlash(): TagFlashApi {
  const [flash, setFlash] = useState<TagFlash | null>(null);
  const timer = useRef<number | null>(null);

  const showFlash = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    setFlash({ text, tone });
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), tone === 'error' ? 3000 : 1500);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    []
  );

  return { flash, showFlash };
}
