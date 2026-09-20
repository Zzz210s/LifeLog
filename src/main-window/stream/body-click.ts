/**
 * 「点正文进入编辑」的纯判定(四条不误触发守卫里的两条可测部分):
 * - 点击落点在某交互元素内(链接 / 任务复选框 / 按钮 / 标签 label)= 不进编辑,
 *   让原有行为(开外链、勾任务、点按钮)独占这次点击;
 * - 松开时存在非空选区 = 用户在复制正文,不进编辑。
 * chips 点击不进编辑由结构保证:chip 行在正文容器之外,事件根本不上浮到这里。
 */
const INTERACTIVE_SELECTOR = 'a,input,button,label';

export function shouldEnterEdit(target: EventTarget | null, selectedText: string): boolean {
  if (selectedText !== '') return false;
  if (!(target instanceof Element)) return false;
  return target.closest(INTERACTIVE_SELECTOR) === null;
}
