// เงินทั้งหมดในระบบเก็บเป็น "สตางค์" (จำนวนเต็ม) เพื่อหลีกเลี่ยงปัญหา floating point

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** แปลงเลขไทย ๐-๙ เป็นเลขอารบิก (เป็นการแปลงตัวอักษร ไม่ใช่การเดาตัวเลข) */
export function normalizeDigits(text) {
  return String(text ?? '').replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
}

/**
 * แปลงข้อความจำนวนเงินเป็นสตางค์ เช่น "1,234.5" -> 123450
 * คืนค่า null หากรูปแบบไม่ถูกต้อง หรือมีทศนิยมเกิน 2 ตำแหน่ง
 */
export function parseMoney(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return parseMoney(input.toFixed(2));
  }
  let s = normalizeDigits(input).trim().replace(/[฿\s]/g, '').replace(/บาท$/, '');
  if (s === '') return null;
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  // ยอมรับคอมมาเฉพาะเป็นตัวคั่นหลักพันที่ถูกต้อง
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{0,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return null;
  s = s.replace(/,/g, '');
  const [intPart, fracPart = ''] = s.split('.');
  const satang = Number(intPart || '0') * 100 + Number((fracPart + '00').slice(0, 2));
  if (!Number.isSafeInteger(satang)) return null;
  return negative ? -satang : satang;
}

/** แสดงสตางค์เป็นบาท ทศนิยม 2 ตำแหน่ง พร้อมคอมมา เช่น 123450 -> "1,234.50" */
export function formatMoney(satang) {
  const n = Math.round(Number(satang) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const baht = Math.floor(abs / 100);
  const st = String(abs % 100).padStart(2, '0');
  return `${sign}${baht.toLocaleString('en-US')}.${st}`;
}

/** สำหรับใส่ในช่อง input (ไม่มีคอมมา) */
export function toInputValue(satang) {
  if (satang == null || satang === '') return '';
  const n = Math.round(Number(satang));
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
