import { useEffect, useRef, useState } from 'react';
import type { AppCommands } from './use-app-commands';

export interface AddConditionMenuState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * 把命令上抛的「添加条件」一次性信号转成条件栏菜单的受控开关(任务 2 交接项 ②)。
 *
 * 信号是**一次性**的:命令只把 `addConditionOpen` 置真,消费方(本 hook)打开菜单后立刻
 * `consumeAddCondition()` 复位。不复位的话,信号会一直为真,菜单在后续的重渲染/重挂载里反复弹出。
 *
 * `consumeAddCondition` 是 useAppCommands 里的内联箭头,每次渲染身份都变;所以走 ref,
 * 让 effect 只依赖信号本身(否则每渲染重跑一次 effect 的收敛依赖会退化)。`setOpen` 由调用方
 * 原样透传给 AddConditionMenu(受控关闭也走它)。
 */
export function useAddConditionMenu(commands: AppCommands): AddConditionMenuState {
  const [open, setOpen] = useState(false);
  const consume = useRef(commands.consumeAddCondition);
  consume.current = commands.consumeAddCondition;
  const signal = commands.addConditionOpen;

  useEffect(() => {
    if (!signal) return;
    setOpen(true);
    consume.current();
  }, [signal]);

  return { open, setOpen };
}
