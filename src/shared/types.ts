export interface Note {
  id: number;
  content: string;
  created_at: string;
  tags: string[];
}

export interface DiaryEntry {
  id: number;
  date: string;
  title: string | null;
  content: string;
  mood: string | null;
  weather: string | null;
  created_at: string;
  updated_at: string;
  tags: string[];
}
