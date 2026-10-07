/**
 * 笔记间显式链接 `[[标题]]` 的**渲染口径**(设计 D10 / §4):正文里渲成可点 chip。
 *
 * 收敛到一处:markdown-it 的**行内规则**(围栏代码块/行内代码/`\[[x]]` 里不渲染成 chip ——
 * 这是 markdown-it 块级与行内解析顺序天然给的,与 L1 的跳过口径一致)+ 渲染函数
 * renderNoteLink + 点击命中 noteLinkFrom。调用方(markdown.ts / MarkdownBody)只从这里取。
 *
 * 已解析 -> `text-accent` 实线 + `data-note-link="<id>"`,chip 文字用显示文本(有则用)、
 * 悬停 `title` 提示目标当前首行;
 * 未解析 -> `text-muted` 虚线 + `data-note-link=""`,chip 文字同样优先显示文本,`title` 与
 * `data-note-link-raw` 都是**目标**原文(点击预填也要拿目标,不是显示文本)。
 * 点击分发在 MarkdownBody(事件委托):id 非空跳转,空则拿**目标**标题预填统一输入框的 `@`。
 */
import type { RendererRule, StateInline } from 'markdown-it';
import { MAX_TITLE_CHARS, normalizeTitle, splitAlias, titleOf } from './note-link-syntax';
import type { NoteLink } from './types';

/** chip 携带的解析结果:id 与目标的当前显示首行 */
export interface NoteLinkTarget {
  id: number;
  title: string;
}

/** render 时经 markdown-it `env` 传进来的解析表:归一化标题 -> 目标(用 type 而非 interface,
 *  否则不满足 markdown-it `Env` 的索引签名而无法直接传进 `md.render`) */
export type NoteLinkEnv = { links?: ReadonlyMap<string, NoteLinkTarget> };

/** 出链数组 -> env:`normalizeTitle` 与 L1/Rust 同源,大小写/空白差异也能对上。
 *  不传 links(非笔记上下文的纯预览)时**不注册**解析表 —— 行内规则据此不认 `[[…]]` 语法。 */
export function noteLinkEnv(links: readonly NoteLink[] | undefined): NoteLinkEnv {
  if (links === undefined) return {};
  const map = new Map<string, NoteLinkTarget>();
  for (const l of links) {
    if (l.targetId !== null) map.set(normalizeTitle(l.rawTitle), { id: l.targetId, title: l.title ?? l.rawTitle });
  }
  return { links: map };
}

/** 一条参与 `[[ ]]` 目标裁决的实体(D6):标签给 `name`(单段名),笔记给 `content`(首行参与匹配) */
export interface LinkCandidate {
  id: number;
  kind: 'note' | 'tag';
  name?: string | null;
  content?: string | null;
}

/**
 * `[[X]]` 目标裁决(D6):先在 `name` 命中的标签里取 id 最小,再在笔记首行里取 id 最小;
 * 标签优先;都没命中返回 null。`excludeId` 用来跳过来源自己(自指)。
 * 与 Rust `note_links::resolve_target` 同口径 —— 共享向量 `fixtures/entity-link-targets.json`
 * 两侧各跑一遍(`entity-link-targets.test.ts` / `note_link_fixtures_tests.rs`)。
 */
export function resolveLinkTarget(
  candidates: readonly LinkCandidate[],
  rawTitle: string,
  excludeId: number | null = null
): number | null {
  const key = normalizeTitle(rawTitle);
  if (key === '') return null;
  let tag: number | null = null;
  let note: number | null = null;
  for (const c of candidates) {
    if (c.id === excludeId) continue;
    const ck = c.kind === 'tag' ? normalizeTitle(c.name ?? '') : titleOf(c.content ?? '');
    if (ck !== key) continue;
    if (c.kind === 'tag') tag = tag === null || c.id < tag ? c.id : tag;
    else note = note === null || c.id < note ? c.id : note;
  }
  return tag ?? note;
}

