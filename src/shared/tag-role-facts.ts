/**
 * 标签行「角色 / 携带」的纯格式化(标签角色 spec §5):树行徽章、悬浮卡片、携带小字共用一份口径。
 *
 * 角色徽章:一个标签可被多个角色认领(R2),行内最多显示 2 个,超出用 `+N` 概括。
 * 携带:携带的目标必须是已登记的角色标签(R3),所以「角色 -> 值」这样推:
 * - 目标路径**自身或最近的已登记角色祖先**给出角色名(R1:角色名 = 标签路径末段);
 * - 角色路径之下的剩余段是值(目标就是角色本身时值空,只显示角色名);
 * - 找不到已登记角色(历史行,设计 R8 豁免)时退回目标叶子名,值空。
 */
import { tagLabelPlain } from './tag-label';

/** 已登记角色的最小形状(tagId 不需要,这里只用路径与末段名) */
export interface RoleLike {
  path: string;
  name: string;
}

/** 携带一行:角色名 + 值(值空 = 目标就是角色本身,没有独立的值) */
export interface CarryFact {
  role: string;
  value: string;
}

/** 行内徽章的截断结果:显示的徽章 + 被省略的个数(`+N`;不够 2 个时为 0) */
export interface BadgePlan {
  badges: string[];
  extra: number;
}

/** 徽章用的角色最小形状:名字给显示,id 给列表 key(两个角色末段可能同名,不能只看名字) */
export interface RoleChip {
  tagId: number;
  name: string;
}

/** 行内最多显示几个角色徽章(超出显示 `+N`) */
export const MAX_ROLE_BADGES = 2;

/** 徽章计划(带 id):最多 MAX_ROLE_BADGES 个,超出把余数并成 `+N`(顺序按传入原序) */
export function roleBadgeRefs<T extends RoleChip>(
  chips: readonly T[],
  max = MAX_ROLE_BADGES
): { badges: T[]; extra: number } {
  return { badges: chips.slice(0, max), extra: Math.max(0, chips.length - max) };
}

/** 只要名字的徽章计划(列表 key 用不上 id 时的既有入口) */
export function roleBadges(names: readonly string[], max = MAX_ROLE_BADGES): BadgePlan {
  const plan = roleBadgeRefs(
    names.map((name) => ({ tagId: 0, name })),
    max
  );
  return { badges: plan.badges.map((b) => b.name), extra: plan.extra };
}

/** `国籍 → 日本`;值为空时只给角色名(如携带目标就是角色标签本身) */
export function carryLabel(fact: CarryFact): string {
  return fact.value === '' ? fact.role : `${fact.role} → ${fact.value}`;
}

/** 单条携带目标 -> 角色/值(见文件头口径)。路径比较用码元序,与仓内路径口径一致 */
export function carryFact(path: string, roles: readonly RoleLike[]): CarryFact {
  let best: RoleLike | null = null;
  for (const role of roles) {
    const prefix = role.path + '/';
    if (path !== role.path && !path.startsWith(prefix)) continue;
    if (best === null || role.path.length > best.path.length) best = role;
  }
  if (best === null) return { role: tagLabelPlain(leaf(path)), value: '' };
  const rest = path.slice(best.path.length + 1);
  return { role: tagLabelPlain(best.name), value: rest === '' ? '' : tagLabelPlain(rest) };
}

/** 多条携带目标 -> 标签列表(保持传入序,后端已按路径升序) */
export function carryFacts(paths: readonly string[], roles: readonly RoleLike[]): CarryFact[] {
  return paths.map((p) => carryFact(p, roles));
}

/**
 * 悬浮卡片文案(多行):第一行沿用既有「路径(本级 N / 含子级 M)」,
 * 之后按有值才出现——`角色：国籍、所在`、`携带：国籍 → 日本`(携带多项用 `、` 连)。
 */
export function tagFactsTitle(
  path: string,
  selfCount: number,
  subtreeCount: number,
  roleNames: readonly string[],
  carries: readonly CarryFact[]
): string {
  const lines = [`${tagLabelPlain(path)}(本级 ${selfCount} / 含子级 ${subtreeCount})`];
  if (roleNames.length > 0) lines.push(`角色：${roleNames.join('、')}`);
  if (carries.length > 0) lines.push(`携带：${carries.map(carryLabel).join('、')}`);
  return lines.join('\n');
}

/** 路径末段(`/` 是层级分隔符,单段路径即整串) */
function leaf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? path : path.slice(at + 1);
}
