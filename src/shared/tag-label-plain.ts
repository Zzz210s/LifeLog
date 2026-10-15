/**
 * 标签名行内 markdown 的**解析口径**(扫描器 + 跨度 + `tagLabelPlain`)。
 *
 * 两种口径**同源**于这一个扫描器,不许各写一份:
 * - `tagLabelPlain`:去掉语法后的可见文本(给 title / 条件摘要 / `#` 补全 / 导出 / 确认文案);
 * - `renderTagLabel`(见 `tag-label.ts`):可见文本 -> React 节点,绝不渲染成 `<a>`。
 *
 * 语法刻意收得很窄(标签名不是文档):链接、粗体、斜体、下划线强调、删除线、行内代码、反斜杠转义。
 * **不做实体解码**:`&amp;` 在标签名里保持字面(正文由 markdown-it 解码,这里有意与正文不同 ——
 * Rust 侧无依赖做实体表,而它又是 FTS/别名/导出的真源);不做 linkify / 图片 / raw HTML。
 * 非法 / 未闭合 / 嵌套一律**逐字退化**(不猜后半段、不递归内层),这比"聪明的半解析"可预测。
 * 与 Rust `src-tauri/src/tag_label_plain.rs` 逐条一致,由 `fixtures/tag-label.json` 两侧共读钉住。
 * 逐条语法匹配器(正则 + flanking)在 `tag-label-match.ts`;拆文件只为守 200 行红线,
 * 调用方一处不用改(那边 `export ... from` 再导出)。
 */
import {
  CODE_RE,
  DEL_RE,
  EM_RE,
  ESCAPABLE,
  LINK_RE,
  STRONG_RE,
  matchAt,
  matchUnder,
  runOf,
} from './tag-label-match';

export type TagLabelToken =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; title: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'del'; text: string }
  | { kind: 'code'; text: string };

/** 命中的 token 与它在原文里的跨度(UTF-16 下标;token 序列连续铺满整串) */
export interface TagLabelSpan {
  token: TagLabelToken;
  start: number;
  end: number;
}

/**
 * 行内 token 序列与各自跨度(唯一解析入口;`parseTagLabel` 是它的投影)。
 * 要**按区间判定**的调用方取这个版本 —— `tag-label-paren.ts` 就靠它认出
 * 「哪些括号被行内 md 链接消费掉了」。
 * 逐字符左到右扫描,只在当前位置尝试各种语法;失败就把该字符(或整串同类定界符)并进文本。
 */
export function parseTagLabelSpans(raw: string): TagLabelSpan[] {
  const spans: TagLabelSpan[] = [];
  let buf = '';
  let bufStart = 0;
  let i = 0;
  const flush = (): void => {
    if (buf !== '') {
      spans.push({ token: { kind: 'text', text: buf }, start: bufStart, end: i });
      buf = '';
    }
  };
  /** 累积字面文本;首次落笔时记住这一段的起点(转义会去反斜杠,故不能按 buf 长度倒推) */
  const addText = (s: string): void => {
    if (buf === '') bufStart = i;
    buf += s;
  };
  const eatRun = (): void => {
    const run = runOf(raw, i);
    addText(run);
    i += run.length;
  };
  while (i < raw.length) {
    const c = raw[i];
    if (c === '\\') {
      const next = raw[i + 1];
      if (next !== undefined && ESCAPABLE.has(next)) {
        addText(next);
        i += 2;
      } else {
        addText(c);
        i++;
      }
      continue;
    }
    if (c === '*') {
      const strong = matchAt(STRONG_RE, raw, i);
      if (strong !== null) {
        flush();
        spans.push({ token: { kind: 'strong', text: strong[1] }, start: i, end: i + strong[0].length });
        i += strong[0].length;
        continue;
      }
      const em = matchAt(EM_RE, raw, i);
      if (em !== null) {
        flush();
        spans.push({ token: { kind: 'em', text: em[1] }, start: i, end: i + em[0].length });
        i += em[0].length;
        continue;
      }
      eatRun();
      continue;
    }
    if (c === '_') {
      const hit = matchUnder(raw, i);
      if (hit !== null) {
        flush();
        spans.push({ token: hit.token, start: i, end: i + hit.len });
        i += hit.len;
        continue;
      }
      eatRun();
      continue;
    }
    if (c === '~') {
      const del = matchAt(DEL_RE, raw, i);
      if (del !== null) {
        flush();
        spans.push({ token: { kind: 'del', text: del[1] }, start: i, end: i + del[0].length });
        i += del[0].length;
        continue;
      }
      eatRun();
      continue;
    }
    if (c === '`') {
      const code = matchAt(CODE_RE, raw, i);
      if (code !== null) {
        flush();
        spans.push({ token: { kind: 'code', text: code[1] }, start: i, end: i + code[0].length });
        i += code[0].length;
        continue;
      }
      eatRun();
      continue;
    }
    if (c === '[') {
      const link = matchAt(LINK_RE, raw, i);
      if (link !== null) {
        flush();
        spans.push({
          token: { kind: 'link', text: link[1], title: link[2] },
          start: i,
          end: i + link[0].length,
        });
        i += link[0].length;
        continue;
      }
      addText(c);
      i++;
      continue;
    }
    addText(c);
    i++;
  }
  flush();
  return spans;
}

/** 行内 token 序列(唯一解析入口;要跨度的调用方见 `parseTagLabelSpans`) */
export function parseTagLabel(raw: string): TagLabelToken[] {
  return parseTagLabelSpans(raw).map((s) => s.token);
}

/** 去掉 md 语法后的可见文本(空串原样返回空串) */
export function tagLabelPlain(raw: string): string {
  return parseTagLabel(raw)
    .map((t) => t.text)
    .join('');
}
