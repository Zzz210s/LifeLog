/**
 * 标签分区的收窄搜索状态(自 TagsSection 拆出,守 200 行红线):
 * 只看不筛 —— 空查询时 filterTree 原样返回,filtering 只用于「恒展开」与「无匹配」提示。
 * 放大镜收起时一并清空关键词,否则树被隐式收窄、界面上却没有可见入口。
 *
 * 组合守卫(2026-10-15):`query` 是输入框显示值,`committed` 才喂 filterTree —— 拼音未上屏时
 * 树不该按原始拼音收窄成空树(与统一输入栏的 `/` 筛选同一个口径)。
 */
import { useState } from 'react';
import { useImeInput, type ImeInputHandlers } from '../../shared/use-ime-composition';

export interface TagSearchApi {
  searchOpen: boolean;
  /** 输入框显示值 */
  query: string;
  /** 收窄树用的值(组合中冻结在组合前那一版) */
  committed: string;
  /** 接给输入框的事件处理器(值走 query,组合标志自动维护) */
  ime: ImeInputHandlers;
  /** 有非空关键词(收窄态:树恒展开、可给「无匹配」提示) */
  filtering: boolean;
  toggleSearch: () => void;
  closeSearch: () => void;
}

export function useTagSearch(): TagSearchApi {
  const [searchOpen, setSearchOpen] = useState(false);
  const ime = useImeInput();

  const toggleSearch = (): void => {
    if (searchOpen) ime.setValue('');
    setSearchOpen((v) => !v);
  };
  const closeSearch = (): void => {
    setSearchOpen(false);
    ime.setValue('');
  };

  return {
    searchOpen,
    query: ime.value,
    committed: ime.committed,
    ime: ime.handlers,
    filtering: ime.committed.trim() !== '',
    toggleSearch,
    closeSearch,
  };
}
