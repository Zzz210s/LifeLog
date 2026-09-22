/**
 * 命令 provider(设计 §3.2):列表 = 注册表里 when 为真的命令;匹配用共享 `fuzzy-score`。
 *
 * 打分两档(T6 brief):标题命中 `PATH_BOOST`、别名命中 `LABEL_PREFIX_BOOST` / `LABEL_MATCH_BOOST`
 * (别名前缀命中更高),因此标题命中永远排在别名命中之前。命中位置只在标题档给出 ——
 * 别名的位置下标对标题串无意义,给出去会让 `<mark>` 标错地方。
 * 勾选态命令的标题两半由 `toggled` 求值决定(T3 审查 Minor 4):勾选 = 当前可见 → 动作「隐藏侧栏」。
 */
import type { Command, CommandRegistry } from '../../../shared/commands';
import { LABEL_MATCH_BOOST, LABEL_PREFIX_BOOST, PATH_BOOST, scoreFuzzy } from '../../../shared/fuzzy-score';
import type { QuickPickItem } from '../../../shared/quickpick/model';
import { evaluate } from '../../../shared/when';
import type { Context } from '../../../shared/when';
import type { RowDecoration } from '../PaletteRow';

export const COMMANDS_PREFIX = '>';
export const COMMANDS_PROVIDER_ID = 'commands';

export interface CommandHit {
  score: number;
  positions: number[];
}

/** 勾选型命令的标题两半:勾选(当前可见)= 前半句动作;未勾选 = 后半句 */
export function resolveCommandTitle(cmd: Command, ctx: Context): string {
  if (cmd.toggled === undefined) return cmd.title;
  const parts = cmd.title.split(' / ');
  if (parts.length !== 2) return cmd.title;
  return evaluate(cmd.toggled, ctx) ? parts[0] : parts[1];
}

/** 单条命令的打分:标题档优先;未命中标题再看别名(前缀命中高于包含命中) */
export function scoreCommand(cmd: Command, ctx: Context, query: string): CommandHit | null {
  const title = resolveCommandTitle(cmd, ctx);
  // boostTiers:false —— 档位由本 provider 叠加(标题 PATH_BOOST / 别名 LABEL_*_BOOST);
  // 用默认值会让 scorer 先叠一层 LABEL_*_BOOST,再把别名抬到标题档以上。
  const t = scoreFuzzy(query, title, { boostTiers: false });
  let best: CommandHit | null = t.score > 0 ? { score: PATH_BOOST + t.score, positions: t.positions } : null;
  for (const alias of cmd.aliases) {
    const a = scoreFuzzy(query, alias, { boostTiers: false });
    if (a.score <= 0) continue;
    const boost = alias.toLowerCase().startsWith(query.trim().toLowerCase())
      ? LABEL_PREFIX_BOOST
      : LABEL_MATCH_BOOST;
    const score = boost + a.score;
    if (best === null || score > best.score) best = { score, positions: [] };
  }
  return best;
}

/** 候选列表:空查询不带分数(交给列表模型走「固定 -> 最近 -> 全量」) */
export function commandItems(registry: CommandRegistry, ctx: Context, query: string): QuickPickItem[] {
  const q = query.trim();
  const out: QuickPickItem[] = [];
  for (const cmd of registry.list(ctx)) {
    const label = resolveCommandTitle(cmd, ctx);
    if (q === '') {
      out.push({ id: cmd.id, label });
      continue;
    }
    const hit = scoreCommand(cmd, ctx, q);
    if (hit === null) continue;
    out.push({ id: cmd.id, label, score: hit.score, positions: hit.positions });
  }
  return out;
}

/** 行装饰:危险命令标危险色,勾选态命令按上下文标已勾选(UI 不二次查询) */
export function commandDecorations(
  registry: CommandRegistry,
  ctx: Context,
): Record<string, RowDecoration> {
  const out: Record<string, RowDecoration> = {};
  for (const cmd of registry.all) {
    out[cmd.id] = {
      danger: cmd.danger ? true : undefined,
      checked: cmd.toggled !== undefined ? evaluate(cmd.toggled, ctx) : undefined,
    };
  }
  return out;
}

export interface CommandProviderOptions {
  registry: CommandRegistry;
  /** 每次取候选时现读上下文:when 与勾选态都必须是最新的(不缓存,避免「已勾选」过期) */
  getContext: () => Context;
}

/** 注册表条目(前缀 `>`);host 注册一次,getItems 同步产出 */
export function createCommandProvider(options: CommandProviderOptions) {
  return {
    prefix: COMMANDS_PREFIX,
    id: COMMANDS_PROVIDER_ID,
    getItems: (query: string): QuickPickItem[] =>
      commandItems(options.registry, options.getContext(), query),
  };
}
