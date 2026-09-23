/**
 * 标签路径补全的纯匹配层(spec 6.3 / T8):取数据由 UI 调 completeTags 命令,
 * 这里只做「候选 -> 列表行」的投影 —— 排序 / 截断 / 高亮段全部交给共享列表模型
 * (`shared/quickpick/model` 的 buildList)与共享打分器(`shared/fuzzy-score`),
 * 本模块**不另写 matcher**(设计 §4.2 纪律 1:高亮位置必须来自打分器)。
 *
 * 空词元三档(设计 §3.5):固定项(`ui.pinned.tags`)→ 最近用过(`ui.mru.tags`)→ 全量(按路径序,上限 8)。
 * 有词元时纯按分排,固定项不插队。两条都由 buildList 保证,这里只负责喂候选与档位分。
 */
import { buildList, COMPLETE_LIMIT } from '../shared/quickpick/model';
import type { ListRow, MruEntry, QuickPickItem } from '../shared/quickpick/model';
import type { MatchRange } from '../shared/fuzzy-score';
import type { CompleteItem } from '../shared/types';

/**
 * 下拉最多展示的候选条数:与列表模型共用同一个常量(唯一定义在 `shared/quickpick/model.ts`)。
 * 后端 `complete_tags` 内部上限为 50(SQL LIMIT 兜底);近义项触发阈值 `tags/similar.rs` 的
 * SIMILAR_TRIGGER 与这里同值(8),改动须同步。列表最大行数 SUGGEST_MAX_ROWS 也必须同值
 * (见 tag-complete.test.ts 的 R5-1 不变量)。
 */
export { COMPLETE_LIMIT };

/** 候选档位:标签命中 -> 别名命中 -> 近义提示(G3/G4),与后端追加顺序一致 */
const KIND_RANK: Record<CompleteItem['kind'], number> = { tag: 0, alias: 1, similar: 2 };

/**
 * 别名 / 近义项的档位分:这两类候选项后端已按**别名串 / 近义规则**筛过,其 path 与词元未必同形
 * (别名 `日漫` -> 路径 `追番/日漫`;近义档 ③ 只要求编辑距离 <=1),拿 path 打分会把它们误判成
 * 「未命中」而丢掉 G3/G4 的既有语义。给一个远低于任何真实命中分(LABEL_MATCH_BOOST = 1<<16)
 * 的档位分:恒排在标签命中之后,内部保持路径序,且不给命中位置 —— 匹配的是别名串而非展示的路径,
 * 给了 `<mark>` 会标错地方。
 */
const ALIAS_TIER_SCORE = 2;
const SIMILAR_TIER_SCORE = 1;

/**
 * 光标前紧邻的 # 词元:捕获组为词元本体(可空,即刚敲下的 #)。
 * 前导字符规则与 Rust tags.rs 逐字对齐:'#' 前若是 ASCII 字母数字、'#' 或 '&',
 * 则不是标签(C#、URL 片段、HTML 实体);行首、CJK、其余标点后均放行。
 */
const TOKEN_RE = /(?<![A-Za-z0-9#&])#([^\s#]*)$/;

/**
 * 取 text 末尾的 # 词元(调用方传“光标前文本”):
 * 在词元内时返回词元本体(可为空串);不在词元内返回 null。
 */
export function tokenAt(text: string): string | null {
  const m = TOKEN_RE.exec(text);
  return m === null ? null : m[1];
}

/** 列表行:TagCompleteList 渲染所需的最小信息(高亮段来自打分器) */
export interface CompleteRow {
  path: string;
  kind: CompleteItem['kind'];
  /** `<mark>` 高亮段(相对 path 的绝对下标;别名/近义项恒为空) */
  ranges: readonly MatchRange[];
  /** 是否命中「固定项」档(空词元时排最前;有词元时不插队,只作标记) */
  pinned: boolean;
}

export interface CompleteMatchOptions {
  /** 固定项(`ui.pinned.tags`),数组顺序即固定档顺序 */
  pinned?: readonly string[];
  /** 最近用过(`ui.mru.tags`),模型自己按次数排序,调用方不必预排 */
  mru?: readonly MruEntry[];
  /** 缺省 COMPLETE_LIMIT */
  limit?: number;
}

function byPathThenKind(a: CompleteItem, b: CompleteItem): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return KIND_RANK[a.kind] - KIND_RANK[b.kind];
}

/** 后端已按 path 去重且标签优先,这里只是防御:同 path 只留第一项(排序已保证标签在前) */
function dedupe(sorted: readonly CompleteItem[]): CompleteItem[] {
  const seen = new Set<string>();
  const out: CompleteItem[] = [];
  for (const c of sorted) {
    if (seen.has(c.path)) continue;
    seen.add(c.path);
    out.push(c);
  }
  return out;
}

/** 候选 -> 列表项:标签项交给打分器打分(label = 路径);别名/近义项只带档位分 */
function toItem(c: CompleteItem): QuickPickItem {
  if (c.kind === 'tag') return { id: c.path, label: c.path };
  return {
    id: c.path,
    label: c.path,
    score: c.kind === 'alias' ? ALIAS_TIER_SCORE : SIMILAR_TIER_SCORE,
    positions: [],
  };
}

function rowToComplete(row: ListRow, kinds: ReadonlyMap<string, CompleteItem['kind']>): CompleteRow {
  return {
    path: row.item.id,
    kind: kinds.get(row.item.id) ?? 'tag',
    ranges: row.ranges,
    pinned: row.pinned,
  };
}

/**
 * 候选 -> 展示行:先按「路径 + 档位」定序(全量档即按路径序;同分时定序也是确定的),
 * 再去重,最后交给 buildList 排序/截断。有词元时未命中的标签项不出现。
 */
export function completeMatch(
  candidates: readonly CompleteItem[],
  token: string,
  options: CompleteMatchOptions = {}
): CompleteRow[] {
  const ordered = dedupe([...candidates].sort(byPathThenKind));
  const kinds = new Map(ordered.map((c) => [c.path, c.kind] as const));
  const { rows } = buildList({
    items: ordered.map(toItem),
    query: token,
    pinned: options.pinned ?? [],
    mru: options.mru ?? [],
    limit: options.limit ?? COMPLETE_LIMIT,
  });
  return rows.map((row) => rowToComplete(row, kinds));
}

function sameRanges(a: readonly MatchRange[], b: readonly MatchRange[]): boolean {
  return a.length === b.length && a.every((r, i) => r.start === b[i].start && r.end === b[i].end);
}

/**
 * 两份展示行是否等价(路径、来源、固定标记与高亮段逐项都相同)。
 * 用途:输入事件里的重算必须**在结果未变时 bail out** —— 元素级 input 监听里的 setState
 * 会同步触发重渲染,而重渲染会把受控表单件的 value 写回陈旧状态(实测会把刚敲进去的字抹掉,
 * 并让 React 的变化检测误判“值未变”而不派发 onChange),详见 InputBar 的文件头注释。
 */
export function sameList(a: readonly CompleteRow[], b: readonly CompleteRow[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return (
        x.path === y.path &&
        x.kind === y.kind &&
        x.pinned === y.pinned &&
        sameRanges(x.ranges, y.ranges)
      );
    })
  );
}
