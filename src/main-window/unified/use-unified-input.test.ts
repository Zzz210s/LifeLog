import { describe, expect, it } from 'vitest';
import { derive, reduceUnified, type UnifiedState } from './unified-input-model';

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
  it('set:有前缀开下拉、记录模式关下拉(D6 主路径)', () => {
    expect(reduceUnified(init(''), { type: 'set', raw: '#购' }).dropdownOpen).toBe(true);
    expect(reduceUnified({ ...init('#购'), dropdownOpen: true }, { type: 'set', raw: '买牛奶' }).dropdownOpen).toBe(false);
  });

  it('openDropdown:有前缀才开;记录模式保持关(评审 M2)', () => {
    const closed = { ...derive('#购'), dropdownOpen: false };
    expect(reduceUnified(closed, { type: 'openDropdown' })).toMatchObject({ dropdownOpen: true, raw: '#购' });
    const note = derive('草稿');
    expect(reduceUnified(note, { type: 'openDropdown' }).dropdownOpen).toBe(false);
  });

  it('closeDropdown:关下拉且内容与模式都不动', () => {
    const s = reduceUnified({ ...init('/牛奶'), mode: 'filter', prefix: '/', query: '牛奶', dropdownOpen: true },
      { type: 'closeDropdown' });
    expect(s).toMatchObject({ dropdownOpen: false, raw: '/牛奶', mode: 'filter' });
  });

  it('pickPrefix 切到记录模式时保留已输入内容(评审 G5)', () => {
    const s = reduceUnified({ ...init('#购物'), mode: 'tag', prefix: '#', query: '购物', dropdownOpen: true },
      { type: 'pickPrefix', prefix: '' });
    expect(s.raw).toBe('购物');
  });

  it('带前缀换另一个前缀:内容保留(评审 G6)', () => {
    const s = reduceUnified({ ...init('/牛奶'), mode: 'filter', prefix: '/', query: '牛奶' },
      { type: 'pickPrefix', prefix: '#' });
    expect(s).toMatchObject({ raw: '#牛奶', mode: 'tag', query: '牛奶', dropdownOpen: true });
  });
});

