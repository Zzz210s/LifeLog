/**
 * 笔记间显式链接 `[[标题]]` 的**渲染口径**(设计 D10 / §4):正文里渲成可点 chip。
 *
 * 收敛到一处:markdown-it 的**行内规则**(围栏代码块/行内代码/`\[[x]]` 里不渲染成 chip ——
 * 这是 markdown-it 块级与行内解析顺序天然给的,与 L1 的跳过口径一致)+ 渲染函数
 * renderNoteLink + 点击命中 noteLinkFrom。调用方(markdown.ts / MarkdownBody)只从这里取。
 *
 * 已解析 -> `text-accent` 实线 + `data-note-link="<id>"`,标签文本用目标**当前**首行;
 * 未解析 -> `text-muted` 虚线 + `data-note-link=""`,文本用正文原文。
 * 点击分发在 MarkdownBody(事件委托):id 非空跳转,空则拿标题预填统一输入框的 `@`。
 */
import type { RendererRule, StateInline } from 'markdown-it';
import { MAX_TITLE_CHARS, normalizeTitle } from './note-link-syntax';
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

/** `[[` 与 `]]` 之间的合法标题:非空、不超长、不含方括号/换行、不以 `#` 开头(标签形) */
function validTitle(t: string): boolean {
  return (
    t !== '' &&
    !t.startsWith('#') &&
    !t.includes('[') &&
    !t.includes(']') &&
    !t.includes('\n') &&
    [...t].length <= MAX_TITLE_CHARS
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
    if (validTitle(raw)) {
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

/** 一条链接 -> chip HTML:已解析显示目标当前首行 + 目标 id,未解析显示原文 + 空 id */
export function renderNoteLink(rawTitle: string, target: NoteLinkTarget | null): string {
  const label = target === null ? rawTitle : target.title;
  const cls = target === null ? UNRESOLVED_CLASS : RESOLVED_CLASS;
  return `<span class="${cls}" data-note-link="${target?.id ?? ''}">${escapeHtml(label)}</span>`;
}

/** 渲染规则:按 env 里的解析表查目标(归一化 key 与写入侧同源) */
export const renderNoteLinkToken: RendererRule = (tokens, idx, _options, env) => {
  const raw = tokens[idx].content;
  const target = (env as NoteLinkEnv).links?.get(normalizeTitle(raw)) ?? null;
  return renderNoteLink(raw, target);
};

/** 一次点击命中的 chip:已解析给 id,未解析给正文原文(供预填) */
export interface NoteLinkHit {
  id: number | null;
  title: string;
}

/** 点击事件目标 -> 命中的 chip(最近祖先带 data-note-link);非 chip 返回 null */
export function noteLinkFrom(target: EventTarget | null): NoteLinkHit | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('[data-note-link]');
  if (el === null) return null;
  const raw = el.getAttribute('data-note-link') ?? '';
  const id = Number.parseInt(raw, 10);
  return { id: Number.isInteger(id) ? id : null, title: (el.textContent ?? '').trim() };
}
