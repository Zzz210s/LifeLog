import type { ReactNode } from 'react';
import { shouldShowStamp } from '../shared/input-feedback';

export interface InputBarOverlaysProps {
  /** 锁定中:右上角显示解锁按钮 */
  anyLock: boolean;
  onUnlock: () => void;
  /** 错误优先于保存提示;有错误时显示错误文案 */
  error: string;
  /** 保存提示(已保存 HH:MM)与它出现的时刻 */
  stamp: string;
  savedAt: number;
  /** 内容锁定(只读)时给一行提示 */
  editing: boolean;
  /** 供 shouldShowStamp 判断是否还在 1.5 秒窗口内 */
  now: number;
}

/**
 * 输入栏的浮层:右上角解锁按钮 + 右下角状态文案(错误 / 已保存 / 内容已锁定)。
 * 从 InputBar 抽出来是为了守住 200 行上限,渲染结果与内联写法一致。
 * 右下角三条互斥且优先级固定:错误 > 保存提示 > 锁定提示。
 */
export function InputBarOverlays(p: InputBarOverlaysProps): ReactNode {
  const status = p.error
    ? // 长错误(如路径/原始异常)不再从左侧被裁掉前缀:限宽(max 窗口宽-两侧各 1rem)并省略尾部
      { text: p.error, danger: true }
    : shouldShowStamp(p.savedAt, p.now)
      ? { text: p.stamp, danger: false }
      : !p.editing
        ? { text: '内容已锁定', danger: false }
        : null;

  return (
    <>
      {p.anyLock ? (
        <button
          type="button"
          aria-label="解除锁定"
          title="解除锁定"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={p.onUnlock}
          className="absolute top-4 right-4 flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-hover hover:text-muted"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M5 7V5.5a3 3 0 0 1 6 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <rect x="3.5" y="7" width="9" height="6" rx="1.5" fill="currentColor" />
          </svg>
        </button>
      ) : null}
      {status && (
        <span
          className={
            'pointer-events-none absolute right-4 bottom-4 truncate text-xs ' +
            (status.danger ? 'max-w-[calc(100%-2rem)] text-danger' : 'text-faint')
          }
        >
          {status.text}
        </span>
      )}
    </>
  );
}
