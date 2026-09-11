-- 002: 日记表(阶段 3)
CREATE TABLE diary_entries (
  id         INTEGER PRIMARY KEY,
  date       TEXT NOT NULL UNIQUE,
  title      TEXT,
  content    TEXT NOT NULL DEFAULT '',
  mood       TEXT,
  weather    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_diary_date ON diary_entries(date);
