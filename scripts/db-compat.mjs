// 迁移 027 下架了老表(notes/tags/tag_links/note_links/notes_fts/tag_merge_log/tag_aliases),
// 028 又把实体收成一张表(去 `kind`/`name`、加 `meta`,老三种引用边并入 `link`)。
// 验收脚本仍按老表名 / 老列名读数。本件在**只读连接**上装 TEMP 兼容视图,让老脚本不改 SQL 也能
// 读到等价数据,只改「读数口径」不改产品代码。
//
// 口径要点(2026-10-09 v29 重写):
//   - 实体二分由 **`path`** 表达,不再有 `kind`:树内实体 `path IS NOT NULL`(老标签),树外 `path IS NULL`
//     (老笔记;真库 742 / 1373)。
//   - `notes.content` / `notes_fts.content` = 新列 `meta`;`notes_fts.tags` = 新列 `paths`。
//   - `tags.name` = `path` 末段(028 删了 `name` 列):`rtrim(path, replace(path, '/', ''))` 从右侧剥掉
//     一切非 `/` 字符,**停在最后一个 `/` 上**(结果 = 含尾斜杠的前缀),`substr(..., length+1)` 即末段;
//     无 `/` 的单段路径要单独兜底(整串就是名字)。
//   - 三种老引用边都由 `edges.kind='link'` 承载,按两端是否树内还原:
//       源树外 + 目标树内 = 老 `tagging`(笔记打标签);两端树内 = 老 `relation`;
//       两端树外 = 老 `note_links`(`[[ ]]`)。
//   - id 一律用**统一实体 id**(不再有 1e9 偏移):读数可直接回喂 IPC(delete_tag/rename_tag 等)。
//   - `note_links.raw_title` 老表才有(老模型存未解析标题),这里给空串。
//   - `tag_merge_log` 的 027 前遗留行带 024 的 `+1e9` 偏移(该标签在 028 前已被合并删除,无统一实体 id
//     可映射,028 的 `_id_map` 改写跳过它):视图**回译**这个偏移(`-1e9`),还原成 027 前老表的原始
//     标签 id 命名空间,不让 1e9 量级 id 从兼容层漏出。
//   - TEMP 视图不落主库文件,只读连接允许创建(DROP/CREATE TEMP 只动 temp schema)。
import { DatabaseSync } from 'node:sqlite';

/** 024 给标签 id 加的整体偏移;遗留合并日志行按它回译(与迁移 027 的 entity_ids.rs 同一字面量)。 */
const LEGACY_TAG_OFFSET = 1_000_000_000;
/** 遗留 1e9 偏移 id -> 老表原始 id(仅用于没有统一实体 id 可映射的历史合并日志行) */
const UNOFFSET = (col) => `CASE WHEN ${col} >= ${LEGACY_TAG_OFFSET} THEN ${col} - ${LEGACY_TAG_OFFSET} ELSE ${col} END`;

/** 真实库路径(可用 LIFELOG_DB 覆盖,如跑独立 identifier 的副本库) */
export const DB_PATH = process.env.LIFELOG_DB ?? 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';

/** 树外(老笔记)实体的判定;视图里反复用,故抽成常量 */
const NOTE = `(SELECT e2.path FROM entities e2 WHERE e2.id = e.source_id) IS NULL`;

const VIEWS = [
  `CREATE TEMP VIEW temp.notes AS
     SELECT id, meta AS content, created_at FROM entities WHERE path IS NULL`,
  `CREATE TEMP VIEW temp.tags AS
     SELECT id,
            CASE WHEN instr(path, '/') = 0 THEN path
                 ELSE substr(path, length(rtrim(path, replace(path, '/', ''))) + 1) END AS name,
            parent_id, path, depth, sort_order, color
       FROM entities WHERE path IS NOT NULL`,
  `CREATE TEMP VIEW temp.tag_links AS
     SELECT e.target_id AS tag_id, 'note' AS target_type, e.source_id AS target_id, e.remark
       FROM edges e JOIN entities t ON t.id = e.target_id
      WHERE e.kind = 'link' AND t.path IS NOT NULL AND ${NOTE}
     UNION ALL
     SELECT e.source_id AS tag_id, 'tag' AS target_type, e.target_id AS target_id, e.remark
       FROM edges e JOIN entities s ON s.id = e.source_id JOIN entities t ON t.id = e.target_id
      WHERE e.kind = 'link' AND s.path IS NOT NULL AND t.path IS NOT NULL`,
  `CREATE TEMP VIEW temp.note_links AS
     SELECT e.id, e.source_id, e.target_id, '' AS raw_title, e.created_at
       FROM edges e JOIN entities s ON s.id = e.source_id JOIN entities t ON t.id = e.target_id
      WHERE e.kind = 'link' AND s.path IS NULL AND t.path IS NULL`,
  `CREATE TEMP VIEW temp.notes_fts AS
     SELECT rowid, '' AS name, meta AS content, paths AS tags FROM entities_fts
      WHERE rowid IN (SELECT id FROM entities WHERE path IS NULL)`,
  `CREATE TEMP VIEW temp.tag_merge_log AS
     SELECT id, ${UNOFFSET('source_entity_id')} AS source_tag_id,
            ${UNOFFSET('target_entity_id')} AS target_tag_id,
            moved_child_ids, note_links, edges, at FROM entity_merge_log`,
  `CREATE TEMP VIEW temp.tag_aliases AS
     SELECT alias, entity_id AS tag_id FROM entity_aliases`,
];

/** 打开只读连接并装好老表兼容视图(用完自行 close) */
export function openReadOnly(path = DB_PATH) {
  const db = new DatabaseSync('file:' + path, { readOnly: true });
  for (const v of VIEWS) db.exec(v);
  return db;
}

/** 一次性只读查询(自动 close);fn 内可用老表名 */
export const ro = (fn, path = DB_PATH) => {
  const db = openReadOnly(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
