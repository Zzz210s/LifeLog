import { invoke } from '@tauri-apps/api/core';
import type { Note } from './types';

export const api = {
  saveQuickNote: (content: string) => invoke<Note>('save_quick_note', { content }),
  listRecentNotes: (limit = 20) => invoke<Note[]>('list_recent_notes', { limit }),
  hideQuickWindow: () => invoke<void>('hide_quick_window'),
  togglePin: () => invoke<boolean>('toggle_quick_pin'),
  setZoom: (zoom: number) => invoke<void>('set_quick_zoom', { zoom }),
  getSetting: (key: string) => invoke<string | null>('get_setting', { key }),
};
