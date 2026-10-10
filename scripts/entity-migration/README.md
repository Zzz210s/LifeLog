# entity-migration · 点/线重构（v31）迁移实施工具（T1.0）

点/线重构（计划 `docs/superpowers/plans/2026-10-10-point-line-plan.md`，设计见
`docs/superpowers/specs/2026-10-10-point-line-design.md`）的实施期工具。本目录只服务迁移本身，
不属于产品代码，不随应用发布。

## 文件

| 文件 | 职责 |
|---|---|
| `snapshot.mjs` | `VACUUM INTO` 单文件快照（记忆 #1267：WAL 模式下只复制 `.db` 会丢 `-wal`，副本回落旧状态）。默认 dry-run。 |
| `reconcile.sql` | 对账**唯一真源**：spec §5.4 十条不变量 ①–⑩ + 计数读数（v30 旧结构 / v31 points/lines 两套）+ `integrity_check` / `foreign_key_check`。Rust 侧 `reconcile.rs` 以 `include_str!` 引用同一文件，禁止各写一份。 |
| `reconcile-lib.mjs` | 解析 `reconcile.sql` 标记块 + 只读执行（`python sqlite3`，`mode=ro`）+ 文本格式化；运行器内置 `entity_name` / `entity_key` 同口径实现。 |
| `reconcile.mjs` | 对账 CLI，逐条打印读数与 PASS/FAIL/N/A；库不可写。 |
| `reconcile.test.mjs` | `node:test`：SQL 可解析为十条、v30 旧库整组 N/A、计数读数、`requires` 门控。 |
| `reconcile-v31.test.mjs` | v31 点/线夹具：十条全绿、逐条反例、保留点 id=0 与合并态放宽、变异自证。 |

Rust 侧同名逻辑在 `src-tauri/src/db/repos/entities/reconcile.rs`（解析/门控/断言）与
`reconcile_checks.rs`（十条命名函数 + 计数），用例 `reconcile_tests.rs`。

## 安全边界

- 真库 `C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db` **只读**（`mode=ro`）。对账与快照读源库都不写一个字节。
- 写库只发生在 `F:/0-code/_lifelog-snapshots/` 下的副本上（快照文件本身，以及后续在副本上试跑迁移）。
- `reconcile.sql` 只允许 `SELECT` / 只读 `PRAGMA`，禁止任何写语句。
- 快照目标已存在时拒绝覆盖；源库不存在时报错退出（码 2）。

## 命令序列（计划 §10.2）

```bash
cd F:/0-code/20-active/LifeLog

# 迁移前：真库只读对账（基线）+ 单文件快照
node scripts/entity-migration/reconcile.mjs
node scripts/entity-migration/snapshot.mjs --tag p31 --snapshot

# 副本试跑 031（在副本文件上跑迁移，不碰真库），随后对副本对账
node scripts/entity-migration/reconcile.mjs --db F:/0-code/_lifelog-snapshots/lifelog.db.bak-p31-<stamp>

# 十条全 PASS + §10.3 读数逐值命中 + §10.6 三条等价性全绿后，才停应用、对真库执行 031
# 回滚：停应用 -> 用 p31 快照替换主库（含 -wal/-shm）-> 换回旧代码
```

真库执行 031 的时点是 **Task 2.5**（阶段 1+2 合并里程碑），不是副本试跑。

## 对账判据（十条，逐条 0 行 = PASS）

保留点 `子级` id = 0（spec §14 P1）；无名哨兵 `COALESCE(name_id, -1)`；`TREE` 常量 = 0；序列化名称点
靠**位置判据** `is_pure_name`（出现在某条线 `name_id` 位、且不出现在任何线两端）识别。

1. `is_cited` 与非子级线入边一致（`name_id IS NULL OR name_id <> 0`；spec §5.4-①）。
2. 缓存 `parent_id` 与子级线（`name_id = 0`）入边一致；根点两侧 `NULL`，`IS NOT` 为假 → 通过。
3. `path` 缓存与「父 `path` + `/` + `entity_name(meta)`」推导一致（`path IS NOT NULL`）。
4. `depth` 缓存与子级线推导深度一致（`path IS NOT NULL`）。
5. 子级线入度 ≤ 1。
6. 同父同键唯一，**只对自动合并作用域断言**（`path IS NOT NULL AND is_cited = 1 AND instr(meta, char(10)) = 0`）。
7. **内容点**（非纯名字点，id = 0 保留点与关系名字点天然排除）id 非空 / 唯一 / `MIN>=1`；
   连号只在 `entity_merge_log` 为空（从未合并）时要求。断号处数走 `id_gaps_points` 读数，报告打
   `INFO: 检测到 N 处断号(合并态,允许)`。
