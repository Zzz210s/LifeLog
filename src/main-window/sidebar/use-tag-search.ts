/**
 * 标签分区的收窄搜索状态(自 TagsSection 拆出,守 200 行红线):
 * 只看不筛 —— 空查询时 filterTree 原样返回,filtering 只用于「恒展开」与「无匹配」提示。
 * 放大镜收起时一并清空关键词,否则树被隐式收窄、界面上却没有可见入口。
 */
import { useState } from 'react';

export interface TagSearchApi {
  searchOpen: boolean;
  query: string;
  setQuery: (v: string) => void;
  /** 有非空关键词(收窄态:树恒展开、可给「无匹配」提示) */
  filtering: boolean;
  toggleSearch: () => void;
  closeSearch: () => void;
}

export function useTagSearch(): TagSearchApi {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const toggleSearch = (): void => {
    if (searchOpen) setQuery('');
    setSearchOpen((v) => !v);
  };
  const closeSearch = (): void => {
    setSearchOpen(false);
    setQuery('');
  };

  return {
    searchOpen,
    query,
    setQuery,
    filtering: query.trim() !== '',
    toggleSearch,
    closeSearch,
  };
}
