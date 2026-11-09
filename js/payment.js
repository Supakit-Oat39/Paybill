// ช่องทางรับเงินของสมาชิก (ไม่บังคับ): พร้อมเพย์ / บัญชีธนาคาร / รูป QR

export const BANKS = [
  'กสิกรไทย',
  'ไทยพาณิชย์',
  'กรุงเทพ',
  'กรุงไทย',
  'กรุงศรีอยุธยา',
  'ทหารไทยธนชาต (ttb)',
  'ออมสิน',
  'ธ.ก.ส.',
  'อาคารสงเคราะห์ (ธอส.)',
  'ยูโอบี',
  'ซีไอเอ็มบี ไทย',
  'เกียรตินาคินภัทร',
  'แลนด์ แอนด์ เฮ้าส์',
  'ทิสโก้',
  'อิสลามแห่งประเทศไทย',
];

export const QR_MAX_LENGTH = 400_000; // ขนาด data URL สูงสุด (~300 KB) กัน LocalStorage เต็ม

const digits = (s) => String(s ?? '').replace(/\D/g, '');

/**
 * ตรวจและทำความสะอาดข้อมูลช่องทางรับเงิน
 * @returns {{payment: object|null, errors: string[]}} payment = null ถ้าไม่ได้กรอกอะไรเลย
 */
export function normalizePayment(raw = {}) {
  const errors = [];
  const out = {};

  const pp = digits(raw.promptpay);
  if (String(raw.promptpay ?? '').trim()) {
    if (/^0\d{9}$/.test(pp) || /^\d{13}$/.test(pp)) out.promptpay = pp;
    else errors.push('พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก');
  }

  const bank = String(raw.bank ?? '').trim();
  const acc = digits(raw.account);
  const accTyped = String(raw.account ?? '').trim() !== '';
  if (accTyped || bank) {
    if (!bank) errors.push('กรุณาเลือกธนาคาร');
    else if (bank.length > 40) errors.push('ชื่อธนาคารยาวเกินไป');
    if (!accTyped) errors.push('กรุณากรอกเลขบัญชีธนาคาร');
    else if (acc.length < 10 || acc.length > 15) errors.push('เลขบัญชีต้องเป็นตัวเลข 10–15 หลัก');
    if (bank && acc.length >= 10 && acc.length <= 15) {
      out.bank = bank;
      out.account = acc;
    }
  }

  if (raw.qr) {
    if (typeof raw.qr !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(raw.qr)) {
      errors.push('ไฟล์รูป QR ไม่ถูกต้อง');
    } else if (raw.qr.length > QR_MAX_LENGTH) {
      errors.push('รูป QR มีขนาดใหญ่เกินไป');
    } else {
      out.qr = raw.qr;
    }
  }

  return { payment: Object.keys(out).length ? out : null, errors };
}

/** 0812345678 -> 081-234-5678, 13 หลัก -> 1-2345-67890-12-3 */
export function formatPromptPay(pp) {
  const d = digits(pp);
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 13) return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`;
  return d;
}

/** เลขบัญชี 10 หลัก -> 123-4-56789-0 (หลักอื่นแสดงตามเดิม) */
export function formatAccount(acc) {
  const d = digits(acc);
  if (d.length === 10) return `${d.slice(0, 3)}-${d[3]}-${d.slice(4, 9)}-${d[9]}`;
  return d;
}

/** ข้อความช่องทางรับเงิน (ไม่รวมรูป QR) */
export function paymentTextLines(payment) {
  if (!payment) return [];
  const lines = [];
  if (payment.promptpay) lines.push(`พร้อมเพย์ ${formatPromptPay(payment.promptpay)}`);
  if (payment.account) lines.push(`บัญชี${payment.bank} ${formatAccount(payment.account)}`);
  return lines;
}

export const hasPayment = (p) => !!(p && (p.promptpay || p.account || p.qr));
