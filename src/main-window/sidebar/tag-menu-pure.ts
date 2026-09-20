/**
 * 标签菜单的纯助手(G3 spec §5.1):别名输入校验、合并候选、影响面文案。
 * 全部无副作用、不碰 IPC,便于单测;UI 侧只在 TagMenu / 两个新面板里消费。
 */
import { isValidTagPath } from '../../shared/filter-conditions';
import type { TagCount } from '../../shared/types';

/**
 * 别名输入校验:合法返回 null,非法给中文提示。
 * 口径与仓库层 check_alias 一致(非空、无任何空白、无 `#`),并额外要求路径形态合法
 * (别名可以是**完整路径**,故层级分隔 `/` 允许);仓库层仍是唯一权威,这里只做就地提示。
 */
export function validateAliasInput(text: string): string | null {
  if (text === '') return '别名不能为空';
  if (/\s/.test(text)) return '别名不能包含空白字符';
  if (text.includes('#')) return '别名不能包含 #';
  if (!isValidTagPath(text)) return '别名不合法(仅限文字、数字、_ - . ·,层级用 /)';
  return null;
}

/**
 * 合并候选目标:剔除自身与全部子孙(路径前缀判定,与移动面板同一口径),保持原路径序。
 * 合并源必须**无子节点** —— 有子节点时由上层直接显示提示文案,不列候选,故这里不用再管。
 */
export function mergeCandidates(
  rows: readonly TagCount[],
  node: { path: string }
): TagCount[] {
  return rows.filter(
    (r) => r.path !== node.path && !r.path.startsWith(node.path + '/')
  );
}

/** 合并影响面文案:源标签上挂着的笔记数(0 条时明说,不显示「将影响 0 条」) */
export function mergeImpactText(notes: number): string {
  return notes === 0 ? '该标签暂无关联笔记' : `将影响 ${notes} 条笔记`;
}
