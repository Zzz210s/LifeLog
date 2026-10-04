/**
 * 关系图分类色的令牌表(2026-10-04 设计 D4 / 返工):Paul Tol muted,亮暗各一套。
 * 单独一份文件,免得 theme-tokens.test.ts 顶到 200 行红线。
 */
export const GRAPH_COLORS: ReadonlyArray<readonly [string, string, string]> = [
  ['--color-graph-1', '#44aa99', '#6fc9b8'],
  ['--color-graph-2', '#332288', '#8a86d8'],
  ['--color-graph-3', '#999933', '#c4c060'],
  ['--color-graph-4', '#88ccee', '#a5dcf5'],
  ['--color-graph-5', '#cc6677', '#e88b9b'],
  ['--color-graph-6', '#117733', '#4aa96a'],
  ['--color-graph-7', '#aa4499', '#c977c4'],
  ['--color-graph-8', '#882255', '#c4677f'],
];
