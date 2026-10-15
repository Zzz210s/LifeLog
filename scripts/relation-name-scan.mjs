#!/usr/bin/env node
/**
 * 关系语法的**存量只读扫描**(设计 §3.4 / §7.4 的验收读数;计划 T5)。
 *
 * 三件事,全部只读(`file:…?mode=ro`,绝不写库):
 *   1. 含括号的 `points.path`(真库应 = 2:md 形态 `[郴](chēn)州市` 及其子);
 *   2. 树内段名(`points.meta`,path 非空)里含**裸括号**的(应 = 0);
 *   3. 名字点文本(`lines.name_id` 指向的点的 `meta`)是否仍是合法标签路径(应全合法)。
 *
 * 谓词说明:本脚本是**独立复算**(node 不能调 Rust/TS),真源是
 * `src-tauri/src/tag_label_paren.rs` 与 `src/shared/tag-label-paren.ts`;
 * 严格名称口径复算 `src-tauri/src/tags.rs` 的 `parse_tag_path`。
 * 用法: node scripts/relation-name-scan.mjs [--db <path>]
 */
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_DB = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';

function parseArgs(argv) {
  let db = DEFAULT_DB;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') db = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('用法: node scripts/relation-name-scan.mjs [--db <path>]');
      process.exit(0);
    } else throw new Error(`未知参数: ${argv[i]}(--db / --help)`);
  }
  return { db };
}

/** 行内 md 链接记号 `[显示](备注)` 的复算:剥掉它之后若还有括号,就是裸括号 */
const MD_LINK_RE = /\[[^[\]]+\]\([^()]*\)/g;
const hasBareParen = (s) => /[()]/.test(s.replace(MD_LINK_RE, ''));

/** 名称字符(复算 Rust `is_tag_char`:`char::is_alphanumeric()` / `_` / `-`) */
const NAME_CHAR = /[\p{L}\p{N}_-]/u;

/** 单段合法性(复算 Rust `valid_segment`:`.`/`·` 只允许夹在名称字符之间) */
function validSegment(seg) {
  if (seg === '') return false;
  const chars = [...seg];
  let prevName = false;
  for (let k = 0; k < chars.length; k += 1) {
    if (NAME_CHAR.test(chars[k])) {
      prevName = true;
      continue;
    }
    const nextName = k + 1 < chars.length && NAME_CHAR.test(chars[k + 1]);
    if ((chars[k] === '.' || chars[k] === '·') && prevName && nextName) {
      prevName = false;
      continue;
    }
    return false;
  }
  return true;
}

/** 复算 Rust `parse_tag_path(...).is_some()` 且界面输入面长度上限 100 */
const validRelationName = (name) => name.split('/').every(validSegment) && [...name].length <= 100;

const { db: dbPath } = parseArgs(process.argv.slice(2));
const db = new DatabaseSync('file:' + dbPath, { readOnly: true });
const all = (sql) => db.prepare(sql).all().map((r) => ({ ...r }));

const treeMetas = all('SELECT id, meta, path FROM points WHERE path IS NOT NULL');
const parenPaths = all(
  "SELECT id, path FROM points WHERE path IS NOT NULL AND (path LIKE '%(%' OR path LIKE '%)%')"
);
const bareParenTree = treeMetas.filter((r) => hasBareParen(String(r.meta)));
// 名字点 = 出现在 `lines.name_id` 位、且**不是保留点 `子级`**(id 0,子级线用;见
// `db/repos/entities/reserved.rs::TREE_NAME_ID`)。口径与「有名线」一致(`name_id <> 0`)。
const namePoints = all(
  `SELECT DISTINCT p.id, p.meta FROM points p
    WHERE p.id <> 0 AND EXISTS(SELECT 1 FROM lines n WHERE n.name_id = p.id) ORDER BY p.id`
);
const invalidNames = namePoints.filter((r) => !validRelationName(String(r.meta)));

const out = {
  db: dbPath,
  mode: 'ro',
  user_version: db.prepare('PRAGMA user_version').get().user_version,
  points: db.prepare('SELECT COUNT(*) n FROM points').get().n,
  lines: db.prepare('SELECT COUNT(*) n FROM lines').get().n,
  named_lines: db.prepare(
    'SELECT COUNT(*) n FROM lines WHERE name_id IS NOT NULL AND name_id <> 0'
  ).get().n,
  paren_paths: parenPaths.length,
  paren_path_samples: parenPaths,
  bare_paren_tree_metas: bareParenTree,
  name_points: namePoints.map((r) => r.meta),
  invalid_relation_names: invalidNames.map((r) => r.meta),
};
out.ok = !out.bare_paren_tree_metas.length && !out.invalid_relation_names.length;
db.close();

console.log(JSON.stringify(out, null, 2));
console.error(
  `[relation-name-scan] ${dbPath}: 裸括号段名 ${out.bare_paren_tree_metas.length} / ` +
    `含括号 path ${out.paren_paths} / 非法关系名 ${out.invalid_relation_names.length}`
);
