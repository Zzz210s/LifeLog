/**
 * 浮层 window 监听的「事件目标」判定(审查 N4)。
 * 键盘/鼠标监听到 window 后,主窗其它可编辑区域(Composer 文本域、编辑面板)的按键也会
 * 冒到 window —— 必须按目标过滤,否则方向键被浮层吞掉(光标不动)、Ctrl+Enter 保存会与
 * 浮层接受同帧双动作。判定拆成纯函数,便于单独钉住。
 */

/** 可编辑元素:input / textarea / contenteditable(含其后代;嵌套 contenteditable=false 视为不可编辑) */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return true;
  if (target.isContentEditable === true) return true; // 真实浏览器:组合状态的最快判定
  // jsdom 不实现 isContentEditable(且属性 setter 不落地),故以属性为准 —— React 的
  // `contentEditable` prop 也是渲染成属性,两者一致。
  const holder = target.closest('[contenteditable]');
  return holder !== null && holder.getAttribute('contenteditable') !== 'false';
}

/** 事件目标是否落在浮层内(浮层根节点标 data-floating="palette") */
export function isInsidePalette(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-floating="palette"]') !== null;
}

/**
 * 该按键是否不是给浮层的:目标在浮层之外且是可编辑元素时,除 Esc(用户按 Esc 就是要关
 * 浮层)外一律放行给原控件 —— 浮层不 preventDefault、也不产生动作(审查 N4)。
 */
export function shouldIgnoreKey(event: KeyboardEvent): boolean {
  if (event.key === 'Escape') return false;
  return !isInsidePalette(event.target) && isEditableTarget(event.target);
}
