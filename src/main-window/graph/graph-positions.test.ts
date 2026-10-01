/**
 * 位置记忆的纯函数:读 / 写 / 修剪(按现存标签 id) / 叠加到布局结果上。
 * 库里的脏值(坏 JSON、数组、非有限坐标、缺字段)一律丢掉 —— 一个坏条目不该让整图落不了位。
 */
import { describe, expect, it } from 'vitest';
import type { Point } from './radial';
import { applyPositions, parsePositions, prunePositions, serializePositions } from './graph-positions';

const LAYOUT: Map<number, Point> = new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 100, y: 0 }],
]);

describe('位置记忆的读写与修剪', () => {
  it('坏 JSON / null / 非对象退化为空', () => {
    expect(parsePositions(null)).toEqual({});
    expect(parsePositions('')).toEqual({});
    expect(parsePositions('{oops')).toEqual({});
    expect(parsePositions('[]')).toEqual({});
    expect(parsePositions('"12"')).toEqual({});
  });

  it('丢掉坐标非有限数、缺字段、id 不是整数的条目(其余照收)', () => {
    expect(parsePositions('{"4":{"x":1e999,"y":0},"5":{"x":"1","y":0},"6":{"x":1},"甲":{"x":1,"y":1}}')).toEqual({});
    expect(parsePositions('{"7":{"x":-3.5,"y":2}}')).toEqual({ '7': { x: -3.5, y: 2 } });
  });

  it('往返一致', () => {
    const p = { '12': { x: 1.5, y: -2 } };
    expect(parsePositions(serializePositions(p))).toEqual(p);
  });

  it('修剪:只保留仍存在的标签 id', () => {
    const p = { '12': { x: 0, y: 0 }, '99': { x: 1, y: 1 } };
    expect(prunePositions(p, new Set([12]))).toEqual({ '12': { x: 0, y: 0 } });
  });
});

describe('位置叠加到布局结果', () => {
  it('只覆盖这次布局里存在、且记过的节点;不改原 Map', () => {
    const out = applyPositions(LAYOUT, { '2': { x: -50, y: 7 }, '9': { x: 1, y: 1 } });
    expect(out.get(2)).toEqual({ x: -50, y: 7 });
    expect(out.get(1)).toEqual({ x: 0, y: 0 }); // 没记过的保持布局坐标
    expect(out.has(9)).toBe(false); // 这次布局里没有的 id 不无中生有
    expect(LAYOUT.get(2)).toEqual({ x: 100, y: 0 }); // 原 Map 不被改写
  });

  it('没有记忆时原样返回布局结果(连 Map 身份都不变,下游 memo 不白重建)', () => {
    expect(applyPositions(LAYOUT, {})).toBe(LAYOUT);
  });
});
