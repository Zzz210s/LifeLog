#!/usr/bin/env python
"""LifeLog 库只读读数(验收用):按行输出 `键 = 值`,供前后对照与迁移幂等复核。

用法:
  python scripts/lifelog-db-readings.py                      # 真实库(默认路径)
  python scripts/lifelog-db-readings.py <db 路径>            # 指定库(如快照/副本)

只读打开(mode=ro),不会写库、不建 WAL;应用运行中同样安全。
"""
import sqlite3
import sys

DEFAULT_DB = "C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db"
TIME_ROOT = "时间排序"
DAY_LEVEL = "时间排序/????/??/??"


def scalar(conn, sql, args=()):
    return conn.execute(sql, args).fetchone()[0]


def readings(db):
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        out = {}
        out["库文件"] = db
        out["user_version"] = scalar(conn, "PRAGMA user_version")
        out["notes 行数"] = scalar(conn, "SELECT COUNT(*) FROM notes")
        out["notes SUM(id)"] = scalar(conn, "SELECT COALESCE(SUM(id),0) FROM notes")
        out["notes SUM(字节长度)"] = scalar(conn, "SELECT COALESCE(SUM(LENGTH(content)),0) FROM notes")
        out["tags 行数"] = scalar(conn, "SELECT COUNT(*) FROM tags")
        out["tags SUM(id)"] = scalar(conn, "SELECT COALESCE(SUM(id),0) FROM tags")
        out["tag_links 行数"] = scalar(conn, "SELECT COUNT(*) FROM tag_links")
        out["tag_links 校验和"] = scalar(
            conn,
            "SELECT COALESCE(SUM(t.id * 1000003 + l.target_id),0) FROM tag_links l JOIN tags t ON t.id = l.tag_id",
        )
        out["空标签容器(无任何链接)"] = scalar(
            conn,
            "SELECT COUNT(*) FROM tags t WHERE NOT EXISTS (SELECT 1 FROM tag_links l WHERE l.tag_id = t.id)",
        )
        out[f"{TIME_ROOT} 子树节点"] = scalar(
            conn, "SELECT COUNT(*) FROM tags WHERE path = ? OR path LIKE ?", (TIME_ROOT, TIME_ROOT + "/%")
        )
        out["日级节点"] = scalar(conn, "SELECT COUNT(*) FROM tags WHERE path GLOB ?", (DAY_LEVEL,))
        out["notes_fts 行数"] = scalar(conn, "SELECT COUNT(*) FROM notes_fts")
        out["notes_fts 缺行"] = scalar(
            conn, "SELECT COUNT(*) FROM notes n WHERE NOT EXISTS (SELECT 1 FROM notes_fts f WHERE f.rowid = n.id)"
        )
        out["notes_fts 命中 2026(时间标签入索引的代价)"] = scalar(
            conn, "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH '2026'"
        )
        out["notes_fts 命中 时间线(应为 0)"] = scalar(
            conn, "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH '时间线'"
        )
        out["saved_views 行数"] = scalar(conn, "SELECT COUNT(*) FROM saved_views")
        out["无任何标签的笔记"] = scalar(
            conn,
            "SELECT COUNT(*) FROM notes n WHERE NOT EXISTS (SELECT 1 FROM tag_links l WHERE l.target_id = n.id AND l.target_type='note')",
        )
        out["待办(含子级)去 done(含子级)"] = scalar(
            conn,
            """SELECT COUNT(DISTINCT n.id) FROM notes n
               JOIN tag_links l ON l.target_id = n.id AND l.target_type='note'
               JOIN tags t ON t.id = l.tag_id
               WHERE (t.path = '待办' OR t.path LIKE '待办/%')
                 AND NOT EXISTS (SELECT 1 FROM tag_links l2 JOIN tags t2 ON t2.id = l2.tag_id
                                 WHERE l2.target_id = n.id AND l2.target_type='note'
                                   AND (t2.path = 'done' OR t2.path LIKE 'done/%'))""",
        )
        out["待办 子树命中"] = scalar(
            conn,
            """SELECT COUNT(DISTINCT l.target_id) FROM tag_links l JOIN tags t ON t.id = l.tag_id
               WHERE l.target_type='note' AND (t.path = '待办' OR t.path LIKE '待办/%')""",
        )
        out["done 子树命中"] = scalar(
            conn,
            """SELECT COUNT(DISTINCT l.target_id) FROM tag_links l JOIN tags t ON t.id = l.tag_id
               WHERE l.target_type='note' AND (t.path = 'done' OR t.path LIKE 'done/%')""",
        )
        out["测试验收笔记残留"] = scalar(
            conn, "SELECT COUNT(*) FROM notes WHERE content LIKE '%测试验收%'"
        )
        out["integrity_check"] = scalar(conn, "PRAGMA integrity_check")
        for key in ("auto_time_tag", "time_tag_template", "filter_last", "time_section_open"):
            row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
            out[f"settings.{key}"] = "<缺失>" if row is None else row[0]
        rows = conn.execute("SELECT key, value FROM settings ORDER BY key").fetchall()
        out["settings 全表"] = " | ".join(f"{k}={v}" for k, v in rows)
        return out
    finally:
        conn.close()


if __name__ == "__main__":
    db = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DB
    for key, value in readings(db).items():
        print(f"{key} = {value}")
