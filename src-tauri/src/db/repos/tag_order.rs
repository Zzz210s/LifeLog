//! 「按标签轴排序」的树序键与 SQL 片段(排序后端专用,不引新依赖)。
//! 树序键 = 沿父链把每级 `sort_order` 零填充 6 位后以 `/` 拼接,字符串比较即树序,
//! 与侧栏兄弟序 `(sort_order, path)` 同源(用户拖过顺序就生效)。
//! 每条标签轴排序生成一个 `axis{i}` CTE:取该轴(子树,**恒含子级**)下树序最靠前的
//! 匹配标签(`MIN`),一条笔记多值时即树序第一个。
use rusqlite::types::Value;

/// 树序键递归 CTE 主体(不含 `WITH RECURSIVE` 前缀;多条排序条件共用一份 ord)。
/// 迁后无 `kind` 列:树内实体从 `path IS NOT NULL` 且无父级起(根),沿 `parent_id` 下降。
pub const ORD_BODY: &str = "ord(id, key) AS (
  SELECT id, printf('%06d', sort_order) FROM entities WHERE path IS NOT NULL AND parent_id IS NULL
  UNION ALL
  SELECT e.id, o.key || '/' || printf('%06d', e.sort_order)
  FROM entities e JOIN ord o ON e.parent_id = o.id
)";

/// 一条标签轴排序的片段:CTE 定义 + 与 `notes` 的 LEFT JOIN + 键列名
pub struct AxisSql {
    pub cte: String,
    pub join: String,
    pub key: String,
}

/// 生成第 `index` 条标签轴排序的片段;路径按参数绑定推进 `args`(三条匿名占位符,
/// 与 `filter_predicates::tag_predicate` 同款 substr 前缀,禁 LIKE 通配符)。
/// **参数顺序 = CTE 在 SQL 文本中的出现顺序**,必须先于 `where_clause` 的参数压入。
/// 谓词只认直接挂在该子树下的标签,不含携带继承(排序轴 = 标签树序,设计 D3)。
pub fn axis_sql(index: usize, path: &str, args: &mut Vec<Value>) -> AxisSql {
    for _ in 0..3 {
        args.push(Value::Text(path.to_string()));
    }
    AxisSql {
        cte: format!(
            "axis{index}(note_id, key) AS (
               SELECT l.source_id, MIN(o.key)
               FROM edges l JOIN entities t ON t.id = l.target_id JOIN ord o ON o.id = t.id
               WHERE l.kind = 'link'
                 AND (t.path = ? OR substr(t.path, 1, length(?) + 1) = ? || '/')
               GROUP BY l.source_id
             )"
        ),
        join: format!("LEFT JOIN axis{index} ax{index} ON ax{index}.note_id = n.id"),
        key: format!("ax{index}.key"),
    }
}
