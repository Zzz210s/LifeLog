/**
 * 重命名 / 移动 / 删除 / 合并四个写动作(自 TagMenu.tsx 拆出,守 200 行上限):
 * 与 `useTagMenuAliases` 同构 —— 本工厂只管调命令与回报,中文错误就地显示由调用方给的
 * `fail` 负责(它同时解除 busy)。每次渲染重建一份即可:函数体读的是当次渲染的 props。
 */
import { api } from '../../shared/api';
import { isValidTagPath } from '../../shared/filter-conditions';
import type { TagCount } from '../../shared/types';
import type { ManagedNode } from './tag-tree';

export interface TagMenuOps {
  rename(): void;
  move(parentId: number | null, to: string): void;
  remove(): void;
  merge(target: TagCount, keepAlias: boolean): void;
  /** 登记/取消登记当前标签为类型(幂等;不动树结构与排序) */
  makeType(isType: boolean): void;
}

export interface TagMenuOpsOptions {
  node: ManagedNode;
  /** 重命名输入框的当前值 */
  newName: string;
  /** 失败兑现:就地显示后端中文错误并解除 busy(不动菜单状态) */
  fail: (e: unknown) => void;
  setBusy: (v: boolean) => void;
  onError: (message: string) => void;
  onClose: () => void;
  /** 操作成功:提示文案 + 改名/移动/合并时的路径变化 */
  onDone: (message: string, pathChange?: { from: string; to: string }) => void;
}

export function tagMenuOps(o: TagMenuOpsOptions): TagMenuOps {
  const parentPrefix = o.node.path.slice(0, o.node.path.length - o.node.name.length);
  const newPathOf = (name: string): string => parentPrefix + name;
  return {
    rename: (): void => {
      const t = o.newName.trim();
      if (t === '') return o.onError('标签名不能为空');
      if (t.includes('/') || !isValidTagPath(t)) {
        return o.onError('标签名不合法(可用行内 md 语法;不能含空白、# 或 /)');
      }
      if (t === o.node.name) return o.onClose();
      o.setBusy(true);
      void api
        .renameTag(o.node.id, t)
        .then(() => o.onDone('已重命名标签', { from: o.node.path, to: newPathOf(t) }))
        .catch(o.fail);
    },
    move: (parentId: number | null, to: string): void => {
      o.setBusy(true);
      void api
        .moveTag(o.node.id, parentId)
        .then(() => o.onDone('已移动标签', { from: o.node.path, to }))
        .catch(o.fail);
    },
    remove: (): void => {
      o.setBusy(true);
      void api
        .deleteTag(o.node.id)
        .then(() => o.onDone('已删除标签'))
        .catch(o.fail);
    },
    /** 合并:成功后回报 源路径 -> 目标路径,让上层级联改写筛选条件(源标签已被删除) */
    merge: (target: TagCount, keepAlias: boolean): void => {
      o.setBusy(true);
      void api
        .mergeTags(o.node.id, target.id, keepAlias)
        .then(() => o.onDone('已合并标签', { from: o.node.path, to: target.path }))
        .catch(o.fail);
    },
    /** 类型登记是即时的幂等写:不做二次确认,成功后回报成功文案(上层刷新类型表与标签事实) */
    makeType: (isType: boolean): void => {
      o.setBusy(true);
      const call = isType ? api.setTagTypeFlag(o.node.id, false) : api.setTagTypeFlag(o.node.id, true);
      void call
        .then(() => o.onDone(isType ? '已取消类型登记' : '已登记为类型'))
        .catch(o.fail);
    },
  };
}
