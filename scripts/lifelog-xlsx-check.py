#!/usr/bin/env python
"""导出 xlsx 的日期列核对(时间标签降级 spec D8):日期列 = 笔记 created_at 的日期,不取时间标签。

用法:python scripts/lifelog-xlsx-check.py <xlsx 路径> [库路径]
做法:
  ① 表头必须是 日期/正文/标签/最后修改;
  ② 抽前 3 行数据,用「正文」在库里反查笔记,逐行比对 日期 == created_at 的日期;
  ③ 再抽 3 行「标签里带日级 时间排序/YYYY/MM/DD」的数据:这类笔记在真实库里绝大多数
     标签日 != created_at 日(基线 1031 条里 1028 条如此),若日期列仍等于 created_at,
     即可证明 D8「日期取自 created_at 而非时间标签」;
  ④ 数据行数与该时刻库内笔记数对照(导出是快照,故打印而非硬断言)。
"""
import re
import sqlite3
import sys

from openpyxl import load_workbook

DEFAULT_DB = "C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db"
HEADERS = ["日期", "正文", "标签", "最后修改"]
DAY_TAG = re.compile(r"#时间排序/(\d{4})/(\d{2})/(\d{2})")


def lookup(conn, content):
    """按正文反查笔记(内容列可能被导出截断,故退化用前缀匹配)"""
    hit = conn.execute("SELECT id, created_at FROM notes WHERE content = ? LIMIT 1", (content,)).fetchone()
    if hit is None:
        hit = conn.execute(
            "SELECT id, created_at FROM notes WHERE ? LIKE substr(content, 1, 60) || '%' LIMIT 1", (content,)
        ).fetchone()
    return hit


def main():
    xlsx = sys.argv[1]
    db = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_DB
    ws = load_workbook(xlsx, read_only=True, data_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    header = [str(c) for c in rows[0]]
    print(f"表头 = {header}")
    assert header[:4] == HEADERS, f"表头不符:期望 {HEADERS}"
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)

    ok = 0
    for n, row in enumerate(rows[1:4], start=2):
        date_cell, content = str(row[0]), str(row[1])
        hit = lookup(conn, content)
        assert hit is not None, f"第 {n} 行正文在库中反查不到:{content[:30]}"
        expected = hit[1][:10]
        ok += 1 if str(date_cell)[:10] == expected else 0
        print(f"  行{n}: 日期列={str(date_cell)[:10]} 库 created_at={hit[1]} id={hit[0]} 正文={content[:16]}")

    tagged = 0
    mismatch = 0
    for row in rows[1:]:
        m = DAY_TAG.search(str(row[2]))
        if m is None:
            continue
        hit = lookup(conn, str(row[1]))
        if hit is None:
            continue
        tag_date = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        same_as_created = str(row[0])[:10] == hit[1][:10]
        tagged += 1
        mismatch += 0 if same_as_created else 1
        if tagged <= 3:
            print(
                f"  带时间标签行: id={hit[0]} 日期列={str(row[0])[:10]} created_at={hit[1][:10]}"
                f" 时间标签日={tag_date} 日期列等于 created_at={same_as_created}"
            )
    total = conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
    print(f"xlsx 数据行 = {len(rows) - 1};该次读取时库内笔记数 = {total}(导出是快照,期间新笔记会造成差额)")
    print(f"[结论1] 前 3 行日期列与 created_at 日期一致:{ok}/3")
    print(f"[结论2] 带日级时间标签的行 {tagged} 行,其中日期列不等于 created_at 日期的 {mismatch} 行(应为 0)")
    print(f"[结论3] 日期列全为 YYYY-MM-DD:{all(str(r[0])[:4].isdigit() for r in rows[1:])}")


if __name__ == "__main__":
    main()
