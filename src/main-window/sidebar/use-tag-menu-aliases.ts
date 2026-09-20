/**
 * 别名面板的状态与动作(自 TagMenu.tsx 拆出,守 200 行上限):
 * 进入面板时按 tagId 载入别名;添加先做本地校验(与仓库层 check_alias 同口径)再写库;
 * 列表在本地增量维护 —— 仓库层按 alias 升序返回,新增项插入后同样排序。
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { validateAliasInput } from './tag-menu-pure';

export interface TagMenuAliases {
  /** 该标签的别名(null = 还没载入) */
  aliases: string[] | null;
  /** 新别名输入框的值(受控) */
  input: string;
  setInput: (v: string) => void;
  add: () => void;
  remove: (alias: string) => void;
  /** 从主面板再次进入别名面板时重置(重新拉取别名列表) */
  reset: () => void;
}

export function useTagMenuAliases(
  tagId: number,
  active: boolean,
  fail: (e: unknown) => void,
  setBusy: (v: boolean) => void
): TagMenuAliases {
  const [aliases, setAliases] = useState<string[] | null>(null);
  const [input, setInput] = useState('');
  // 回调放 ref:失败时就地显示错误会触发父组件重渲染,若把 fail 放进依赖会造成
  // 「请求失败 -> 重渲染 -> 依赖变化 -> 再请求」的死循环(与删除面板的影响面效应同处理)
  const failRef = useRef(fail);
  failRef.current = fail;

  useEffect(() => {
    if (!active || aliases !== null) return;
    void api
      .listTagAliases(tagId)
      .then(setAliases)
      .catch((e) => failRef.current(e));
  }, [active, tagId, aliases]);

  const add = (): void => {
    const invalid = validateAliasInput(input);
    if (invalid !== null) return fail(invalid);
    setBusy(true);
    void api
      .addTagAlias(input, tagId)
      .then(() => {
        setAliases((prev) => [...(prev ?? []), input].sort());
        setInput('');
        setBusy(false);
      })
      .catch(fail);
  };

  const remove = (alias: string): void => {
    setBusy(true);
    void api
      .removeTagAlias(alias)
      .then(() => {
        setAliases((prev) => (prev ?? []).filter((a) => a !== alias));
        setBusy(false);
      })
      .catch(fail);
  };

  const reset = (): void => {
    setAliases(null);
    setInput('');
  };

  return { aliases, input, setInput, add, remove, reset };
}
