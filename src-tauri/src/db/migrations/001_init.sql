-- 001: 核心表(阶段 2 快捷输入所需)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE tags (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT
);
CREATE TABLE tag_links (
  tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id   INTEGER NOT NULL,
  PRIMARY KEY (tag_id, target_type, target_id)
);
CREATE INDEX idx_tag_links_target ON tag_links(target_type, target_id);
CREATE TABLE notes (
  id         INTEGER PRIMARY KEY,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
