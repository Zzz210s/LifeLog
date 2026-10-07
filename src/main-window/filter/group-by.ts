/**
 * 分组条件的纯函数真源(设计 2026-10-06 §6):会话折叠键、方向文案、chip 文案。
 * 全在这里 = React 组件只渲染与接线,便于单测;方向文案与排序标签轴同口径。
 */
import type { GroupByCond, SortDir } from '../../shared/filter-conditions';
import { tagLabelPlain } from '../../shared/tag-label';

/** 哨兵组的会话键:后端用 `key = null` 表示「无该轴标签」组,折叠态需要一个稳定字符串键 */
export const NONE_GROUP_KEY = '\0none';

/** 组键 -> 会话内折叠态键(null 哨兵组用 NONE_GROUP_KEY) */
export const groupSessionKey = (key: string | null): string => key ?? NONE_GROUP_KEY;

/** 方向文案(与排序面板标签轴一致):asc = 选项顺序 / desc = 选项倒序 */
export const groupDirLabel = (dir: SortDir): string => (dir === 'asc' ? '选项顺序' : '选项倒序');

/** chip 文案:`分组: 地点 选项顺序`(显示口径走 tagLabelPlain,与排序 chip 一致) */
export const groupChipLabel = (g: GroupByCond): string =>
  `分组: ${tagLabelPlain(g.path)} ${groupDirLabel(g.dir)}`;
