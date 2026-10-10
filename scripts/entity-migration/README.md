# entity-migration · 统一元数据迁移实施工具（T1.0）

统一元数据迁移（计划 `docs/superpowers/plans/2026-10-08-unify-metadata-plan.md`，设计见
`docs/superpowers/specs/2026-10-08-unify-metadata-design.md`）的实施期工具。本目录只服务迁移本身，
不属于产品代码，不随应用发布。

## 文件

| 文件 | 职责 |
|---|---|
| `snapshot.mjs` | `VACUUM INTO` 单文件快照（记忆 #1267：WAL 模式下只复制 `.db` 会丢 `-wal`，副本回落旧状态）。默认 dry-run。 |
| `reconcile.sql` | 对账**唯一真源**：spec §3.7 七条不变量 ①–⑦ + 稳定读数计数 + `integrity_check` / `foreign_key_check`。Rust 侧 `reconcile.rs` 以 `include_str!` 引用同一文件，禁止各写一份。 |
| `reconcile-lib.mjs` | 解析 `reconcile.sql` 标记块 + 只读执行（`python sqlite3`，`mode=ro`）+ 文本格式化；运行器内置 `entity_name` / `entity_key` 同口径实现。 |
| `reconcile.mjs` | 对账 CLI，逐条打印读数与 PASS/FAIL/N/A；库不可写。 |
| `reconcile.test.mjs` | `node:test` 用例：SQL 可解析且无 legacy 块、mock v27 整组 N/A、mock v28 七条全绿、逐条反例、变异自证。 |

Rust 侧同名逻辑在 `src-tauri/src/db/repos/entities/reconcile.rs`（解析/门控/断言）与
`reconcile_checks.rs`（七条命名函数 + 计数），用例 `reconcile_tests.rs`。

## 安全边界

- 真库 `C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db` **只读**（`mode=ro`）。对账与快照读源库都不写一个字节。
- 写库只发生在 `F:/0-code/_lifelog-snapshots/` 下的副本上（快照文件本身，以及后续在副本上试跑迁移）。
- `reconcile.sql` 只允许 `SELECT` / 只读 `PRAGMA`，禁止任何写语句。
- 快照目标已存在时拒绝覆盖；源库不存在时报错退出（码 2）。

## 命令序列（计划 §0.4）

```bash
cd F:/0-code/20-active/LifeLog

# 迁移前：真库只读对账（基线）+ 单文件快照
node scripts/entity-migration/reconcile.mjs
node scripts/entity-migration/snapshot.mjs --tag p28 --snapshot

# 副本试跑 028（在副本文件上跑迁移，不碰真库），随后对副本对账
node scripts/entity-migration/reconcile.mjs --db F:/0-code/_lifelog-snapshots/lifelog.db.bak-p28-<stamp>

# 七条全 PASS + 三条等价性全绿后，才停应用、对真库执行 028、重启
# 回滚：停应用 -> 用 p28 快照替换主库（含 -wal/-shm）-> 换回旧代码
```

真库执行 028 的时点是 **Task 2.5**（阶段 1+2 合并里程碑），不是副本试跑。

## 对账判据

七条不变量（见 `reconcile.sql`，逐条 0 行 = PASS）：

1. `is_cited` 与 `link` 入边一致（`is_cited = 有入 link 边`，不含 `child`；spec §3.1）。
2. `parent_id` 缓存与 `child` 入边一致。
3. `path` 缓存与「父 `path` + `/` + `entity_name(meta)`」推导一致（`path IS NOT NULL`）。
4. `depth` 缓存与 `child` 边推导深度一致（`path IS NOT NULL`）。
5. `child` 边入度 ≤ 1。
6. 同父同键唯一，**只对「自动合并作用域」断言**（`path IS NOT NULL AND is_cited = 1 AND instr(meta, char(10)) = 0`；
   计划 P0-2）；作用域外的同父同键另记计数读数 `sibling_key_out_of_scope`（只打印、不判 FAIL）。
7. id 重发完整性：`MIN(id)=1`、`MAX(id)=COUNT(*)`、`COUNT(DISTINCT id)=COUNT(*)`。

- 第 7 条是 spec §3.7-7「稳定读数」的**可判定部分**；其余读数（`path` 非空数、闭包大小、`is_cited` 数、
  `link` 数、`entities_fts` 行数、默认筛选结果数）以 `@count` 计数块呈现，与 spec §2.7 期望现场比对。
- `integrity_check` 单行 `ok` = PASS；`foreign_key_check` 0 行 = PASS。
- **七条统一要求 v28 结构（`entities.meta` / `entities.is_cited`）**：任一表/列不存在则整条打印 `N/A`，
  不报错。因此 v27 真库上七条整组 `N/A`（只有 `integrity` / `fk` 与 `entities` / `edges` / `path` 计数有读数）。
- `entity_name(meta)` / `entity_key(meta)` 由执行环境提供：Rust 侧由连接注册（`db/sql_functions.rs`，
  T1.1 落地）；`reconcile-lib.mjs` 的 python 运行器内置同口径实现（`entity_name` = 第一条非空行裁首尾空白；
  `entity_key` = 再剥行内 `#` 词元、折叠空白、ASCII 小写）。运行器对 `#` 词元按 `#[^\s#]+` 粗剥，
  不覆盖 `##` 标题 / 代码围栏等只有严格解析器才认识的写法（迁移数据无此形态）。
- 退出码：任一条 FAIL/ERR 为 1，全 PASS（N/A 不计）为 0。

## 自检

```bash
node --test scripts/entity-migration/*.test.mjs
node scripts/entity-migration/reconcile.mjs          # 真库只读，退出码 0
node scripts/entity-migration/snapshot.mjs           # dry-run，不写盘
cd src-tauri && cargo test --lib reconcile           # Rust 侧同名七条（mock v28）
```

- 变异自证（TS）：把 `reconcile.sql` ① 的 `e.is_cited <> EXISTS` 改成 `=`，一致库也判 FAIL
  （用例「变异自证」覆盖），证明对账有判别力而不是恒绿。
- 变异自证（Rust）：`each_check_detects_its_drift` 逐条制造漂移，对应那条必须命中。

## 真库只读基线读数（2026-10-08，v27）

```
user_version=27
entities=2115  entities_min_id=1  entities_max_id=1000000849  entities_distinct_id=2115
entities_path_nonnull=742  entities_path_null=1373  edges=7627  entities_fts=2115
is_cited / edges_child / edges_link / link_remark_nonnull / tree_closure / feed_default /
sibling_key_out_of_scope = N/A（v27 无 meta / is_cited 列）
integrity_check=ok  foreign_key_check=0 行
对账结果: PASS 2 / FAIL 0 / N/A 7
```

`entities_max_id=1000000849` 是阶段 1–3 的实体 id（标签带 `TAG_ID_OFFSET=1e9`），阶段 4 删净偏移后回到连号。

连号只在**没发生过合并**的库上要求（`entity_merge_log` 为空）：产品自动合并与引用优化 A3 都会删实体，
断号是常态，第 ⑦ 条于是放宽为「非空 / 唯一 / `MIN>=1`」+（无合并记录时）连号，断号处数走
`id_gaps` 计数读数并在报告里打 `INFO: 检测到 N 处断号(合并态,允许)`。