8. 纯名字点属性健全（`path`/`parent_id` 为 `NULL`、`is_cited = 0`、不在 `points_fts`）且名字引用无悬挂。
   漏挂位置判据会在这一步 FAIL，而不是上线后漂移（spec §5.2）。
9. 保留点健全：`settings.tree_line_name_id` 存在且 `CAST(value AS INTEGER) = 0`，`points.id = 0` 的
   `meta = '子级'` 且四属性为零。
10. `settings` 的 `graph_positions` 键集 / `ui.mru.notes` 值集引用 id 全部存在且非名字点。
    完全「与迁移前快照逐字相同」由 T1.5 / T2.5 对照 p31 快照完成；SQL 侧断言可机器判定的部分。

- 计数读数分两套：**v30 旧结构**（`entities` / `edges` / `is_cited` / `tree_closure` / `feed_default` 等，
  迁移前基线仍可读）与 **v31**（`points` / `lines` / `lines_tree|named|unnamed` / `pure_name_points` /
  `points_fts` / `is_cited_points` / `tree_closure_points` / `feed_default_points` 等）。缺表的那一套整组 `N/A`。
- **十条 ①–⑩ 统一要求 v31 结构（`points` / `lines` / `settings` / `points_fts`）**：任一表/列不存在则整条
  打印 `N/A`，不报错。因此 v30 真库上十条整组 `N/A`（只有 `entities` / `edges` 等旧读数与 `integrity` / `fk`）。
- `entity_name(meta)` / `entity_key(meta)` 由执行环境提供：Rust 侧由连接注册（`db/sql_functions.rs`）；
  `reconcile-lib.mjs` 的 python 运行器内置同口径实现（`entity_name` = 第一条非空行裁首尾空白；
  `entity_key` = 再剥行内 `#` 词元、折叠空白、ASCII 小写）。
- `integrity_check` 单行 `ok` = PASS；`foreign_key_check` 0 行 = PASS。
- 退出码：任一条 FAIL/ERR 为 1，全 PASS（N/A 不计）为 0。

## 自检

```bash
node --test scripts/entity-migration/*.test.mjs    # TS 侧：v30 N/A + v31 十条 + 逐条反例（勿传目录，Node 24 不认）
node scripts/entity-migration/reconcile.mjs          # 真库只读，退出码 0
node scripts/entity-migration/snapshot.mjs           # dry-run，不写盘
cd src-tauri && cargo test --lib reconcile           # Rust 侧同名十条（v31 夹具）
```

- 变异自证（TS）：把 ① 的 `p.is_cited <> EXISTS` 改成 `=`，一致库也判 FAIL
  （`reconcile-v31.test.mjs`「变异自证」覆盖），证明对账有判别力而不是恒绿。
- 变异自证（Rust）：`each_check_detects_its_drift` 逐条制造漂移，对应那条必须命中。

## 真库只读基线读数（2026-10-10，v30，HEAD 942022cf）

```
user_version=30
entities=2116  entities_min_id=1  entities_max_id=2117  entities_distinct_id=2116
entities_path_nonnull=742  entities_path_null=1374  edges=6403  entities_fts=2116
id_gaps=1  id_merge_log=3  entity_aliases=15  is_cited=654  tree_closure=742  feed_default=1374
points / lines / points_fts / is_cited_points / tree_closure_points / feed_default_points = N/A（v30 无 points 表）
integrity_check=ok  foreign_key_check=0 行
对账结果: PASS 2 / FAIL 0 / N/A 10
```

- 同一读数在 `snapshot.mjs --tag p31 --snapshot` 生成的副本上复跑，**逐值一致**（计数与十条状态全等）；
  跑前后真库 `.db` 与 `-wal` 的 sha256 / mtime 不变（`mode=ro` 未写一个字节）。
- ⑦ 的连号只在**没发生过合并**的库上要求（`entity_merge_log` 为空）：自动合并与引用优化 A3 都会删点，
  断号是常态。真库 `id_gaps=1` 且有 3 条合并记录，故断号走 `INFO` 提示而非 FAIL。
