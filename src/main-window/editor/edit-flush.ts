/**
 * 编辑态的「立即落库」通道(设计 §3.2 / §4.2 纪律 5:命令执行前先 flush 编辑态)。
 *
 * 复用的就是「点区块外即保存」那一条 flush(EditPanel 的 `flush`,读 DOM 真值、未变不写库);
 * EditPanel 挂载时登记、卸载时注销。命令面板在 run 之前调用 [`flushEditing`]:
 * - 没有编辑面板 -> 直接放行(不算失败);
 * - 失败(空内容 / 保存失败 / 上一次还在飞)-> 返回中文原因,由调用方显示错误条,**绝不静默**。
 */
export interface EditFlushResult {
  ok: boolean;
  /** ok 为假时的中文原因 */
  message?: string;
}

export type EditFlush = () => Promise<EditFlushResult>;

let current: EditFlush | null = null;

/** 登记/注销当前编辑面板的 flush(传 null 即注销) */
export function registerEditFlush(fn: EditFlush | null): void {
  current = fn;
}

/** 当前是否有编辑面板在场(供测试与调试;判定一律以实际调用结果为准) */
export function hasEditingPanel(): boolean {
  return current !== null;
}

/** 执行前 flush 编辑态:失败给中文原因,调用方必须把它显示出来 */
export async function flushEditing(): Promise<EditFlushResult> {
  if (current === null) return { ok: true };
  return current();
}
