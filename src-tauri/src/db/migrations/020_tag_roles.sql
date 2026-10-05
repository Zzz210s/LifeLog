-- 020: 标签角色(roles)与角色认领(tag_roles),设计 2026-10-05 §3 §4。
-- 纯加表:不动 tags 主树,不改任何 path/depth/sort_order(R5)。
-- roles 一行 = 一个角色,tag_id 指向真实标签(角色名 = 该标签路径末段,改名自动跟随);
-- tag_roles 一行 = "标签 tag_id 被角色 role_id 认领",多对多,主键天然去重(重复认领幂等)。
-- 删除被登记/被认领的标签由 ON DELETE CASCADE 清理(db::open 已开 foreign_keys=ON)。
-- 迁移**不自动登记任何角色**、**不校验历史数据**:库里已有指向 `地点轴/国籍` 的携带行,
-- 该校验只作用于新写入(设计 §4 R3 / §7 R8),历史行原样保留。
-- 幂等:CREATE TABLE/INDEX IF NOT EXISTS(与 007/015/019 同一做法),直接重放 020 是空操作;
-- 单事务由 migrate::run 保证(SQL 与 user_version 同批提交,失败整批回滚)。
CREATE TABLE IF NOT EXISTS roles (
  id         INTEGER PRIMARY KEY,
  tag_id     INTEGER NOT NULL UNIQUE REFERENCES tags(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tag_roles (
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY(tag_id, role_id)
);
-- 按角色反查"谁认领了它"要快(Task 2 筛选与标签菜单)
CREATE INDEX IF NOT EXISTS idx_tag_roles_role ON tag_roles(role_id);