/** `[[` 与 `]]` 之间的合法内容:只判**目标**部分(设计 A2),显示文本不参与合法性判定 */
function validContent(inner: string): boolean {
  const { rawTitle } = splitAlias(inner);
  return (
    rawTitle !== '' &&
    !rawTitle.startsWith('#') &&
    !rawTitle.includes('[') &&
    !rawTitle.includes(']') &&
    !rawTitle.includes('\n') &&
    [...rawTitle].length <= MAX_TITLE_CHARS
  );
}

/**
 * markdown-it 行内规则:命中 `[[X]]` 就推一个 `note_link` token(标题裁首尾空白)。
 * 整串不合法时返回 false,交回常规解析 —— 与 L1「不满足的整串保持字面」同结果。
 * silent(只探测不产生 token)时只前进光标。
 */
export function noteLinkRule(state: StateInline, silent: boolean): boolean {
  // 非笔记上下文(调用方没给 links):不认 `[[…]]` 语法,交回常规解析(只读预览保持字面)
  if ((state.env as NoteLinkEnv).links === undefined) return false;
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x5b || state.src.charCodeAt(start + 1) !== 0x5b) return false;
  const close = state.src.indexOf(']]', start + 2);
  if (close < 0) return false;
  const raw = state.src.slice(start + 2, close).trim();
  if (!silent) {
    if (validContent(raw)) {
      const token = state.push('note_link', '', 0);
      token.content = raw;
    } else {
      // 整串不合法:与 L1 同口径地整串保持字面 —— 吃掉到 `]]`,
      // 不让内层 `[[` 重新起头(嵌套 `[[甲[[乙]]` 与 L1 一样不成链接)
      const token = state.push('text', '', 0);
      token.content = state.src.slice(start, close + 2);
    }
  }
  state.pos = close + 2;
  return true;
}

const ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** chip 文本转义(产物随后还会过 DOMPurify,这里先挡注入) */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESCAPE[c]);
}

const RESOLVED_CLASS = 'note-link cursor-pointer text-accent underline';
const UNRESOLVED_CLASS = 'note-link cursor-pointer text-muted underline decoration-dashed';

/** 一条链接 -> chip HTML:文字优先用显示文本,否则回落(已解析用目标首行、未解析用目标原文);
 *  `title` 提示指向谁(两种情形都用目标),`data-note-link-raw` 留着点击预填用(设计 A5)。 */
export function renderNoteLink(
  rawTitle: string,
  target: NoteLinkTarget | null,
  display: string | null = null
): string {
  const label = display ?? (target === null ? rawTitle : target.title);
  const tooltip = target === null ? rawTitle : target.title;
  const cls = target === null ? UNRESOLVED_CLASS : RESOLVED_CLASS;
  const attrs = `data-note-link="${target?.id ?? ''}" data-note-link-raw="${escapeHtml(rawTitle)}" title="${escapeHtml(tooltip)}"`;
  return `<span class="${cls}" ${attrs}>${escapeHtml(label)}</span>`;
}

/** 渲染规则:按 env 里的解析表查目标(归一化 key 与写入侧同源);内外先按第一个 `|` 切分别 */
export const renderNoteLinkToken: RendererRule = (tokens, idx, _options, env) => {
  const { rawTitle, display } = splitAlias(tokens[idx].content);
  const target = (env as NoteLinkEnv).links?.get(normalizeTitle(rawTitle)) ?? null;
  return renderNoteLink(rawTitle, target, display);
};

/** 一次点击命中的 chip:已解析给 id,未解析给**目标**原文(供预填) */
export interface NoteLinkHit {
  id: number | null;
  title: string;
}

/** 点击事件目标 -> 命中的 chip(最近祖先带 data-note-link);非 chip 返回 null。
 *  预填要的是目标(不是显示文本),优先读 `data-note-link-raw`,手写节点里没有就回落文本。 */
export function noteLinkFrom(target: EventTarget | null): NoteLinkHit | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('[data-note-link]');
  if (el === null) return null;
  const raw = el.getAttribute('data-note-link') ?? '';
  const id = Number.parseInt(raw, 10);
  const targetRaw = el.getAttribute('data-note-link-raw');
  return { id: Number.isInteger(id) ? id : null, title: targetRaw ?? (el.textContent ?? '').trim() };
}
