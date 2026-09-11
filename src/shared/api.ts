import { invoke } from '@tauri-apps/api/core';
import type { DiaryEntry, Note } from './types';

export const api = {
  saveQuickNote: (content: string) => invoke<Note>('save_quick_note', { content }),
  listRecentNotes: (limit = 20) => invoke<Note[]>('list_recent_notes', { limit }),
  deleteNote: (id: number) => invoke<void>('delete_note', { id }),
  saveDiary: (p: {
    date: string;
    title: string;
    content: string;
    mood: string | null;
    weather: string | null;
  }) => invoke<DiaryEntry>('save_diary', p),
  getDiary: (date: string) => invoke<DiaryEntry | null>('get_diary', { date }),
  diaryDates: (year: number, month: number) =>
    invoke<string[]>('diary_dates', { year, month }),
  hideQuickWindow: () => invoke<void>('hide_quick_window'),
  togglePin: () => invoke<boolean>('toggle_quick_pin'),
  setZoom: (zoom: number) => invoke<void>('set_quick_zoom', { zoom }),
  getSetting: (key: string) => invoke<string | null>('get_setting', { key }),
};
