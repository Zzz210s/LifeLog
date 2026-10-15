/**
 * 裸括号谓词的前端侧用例(与 Rust `src-tauri/src/tag_label_paren_tests.rs` 同表:
 * 三条用例名与表格逐条一致)。谓词是「名称合法性」与「关系名合法性」的共同前提。
 */
import { describe, expect, it } from 'vitest';
import { hasBareParen } from './tag-label-paren';

describe('hasBareParen:行内 md 之外的括号一律算裸(Rust 侧同表)', () => {
  it('bare_paren_detects_unpaired:未由行内 md 链接成对的括号一律算裸', () => {
    for (const raw of [
      '工作(重要)',
      '(重点)',
      'a(b)c',
      '工作)',
      '工作(重点',
      '[郴](chēn)州市(别名)',
      '**a(b)**',
      '`a(b)`',
      'a]](b)',
    ]) {
      expect(hasBareParen(raw), raw).toBe(true);
    }
  });

  it('md_link_parens_are_not_bare:行内 md 链接消费掉的括号不算裸', () => {
    for (const raw of [
      '[郴](chēn)州市',
      '[a](b)',
      '[郴](chēn)',
      '**重点**',
      '`代码`',
      '工作',
      'a/b',
      '',
    ]) {
      expect(hasBareParen(raw), raw).toBe(false);
    }
  });

  it('nested_link_in_segment_is_ok:链接嵌在段内文本中间整体合法', () => {
    for (const raw of ['a[b](c)d', '地点/[郴](chēn)州市', '[a](b)[c](d)', 'x[a(b)](c)y']) {
      expect(hasBareParen(raw), raw).toBe(false);
    }
  });
});
