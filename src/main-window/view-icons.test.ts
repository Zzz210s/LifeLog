/**
 * 视图图标白名单与选择语义(vitest,node 环境):
 * 白名单数量/去重/形状、白名单外不渲染、选择器点选与清空语义。
 */
import { expect, it } from 'vitest';
import { VIEW_ICON_NAMES, ViewIcon, nextIconValue } from './view-icons';

it('白名单数量与去重', () => {
  expect(VIEW_ICON_NAMES.length).toBeGreaterThanOrEqual(40);
  expect(new Set(VIEW_ICON_NAMES).size).toBe(VIEW_ICON_NAMES.length);
});

it('白名单内的名字能取到组件,白名单外返回 null', () => {
  expect(ViewIcon({ name: 'star' })).not.toBeNull();
  expect(ViewIcon({ name: 'not-a-real-icon' })).toBeNull();
  expect(ViewIcon({ name: null })).toBeNull();
  expect(ViewIcon({ name: 'STAR' })).toBeNull(); // 大小写敏感:后端也只收小写
});

it('白名单每个名字都能渲染(映射表与清单不脱节)', () => {
  for (const name of VIEW_ICON_NAMES) {
    expect(ViewIcon({ name }), `白名单名字缺组件: ${name}`).not.toBeNull();
  }
});

it('白名单名字直接可入库(长度 ≤40 且只含 [a-z0-9-],与后端校验同口径)', () => {
  for (const name of VIEW_ICON_NAMES) {
    expect(name).toMatch(/^[a-z0-9-]+$/);
    expect(name.length).toBeLessThanOrEqual(40);
  }
});

it('点选语义:点未选中 -> 选中该名字;再点同一项 -> 清空(null)', () => {
  expect(nextIconValue(null, 'star')).toBe('star');
  expect(nextIconValue('star', 'tag')).toBe('tag');
  expect(nextIconValue('star', 'star')).toBeNull();
  expect(nextIconValue(null, null)).toBeNull();
});
