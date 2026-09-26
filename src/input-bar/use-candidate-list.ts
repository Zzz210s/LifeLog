/**
 * 候选列表 + 高亮下标的**唯一归属地**(输入栏 # 补全用)。
 *
 * 存在的理由是一条实测 bug(2026-09-26):"上下箭头选不动" —— ↓ 的 keyup 会触发重算,
 * 回包里的"新候选归零高亮"把刚移动的高亮打回第一行。修法是把"列表是否真变了"变成
 * 写入口的判断:**没变就什么都不做**(不重渲染、不归零高亮),变了才换列表并把高亮归零。
 *
 * 单独成文件也是为了守住 200 行红线(use-tag-complete.ts 已经顶格)。
 */
import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { sameList } from './tag-complete';
import type { CompleteRow } from './tag-complete';

export interface CandidateList {
  items: CompleteRow[];
  activeIndex: number;
  /** 高亮下标(支持函数式更新:↑↓ 环绕要用到当前值) */
  setActiveIndex: Dispatch<SetStateAction<number>>;
  /** 写入候选:列表没变则原地不动(高亮保留),变了才归零高亮 */
  setList: (next: CompleteRow[]) => void;
  /** 收起下拉(幂等:已经是空就不产生新引用) */
  clear: () => void;
  /** 列表镜像:事件回调里要现读"当前有没有候选",不靠渲染期闭包 */
  itemsRef: { current: CompleteRow[] };
}

export function useCandidateList(): CandidateList {
  const [items, setItems] = useState<CompleteRow[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const itemsRef = useRef<CompleteRow[]>([]);

  const setList = useCallback((next: CompleteRow[]) => {
    if (sameList(itemsRef.current, next)) return;
    itemsRef.current = next;
    setItems(next);
    setActiveIndex(0);
  }, []);

  const clear = useCallback(() => {
    if (itemsRef.current.length === 0) return; // 未变不产生新引用:避免无谓重渲染
    itemsRef.current = [];
    setItems([]);
  }, []);

  return { items, activeIndex, setActiveIndex, setList, clear, itemsRef };
}
