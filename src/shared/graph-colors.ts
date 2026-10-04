/**
 * 关系图分类色的令牌表(2026-10-04 设计 D4):亮暗各一套。
 * 单独一份文件,免得 theme-tokens.test.ts 顶到 200 行红线。
 */
export const GRAPH_COLORS: ReadonlyArray<readonly [string, string, string]> = [
  ['--color-graph-1', '#2563eb', '#7aa7ff'],
  ['--color-graph-2', '#7c3aed', '#b18cff'],
  ['--color-graph-3', '#0f766e', '#4fd1c5'],
  ['--color-graph-4', '#b45309', '#f0a44a'],
  ['--color-graph-5', '#be123c', '#ff8fa3'],
  ['--color-graph-6', '#0369a1', '#67c7f0'],
  ['--color-graph-7', '#4d7c0f', '#a3d977'],
  ['--color-graph-8', '#a21caf', '#e78fe8'],
];
