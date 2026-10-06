/**
 * 标签菜单的纯助手(G3 spec §5.1):别名输入校验、移动/关系候选。
 * 全部无副作用、不碰 IPC,便于单测;UI 侧只在 TagMenu / 两个新面板里消费。
 */
import { isValidTagPath } from '../../shared/filter-conditions';
import type { TagCount } from '../../shared/types';

/**
 * 别名输入校验:合法返回 null,非法给中文提示。
 * 口径与仓库层 check_alias 一致(非空、无任何空白、无 `#`),并额外要求路径形态合法
 * (别名可以是**完整路径**,故层级分隔 `/` 允许;T3 起段内行内 md 符号也允许);
 * 仓库层仍是唯一权威,这里只做就地提示。
 */
export function validateAliasInput(text: string): string | null {
  if (text === '') return '别名不能为空';
  if (/\s/.test(text)) return '别名不能包含空白字符';
  if (text.includes('#')) return '别名不能包含 #';
  if (!isValidTagPath(text)) return '别名不合法(可用行内 md 语法;层级用 /,不能含空白或 #)';
  return null;
}

/**
 * 移动候选目标:剔除自身与全部子孙(路径前缀判定),保持原路径序。
 * 旧「合并…」已由同父同名的自动合并取代,本函数现在只服务于移动面板。
 */
export function mergeCandidates(
  rows: readonly TagCount[],
  node: { path: string }
): TagCount[] {
  return rows.filter(
    (r) => r.path !== node.path && !r.path.startsWith(node.path + '/')
  );
}

/** 关系候选(与 `#` 补全共用同一打分/排序引擎前先剔除):排除自己与已建立关系的目标,
 *  保持原路径序。后端的自指向/成环校验仍是权威,这里只保证候选里不出现这两种必然被拒的项。
 *  022 起任何标签都能被指向,不再有「只列已登记类型」的过滤。 */
export function relationCandidates(
  rows: readonly TagCount[],
  selfPath: string,
  outgoing: readonly { path: string }[]
): TagCount[] {
  const skip = new Set<string>([selfPath, ...outgoing.map((c) => c.path)]);
  return rows.filter((r) => !skip.has(r.path));
}
