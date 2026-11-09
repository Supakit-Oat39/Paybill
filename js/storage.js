// บันทึกข้อมูลลง LocalStorage ของเบราว์เซอร์ (เฉพาะเครื่องนี้ ไม่ซิงก์)
import { createEmptyState, importData, exportData } from './state.js';

const KEY = 'paybill:v1:data';
const PREF_KEY = 'paybill:v1:prefs';

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { state: createEmptyState(), warnings: [] };
    return importData(raw);
  } catch (e) {
    console.warn('โหลดข้อมูลไม่สำเร็จ', e);
    return { state: createEmptyState(), warnings: ['อ่านข้อมูลที่บันทึกไว้ไม่สำเร็จ เริ่มต้นใหม่'] };
  }
}

/** @returns {boolean} สำเร็จหรือไม่ */
export function saveState(state) {
  try {
    localStorage.setItem(KEY, exportData(state));
    return true;
  } catch (e) {
    console.warn('บันทึกข้อมูลไม่สำเร็จ', e);
    return false;
  }
}

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY)) || {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
