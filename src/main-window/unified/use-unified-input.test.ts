import { describe, expect, it } from 'vitest';
import { reduceUnified, type UnifiedState } from './unified-input-model';

const init = (raw: string): UnifiedState => ({ raw, mode: 'note', query: raw, prefix: '', dropdownOpen: false });

describe('统一输入框状态机(设计 §4)', () => {
  it('set:按首字符解析模式', () => {
    expect(reduceUnified(init(''), { type: 'set', raw: '#购物' }))
      .toMatchObject({ mode: 'tag', query: '购物', prefix: '#' });
  });

  it('set:非首字符的 # 不切模式(D7)', () => {
    expect(reduceUnified(init(''), { type: 'set', raw: '买了牛奶 #生活' }))
      .toMatchObject({ mode: 'note', query: '买了牛奶 #生活' });
  });

  it('pickPrefix:带前缀的项在有内容时自动开下拉', () => {
    const s = reduceUnified(init('牛奶'), { type: 'pickPrefix', prefix: '@' });
    expect(s.raw).toBe('@牛奶');
    expect(s.mode).toBe('open');
    expect(s.dropdownOpen).toBe(true);
  });

  it('pickPrefix:切到记录模式时关下拉', () => {
    const s = reduceUnified({ ...init('#购物'), mode: 'tag', prefix: '#', query: '购物', dropdownOpen: true },
      { type: 'pickPrefix', prefix: '' });
    expect(s.mode).toBe('note');
    expect(s.dropdownOpen).toBe(false);
  });

  it('esc:有下拉先关下拉,模式与内容不动', () => {
    const s = reduceUnified({ ...init('/牛奶'), mode: 'filter', prefix: '/', query: '牛奶', dropdownOpen: true }, { type: 'esc' });
    expect(s.dropdownOpen).toBe(false);
    expect(s.raw).toBe('/牛奶');
  });

  it('esc:无下拉则退模式并清空(记录模式本身无动作)', () => {
    const a = reduceUnified({ ...init('/牛奶'), mode: 'filter', prefix: '/', query: '牛奶' }, { type: 'esc' });
    expect(a).toMatchObject({ mode: 'note', raw: '' });
    const b = reduceUnified(init('草稿'), { type: 'esc' });
    expect(b.raw).toBe('草稿');
  });

  it('accept:采纳后关下拉但保留模式(可继续筛/继续找)', () => {
    const s = reduceUnified({ ...init('#购物'), mode: 'tag', prefix: '#', query: '购物', dropdownOpen: true }, { type: 'accept' });
    expect(s.dropdownOpen).toBe(false);
    expect(s.mode).toBe('tag');
  });

  it('clear:回到记录模式', () => {
    expect(reduceUnified({ ...init('@夏天'), mode: 'open', prefix: '@', query: '夏天', dropdownOpen: true }, { type: 'clear' }))
      .toMatchObject({ mode: 'note', raw: '', query: '', prefix: '' });
  });
});
