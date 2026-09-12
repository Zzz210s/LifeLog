// 三档锁定(阻止移动 / 阻止关闭 / 锁定内容)的纯状态模型。
// 字段含义:true 表示该动作被锁定(禁止),canX 返回其取反。

export interface LockState {
  move: boolean;
  close: boolean;
  content: boolean;
}

export interface LockKeys {
  lockMove: boolean;
  lockClose: boolean;
  lockContent: boolean;
}

export function lockStateFrom(keys: LockKeys): LockState {
  return { move: keys.lockMove, close: keys.lockClose, content: keys.lockContent };
}

export function canDrag(lock: LockState): boolean {
  return !lock.move;
}

export function canClose(lock: LockState): boolean {
  return !lock.close;
}

export function canEdit(lock: LockState): boolean {
  return !lock.content;
}

export function emptyLock(): LockState {
  return { move: false, close: false, content: false };
}
