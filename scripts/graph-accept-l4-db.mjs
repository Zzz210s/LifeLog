// 关系图 L4 真机读数 8 的**只读库件**(自 dev-links-accept-l4.mjs 拆出,守 200 行红线):
// 计数、夹具清单、以及「该标签(含子孙)的出链 / 入链」的**独立一份**写法。
// 独立写法的意义:读数 8c 要和实现比,不能用实现那条 SQL 自证 —— 这里走 EXISTS 反查。
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './no-tabs-accept-lib.mjs';

const ro = (fn) => {
  const db = new DatabaseSync('file:' + DB_PATH, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

export const get = (sql, ...args) => ro((db) => db.prepare(sql).get(...args));
export const all = (sql, ...args) => ro((db) => db.prepare(sql).all(...args));

/** 库对账要逐项比的那几个计数 + integrity + user_version */
export const counts = () =>
  ro((db) => {
    const n = (sql) => db.prepare(sql).get().n;
    return {
      notes: n('SELECT COUNT(*) n FROM notes'),
      tags: n('SELECT COUNT(*) n FROM tags'),
      tagLinks: n('SELECT COUNT(*) n FROM tag_links'),
      fts: n('SELECT COUNT(*) n FROM notes_fts'),
      noteLinks: n('SELECT COUNT(*) n FROM note_links'),
      version: db.prepare('PRAGMA user_version').get().user_version,
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    };
  });

/** 本任务自建的夹具(一律 `LINK测试` 前缀):收尾要按它们确认删净 */
export const fixtureNoteIds = () =>
  all(`SELECT id FROM notes WHERE content LIKE 'LINK测试%' ORDER BY id`).map((r) => r.id);
export const fixtureTagIds = () =>
  all(`SELECT id FROM tags WHERE path LIKE 'LINK测试%' ORDER BY depth DESC`).map((r) => r.id);

/** 该标签(含子孙)的「出链 / 入链」:只算已解析且非自指的链接(与图上 link 边同一口径) */
export const degreeOf = (tagId) =>
  get(
    `WITH RECURSIVE sub(id) AS (
       SELECT id FROM tags WHERE id = ?1
       UNION ALL SELECT t.id FROM tags t JOIN sub s ON t.parent_id = s.id)
     SELECT
       (SELECT COUNT(DISTINCT nl.id) FROM note_links nl
          WHERE nl.target_id IS NOT NULL AND nl.source_id <> nl.target_id
            AND EXISTS (SELECT 1 FROM tag_links tl WHERE tl.target_type = 'note' AND tl.target_id = nl.source_id
                          AND tl.tag_id IN (SELECT id FROM sub))) AS outbound,
       (SELECT COUNT(DISTINCT nl.id) FROM note_links nl
          WHERE nl.source_id <> nl.target_id
            AND EXISTS (SELECT 1 FROM tag_links tl WHERE tl.target_type = 'note' AND tl.target_id = nl.target_id
                          AND tl.tag_id IN (SELECT id FROM sub))) AS backlinks`,
    tagId,
  );
