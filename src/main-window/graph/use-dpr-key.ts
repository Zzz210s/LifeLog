/**
 * 当前 devicePixelRatio,供画布判断"要不要因为 DPR 变化重绘"。
 * 为什么需要它:容器尺寸按 DPR 量化(clientWidth 1000 在 1.25 与 1.5 下都量成 1000),
 * 纯 DPR 变化可能既不改尺寸、也不一定来 `resize` —— 两条路都拦不住就停在旧 DPR(画布略糊)。
 * 所以盯住"当前 dpr"的 resolution 媒体查询:它一变就重测并重新盯(旧查询已不再匹配)。
 * jsdom 没有 matchMedia(被 typeof 挡住),生产环境一定有。
 */
import { useEffect, useState } from 'react';

export function useDprKey(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const read = (): number => window.devicePixelRatio || 1;
    let mq: MediaQueryList | null = null;
    const arm = (): void => {
      if (mq !== null) mq.removeEventListener('change', onAny);
      mq = typeof window.matchMedia === 'function' ? window.matchMedia(`(resolution: ${read()}dppx)`) : null;
      mq?.addEventListener('change', onAny);
    };
    const onAny = (): void => {
      setDpr(read());
      arm();
    };
    arm();
    window.addEventListener('resize', onAny);
    return () => {
      window.removeEventListener('resize', onAny);
      mq?.removeEventListener('change', onAny);
    };
  }, []);
  return dpr;
}
