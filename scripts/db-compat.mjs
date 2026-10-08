// 迁移 027 下架了老表(notes/tags/tag_links/note_links/notes_fts/tag_merge_log/tag_aliases),
// 验收脚本仍按老表名读数。本件在**只读连接**上装 TEMP 兼容视图,让老脚本不改 SQL 也能读到等价数据,
// 只改「读数口径」不改产品代码。口径与 Rust 测试夹具 db/entities_tags_fixture.rs::legacy_read_views 同源。
//
// 口径要点:
//   - id 一律用**统一实体 id**(标签保留 1e9 偏移的原值):这样读数可直接回喂 IPC(delete_tag/rename_tag
//     等),脚本内部的集合/计数比较也自洽(不再走老 id 命名空间)。
//   - tag_links:note 行 = tagging 边(笔记 -> 标签),tag 行 = relation 边(标签 -> 标签);
//     与老表 tag_id/target_type/target_id 三列同形。
//   - note_links:只含**已解析**的 link 边(D2 未解析不落边);raw_title 老表才有,这里给空串。
//   - notes_fts:只投影笔记实体行(rowid == 笔记 id),列名沿用老表 tags(= tag_paths)。
//   - TEMP 视图不落主库文件,只读连接允许创建(DROP/CREATE TEMP 只动 temp schema)。
import { DatabaseSync } from 'node:sqlite';

/** 真实库路径(可用 LIFELOG_DB 覆盖,如跑独立 identifier 的副本库) */
export const DB_PATH = process.env.LIFELOG_DB ?? 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';

const VIEWS = [
  `CREATE TEMP VIEW temp.notes AS
     SELECT id, content, created_at FROM entities WHERE kind = 'note'`,
  `CREATE TEMP VIEW temp.tags AS
     SELECT id, name, parent_id, path, depth, sort_order, color FROM entities WHERE kind = 'tag'`,
  `CREATE TEMP VIEW temp.tag_links AS
     SELECT target_id AS tag_id, 'note' AS target_type, source_id AS target_id, remark
       FROM edges WHERE kind = 'tagging'
     UNION ALL
     SELECT source_id AS tag_id, 'tag' AS target_type, target_id AS target_id, remark
       FROM edges WHERE kind = 'relation'`,
  `CREATE TEMP VIEW temp.note_links AS
     SELECT id, source_id, target_id, '' AS raw_title, created_at FROM edges WHERE kind = 'link'`,
  `CREATE TEMP VIEW temp.notes_fts AS
     SELECT rowid, name, content, tag_paths AS tags FROM entities_fts
      WHERE rowid IN (SELECT id FROM entities WHERE kind = 'note')`,
  `CREATE TEMP VIEW temp.tag_merge_log AS
     SELECT id, source_entity_id AS source_tag_id, target_entity_id AS target_tag_id,
            moved_child_ids, note_links, edges, at FROM entity_merge_log`,
  `CREATE TEMP VIEW temp.tag_aliases AS
     SELECT alias, entity_id AS tag_id FROM entity_aliases WHERE entity_id >= 1000000000`,
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
