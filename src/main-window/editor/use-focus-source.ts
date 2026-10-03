import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * 进编辑时的焦点与光标落点(自 `EditPanel` 抽出以守 200 行红线)。
 *
 * R4:进编辑**不改动笔记流的滚动位置**。原先用 autoFocus,浏览器聚焦时会做 scrollIntoView ——
 * 被视口裁掉的卡片一旦点进编辑,流 scrollTop 就被拉回去(实测 200 -> 0,跳 200px)。改成显式
 * focus + preventScroll:焦点照样落在源码框(键盘仍可直接打字),但不向任何滚动祖先请求滚进视野。
 *
 * 光标落点(用户 2026-10-03):**跟随点击位置** —— 调用方把点击处换算出的源码偏移传进来
 * (见 `click-caret.ts`);没传/换算不出来时退回原来的口径:正文末尾(末行 `#标签` 之前),
 * 否则直接打字会把字并进末行标签。
 * `onMounted` 在焦点落定后调用一次(父层用它还原流的滚动位置);用 ref 取最新值,挂载只跑一次。
 */
export function useFocusSource(
  boxRef: RefObject<HTMLTextAreaElement | null>,
  onMounted?: () => void,
  caretHint?: number | null,
): void {
  const mounted = useRef(onMounted);
  mounted.current = onMounted;
  useEffect(() => {
    const el = boxRef.current;
    el?.focus({ preventScroll: true });
    const cut = el?.value.lastIndexOf('\n') ?? -1;
    const end = el ? (cut > 0 ? cut : el.value.length) : 0;
    const caret = typeof caretHint === 'number' && caretHint >= 0 && caretHint <= end ? caretHint : end;
    el?.setSelectionRange(caret, caret);
    // 取证(2026-10-03):真实鼠标出问题时把这三个值报出来就能定位
    // (hint = 点击处换算值;end = 正文末尾;final = 实际落点)
    const w = window as unknown as { __editCaretLog?: unknown[] };
    w.__editCaretLog = w.__editCaretLog ?? [];
    if (w.__editCaretLog.length < 40) {
      w.__editCaretLog.push({ hint: caretHint ?? null, end, final: el?.selectionStart ?? null, at: Date.now() });
    }
    mounted.current?.();
  }, [boxRef]);
}
