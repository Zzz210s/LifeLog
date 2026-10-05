/**
 * 标签行「类型 / 携带」的纯格式化(标签类型 spec §5):树行徽章、悬浮卡片、携带小字共用一份口径。
 *
 * 类型徽章:一个标签可被多个类型认领(R2),行内最多显示 2 个,超出用 `+N` 概括。
 * 携带:携带的目标必须是已登记的类型标签(R3),所以「类型 -> 值」这样推:
 * - 目标路径**自身或最近的已登记类型祖先**给出类型名(R1:类型名 = 标签路径末段);
 * - 类型路径之下的剩余段是值(目标就是类型本身时值空,只显示类型名);
 * - 找不到已登记类型(历史行,设计 R8 豁免)时退回目标叶子名,值空。
 */
import { tagLabelPlain } from './tag-label';

/** 已登记类型的最小形状(tagId 不需要,这里只用路径与末段名) */
export interface TypeLike {
  path: string;
  name: string;
}

/** 携带一行:类型名 + 值(值空 = 目标就是类型本身,没有独立的值) */
export interface CarryFact {
  type: string;
  value: string;
}

/** 行内徽章的截断结果:显示的徽章 + 被省略的个数(`+N`;不够 2 个时为 0) */
export interface BadgePlan {
  badges: string[];
  extra: number;
}

/** 徽章用的类型最小形状:名字给显示,id 给列表 key(两个类型末段可能同名,不能只看名字) */
export interface TypeChip {
  tagId: number;
  name: string;
}

/** 行内最多显示几个类型徽章(超出显示 `+N`) */
export const MAX_TYPE_BADGES = 2;

/** 徽章计划(带 id):最多 MAX_TYPE_BADGES 个,超出把余数并成 `+N`(顺序按传入原序) */
export function typeBadgeRefs<T extends TypeChip>(
  chips: readonly T[],
  max = MAX_TYPE_BADGES
): { badges: T[]; extra: number } {
  return { badges: chips.slice(0, max), extra: Math.max(0, chips.length - max) };
}

/** 只要名字的徽章计划(列表 key 用不上 id 时的既有入口) */
export function typeBadges(names: readonly string[], max = MAX_TYPE_BADGES): BadgePlan {
  const plan = typeBadgeRefs(
    names.map((name) => ({ tagId: 0, name })),
    max
  );
  return { badges: plan.badges.map((b) => b.name), extra: plan.extra };
}

/** `国籍 → 日本`;值为空时只给类型名(如携带目标就是类型标签本身) */
export function carryLabel(fact: CarryFact): string {
  return fact.value === '' ? fact.type : `${fact.type} → ${fact.value}`;
}

/** 单条携带目标 -> 类型/值(见文件头口径)。路径比较用码元序,与仓内路径口径一致 */
export function carryFact(path: string, types: readonly TypeLike[]): CarryFact {
  let best: TypeLike | null = null;
  for (const t of types) {
    const prefix = t.path + '/';
    if (path !== t.path && !path.startsWith(prefix)) continue;
    if (best === null || t.path.length > best.path.length) best = t;
  }
  if (best === null) return { type: tagLabelPlain(leaf(path)), value: '' };
  const rest = path.slice(best.path.length + 1);
  return { type: tagLabelPlain(best.name), value: rest === '' ? '' : tagLabelPlain(rest) };
}

/** 多条携带目标 -> 标签列表(保持传入序,后端已按路径升序) */
export function carryFacts(paths: readonly string[], types: readonly TypeLike[]): CarryFact[] {
  return paths.map((p) => carryFact(p, types));
}

/**
 * 悬浮卡片文案(多行):第一行沿用既有「路径(本级 N / 含子级 M)」,
 * 之后按有值才出现——`类型：国籍、所在`、`携带：国籍 → 日本`(携带多项用 `、` 连)。
 */
export function tagFactsTitle(
  path: string,
  selfCount: number,
  subtreeCount: number,
  typeNames: readonly string[],
  carries: readonly CarryFact[]
): string {
  const lines = [`${tagLabelPlain(path)}(本级 ${selfCount} / 含子级 ${subtreeCount})`];
  if (typeNames.length > 0) lines.push(`类型：${typeNames.join('、')}`);
  if (carries.length > 0) lines.push(`携带：${carries.map(carryLabel).join('、')}`);
  return lines.join('\n');
}

/** 路径末段(`/` 是层级分隔符,单段路径即整串) */
function leaf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? path : path.slice(at + 1);
}
