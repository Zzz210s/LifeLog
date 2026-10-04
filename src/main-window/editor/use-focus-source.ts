import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { caretScrollTop } from './caret-scroll';
import { caretScrollFromTop, measureCaretTop } from './caret-metrics';

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
  // useLayoutEffect:光标位置与框内滚动都在**首帧之前**定好,用户看不到中间过程
  useLayoutEffect(() => {
    const el = boxRef.current;
    el?.focus({ preventScroll: true });
    const cut = el?.value.lastIndexOf('\n') ?? -1;
    const end = el ? (cut > 0 ? cut : el.value.length) : 0;
    const caret = typeof caretHint === 'number' && caretHint >= 0 && caretHint <= end ? caretHint : end;
    el?.setSelectionRange(caret, caret);
    // 把**光标所在行**滚到框内约 1/3 高度处(用户 2026-10-03)。
    // 先用镜像量出光标真实纵向位置(长段落折行时行号估算会严重偏低,框会滚到底、光标反而看不见),
    // 量不到时退回按换行数估算。
    if (el) {
      const top = measureCaretTop(el, caret);
      if (top !== null) {
        el.scrollTop = caretScrollFromTop(top, el.clientHeight, el.scrollHeight);
      } else {
        const cs = window.getComputedStyle(el);
        const lineHeight = Number.parseFloat(cs.lineHeight);
        const before = el.value.slice(0, caret);
        let newlines = 0;
        for (let i = 0; i < before.length; i += 1) if (before.charCodeAt(i) === 10) newlines += 1;
        el.scrollTop = caretScrollTop({
          caret,
          newlinesBefore: newlines,
          lineHeight,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
        });
      }
    }
    // 取证(2026-10-03):真实鼠标出问题时把这三个值报出来就能定位
    // (hint = 点击处换算值;end = 正文末尾;final = 实际落点)
    const w = window as unknown as { __editCaretLog?: unknown[] };
    w.__editCaretLog = w.__editCaretLog ?? [];
    if (w.__editCaretLog.length < 40) {
      w.__editCaretLog.push({ hint: caretHint ?? null, end, final: el?.selectionStart ?? null, at: Date.now() });
    }
    mounted.current?.();
    /**
     * 把焦点抢回来(用户 2026-10-03 报"光标又没了"):
     * 点击的**默认行为**是在事件派发之后把焦点移到 body,而编辑面板是在这次派发中挂载的 ——
     * 于是刚拿到的焦点被那次默认行为抽走,框没焦点就不画光标(选区还在,只是看不见)。
     * 做法:挂载后短时间内反复确认一次焦点(只在框没焦点且用户没点到别处时抢回来);
     * 有选区时不动,免得把用户正在选中复制的内容清掉。
     */
    const refocus = (): void => {
      const box = boxRef.current;
      if (!box) return;
      if (box.ownerDocument.activeElement === box) return;
      box.focus({ preventScroll: true });
      box.setSelectionRange(caret, caret);
    };
    const timers = [0, 60, 140, 260, 340, 500, 700].map((ms) =>
      ms === 0 ? requestAnimationFrame(refocus) : window.setTimeout(refocus, ms),
    );
    return () => {
      cancelAnimationFrame(timers[0] as number);
      timers.slice(1).forEach((t) => window.clearTimeout(t as number));
    };
  }, [boxRef]);
}
