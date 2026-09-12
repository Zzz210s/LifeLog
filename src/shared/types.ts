export interface Note {
  id: number;
  content: string;
  created_at: string;
  tags: string[];
}

/** 设置页「通用」分区展示的数据库信息(只读) */
export interface DbInfo {
  path: string;
  notes: number;
}
