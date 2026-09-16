//! 表达式 AST:只表达语义结构,不含任何 SQL 细节(编译留给后续任务)。

/// 日期比较运算符
#[derive(Debug, Clone, PartialEq)]
pub enum DateOp {
    Lt,
    Le,
    Eq,
    Ge,
    Gt,
}

/// 表达式语法树
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    /// 标签;`self_only` 为真表示 `#=路径`(仅本级),否则 `#路径`(含子级)
    Tag { path: String, self_only: bool },
    /// 关键词(裸词或引号短语)
    Keyword(String),
    /// 日期比较
    Date { op: DateOp, date: String },
    /// 逻辑非
    Not(Box<Expr>),
    /// 逻辑与
    And(Box<Expr>, Box<Expr>),
    /// 逻辑或
    Or(Box<Expr>, Box<Expr>),
}
