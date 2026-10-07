# entity-migration · 四阶段迁移实施工具（T0.1）

统一实体迁移（`docs/superpowers/plans/2026-10-07-unified-entities-plan.md`，设计见
`docs/superpowers/specs/2026-10-07-unified-entities-design.md`）的实施期工具。本目录只服务迁移本身，
不属于产品代码，不随应用发布。

## 文件

| 文件 | 职责 |
|---|---|
| `snapshot.mjs` | `VACUUM INTO` 单文件快照（记忆 #1267：WAL 模式下只复制 `.db` 会丢 `-wal`，副本回落旧状态）。默认 dry-run。 |
| `reconcile.sql` | 对账**唯一真源**：spec §3 ①–⑤ 五条缓存对账 + 关键计数 + `integrity_check` / `foreign_key_check`。Rust 侧 Task 1.3 以 `include_str!` 引用同一文件。 |
| `reconcile-lib.mjs` | 解析 `reconcile.sql` 标记块 + 只读执行（`python sqlite3`，`mode=ro`）+ 文本格式化。 |
| `reconcile.mjs` | 对账 CLI，打印读数与逐条 PASS/FAIL；库不可写。 |
| `reconcile.test.mjs` | `node:test` 用例：SQL 可解析、v23/v24 形态库读数、对账能抓到缓存漂移、变异自证。 |

## 安全边界

- 真库 `C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db` **只读**（`mode=ro`）。对账与快照读源库都不写一个字节。
- 写库只发生在 `F:/0-code/_lifelog-snapshots/` 下的副本上（快照文件本身，以及后续在副本上试跑迁移）。
- `reconcile.sql` 只允许 `SELECT` / 只读 `PRAGMA`，禁止任何写语句。
- 快照目标已存在时拒绝覆盖；源库不存在时报错退出（码 2）。

## 四阶段命令序列

每阶段**开始前**先出快照，**结束后**对账；阶段 1–3 在副本上试跑通过后才对真库执行。

```bash
cd F:/0-code/20-active/LifeLog

# 0) 基线（实施前，一次）：真库只读对账 + 快照
node scripts/entity-migration/reconcile.mjs
node scripts/entity-migration/snapshot.mjs --tag p00 --snapshot

# 1) 阶段 1（迁移 024）前
node scripts/entity-migration/snapshot.mjs --tag p24 --snapshot
#    ... 在副本上试跑迁移 024，随后对副本对账：
node scripts/entity-migration/reconcile.mjs --db F:/0-code/_lifelog-snapshots/lifelog.db.bak-p24-<stamp>
#    真库执行迁移后，再对真库对账一次

# 2) 阶段 2（迁移 025）
node scripts/entity-migration/snapshot.mjs --tag p25 --snapshot
node scripts/entity-migration/reconcile.mjs --db <p25 副本>

# 3) 阶段 3（迁移 026）
node scripts/entity-migration/snapshot.mjs --tag p26 --snapshot
node scripts/entity-migration/reconcile.mjs --db <p26 副本>

# 4) 阶段 4（迁移 027）
node scripts/entity-migration/snapshot.mjs --tag p27 --snapshot
node scripts/entity-migration/reconcile.mjs --db <p27 副本>
```

快照与对账在 `user_version` 提升后**会同时看到新旧结构**：新表（`entities`/`edges`/`entities_fts`）存在时跑 modern
对账，老表（`tags`/`tag_links`/`notes_fts`）存在时跑 legacy 对账，缺表的块打印 `N/A`。因此同一份
`reconcile.sql` 在四个阶段都能用。

## 对账判据

- 五条对账（① parent_id 与 child 边一致 / ② path 与推导路径一致 / ③ depth 与推导深度一致 /
  ④ 单亲唯一 / ⑤ 无悬挂引用）**返回 0 行 = PASS**。
- `integrity_check` 单行 `ok` = PASS；`foreign_key_check` 0 行 = PASS。
- 退出码：任一条 FAIL/ERR 为 1，全 PASS（N/A 不计）为 0。

## 自检

```bash
node --test scripts/entity-migration/*.test.mjs
node scripts/entity-migration/reconcile.mjs          # 真库只读，退出码 0
node scripts/entity-migration/snapshot.mjs           # dry-run，不写盘
```

变异自证：把 `reconcile.sql` 里 ① 的 `e.parent_id IS NOT c.source_id` 改成 `=`，一致库也会被判 FAIL
（用例 `reconcile_detects_cache_drift` 覆盖），证明对账有判别力而不是恒绿。

## v23 真库基线读数（2026-10-07，只读）

```
user_version=23
notes=1372  tags=740
tag_links=6906 (note 6882 + tag 24)  note_links=0  notes_fts=1372
tag_aliases=14  tag_merge_log=2
integrity_check=ok  foreign_key_check=0 行
对账结果: PASS 7 / FAIL 0 / N/A 5（modern 块因 entities/edges 未建而 N/A）
```
