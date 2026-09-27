/**
 * 标签 provider(设计 §3.4):`#` = 跳标签。列表 = list_tags 全量,**行文案是 tagLabelPlain**
 * (标签名里的行内 md 语法是备注,不摆在候选里,见 shared/tag-label.ts),
 * 命中位置来自共享 `fuzzy-score`(与命令/笔记同引擎)并按同一重定位映射到纯文本,
 * 右侧副文本是**含子级**计数。
 * 行 id = **原始路径**:Enter 走 `unified/unified-accept.ts` 的 `effectFor` -> `applyTagPick`
 * (默认含子级);已在排除侧时会被移到包含侧,与侧栏点标签同一口径。
 */
import { PATH_BOOST, scoreFuzzy } from '../../../shared/fuzzy-score';
import type { QuickPickItem } from '../../../shared/quickpick/model';
import { tagLabelPlain } from '../../../shared/tag-label';
import { remapPositions } from '../../../shared/tag-label-highlight';
import type { TagCount } from '../../../shared/types';
import type { RowDecoration } from '../PaletteRow';

export const TAGS_PREFIX = '#';
export const TAGS_PROVIDER_ID = 'tags';

/** 空查询按路径序(全量档的顺序由 provider 保证,不指望后端排序) */
function byPath(a: TagCount, b: TagCount): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** 候选 -> 列表项:空查询不带分数;有查询按分降序,未命中不出现。
 * label 一律是**纯文本**(tagLabelPlain),positions 是按原始路径打分后**重定位**到纯文本的下标
 * (共享 remapRanges,定位不到即空 = 该行不高亮);id 仍是原始路径,采纳不受影响。 */
export function tagItems(tags: readonly TagCount[], query: string): QuickPickItem[] {
  const q = query.trim();
  if (q === '') {
    return [...tags]
      .sort(byPath)
      .map((tag) => ({ id: tag.path, label: tagLabelPlain(tag.path) }));
  }
  const out: QuickPickItem[] = [];
  for (const tag of tags) {
    // boostTiers:false —— 档位由 provider 叠加;默认值会多叠一层 LABEL_*_BOOST
    const hit = scoreFuzzy(q, tag.path, { boostTiers: false });
    if (hit.score > 0) {
      const plain = tagLabelPlain(tag.path);
      out.push({
        id: tag.path,
        label: plain,
        score: PATH_BOOST + hit.score,
        positions: remapPositions(tag.path, plain, hit.positions),
      });
    }
  }
  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/** 行右侧副文本:含子级计数 */
export function tagDecorations(tags: readonly TagCount[]): Record<string, RowDecoration> {
  const out: Record<string, RowDecoration> = {};
  for (const tag of tags) out[tag.path] = { detail: `${tag.subtree_count} 条` };
  return out;
}

export interface TagProviderOptions {
  /** 数据层入口(host 注入 `api.listTags`);失败原样抛 */
  listTags: () => Promise<readonly TagCount[]>;
}

/** 注册表条目(前缀 `#`) */
export function createTagProvider(options: TagProviderOptions) {
  const getItems = async (query: string): Promise<QuickPickItem[]> =>
    tagItems(await options.listTags(), query);
  return { prefix: TAGS_PREFIX, id: TAGS_PROVIDER_ID, getItems };
}
