/**
 * 关闭浮层时的焦点归位(T5 复审 N2/N3 的订正口径;自 `use-palette.ts` 抽出以守行数红线):
 *
 * 顺序 = **打开前元素 -> 主区锚点 -> 不抢焦点**。只有「没有接管者」时才归位 ——
 * 焦点仍在浮层输入框、掉到 `body`、或没有 `activeElement` 都算无接管者;
 * 命令把焦点交给**另一个元素**(如 Composer)时不抢回(复审 N2/N3)。
 * 目标已卸载又没有锚点时保持不动(不静默乱移焦点)。
 *
 * 指针关闭路径不要指望这里归位:`mousedown` 的默认动作在事件派发**之后**执行,
 * 会覆盖归位结果(复审 §2.2),只有键盘关闭(Esc/Tab/Enter)才走本函数。
 */
export interface RestoreFocusArgs {
  /** 打开浮层前的 activeElement(可能已被卸载) */
  restore: HTMLElement | null;
  /** 浮层输入框(用来判"焦点是否还在浮层里") */
  input: HTMLElement | null;
  /** 主区锚点(主区容器,须 tabIndex=-1 才可聚焦) */
  anchor: HTMLElement | null;
}

/** 归位并返回实际聚焦的元素;没有归位时返回 null */
export function restoreFocus(args: RestoreFocusArgs): HTMLElement | null {
  const active = document.activeElement;
  const unclaimed = active === null || active === args.input || active === document.body;
  if (!unclaimed) return null;
  if (args.restore !== null && args.restore.isConnected) {
    args.restore.focus();
    return args.restore;
  }
  if (args.anchor !== null && args.anchor.isConnected) {
    args.anchor.focus();
    return args.anchor;
  }
  return null;
}
