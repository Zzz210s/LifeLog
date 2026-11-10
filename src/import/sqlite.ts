// 读取 lifelog.db：优先 sql.js（桌面端可选装），失败时回落到 JSON dump（scripts/dump-db.ts 生成）。
import { LineRow, PointRow } from './map';

export type Dump = { points: PointRow[]; lines: LineRow[] };

type SqlLike = {
  Database: new (data: Uint8Array) => { exec: (sql: string) => { values: unknown[][] }[]; close: () => void };
};

const POINT_SQL = "select id, meta, coalesce(created_at,'') as created_at, path, parent_id from points";
const LINE_SQL = 'select from_id, to_id, name_id from lines';

export function rowsToDump(pointRows: unknown[][], lineRows: unknown[][]): Dump {
  const nullish = (v: unknown) => v === null || v === undefined;
  return {
    points: pointRows.map((v) => ({
      id: Number(v[0]),
      meta: String(v[1] ?? ''),
      created_at: String(v[2] ?? ''),
      path: nullish(v[3]) ? null : String(v[3]),
      parent_id: nullish(v[4]) ? null : Number(v[4]),
    })),
    lines: lineRows.map((v) => ({
      from_id: Number(v[0]),
      to_id: Number(v[1]),
      name_id: nullish(v[2]) ? null : Number(v[2]),
    })),
  };
}

/** 从并进的 .json dump 读取（无需 sql.js）。 */
export function parseDump(text: string): Dump {
  const raw = JSON.parse(text) as Partial<Dump>;
  if (!Array.isArray(raw.points) || !Array.isArray(raw.lines)) throw new Error('dump 里缺 points/lines');
  return { points: raw.points, lines: raw.lines };
}

/**
 * 读 sqlite 字节。`loadSql` 由调用方注入（桌面端用 `import('sql.js')`），
 * 这样本文件在移动端与单测里都不会被 sql.js 拖住。
 */
export async function readDb(bytes: Uint8Array, loadSql: () => Promise<SqlLike>): Promise<Dump> {
  const SQL = await loadSql();
  const db = new SQL.Database(bytes);
  try {
    const p = db.exec(POINT_SQL);
    const l = db.exec(LINE_SQL);
    return rowsToDump(p[0]?.values ?? [], l[0]?.values ?? []);
  } finally {
    db.close();
  }
}
