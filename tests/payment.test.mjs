import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePayment, formatPromptPay, formatAccount, paymentTextLines } from '../js/payment.js';
import { createEmptyState, addMember, updateMember, exportData, importData, clearMembers, clearItems, clearPayments } from '../js/state.js';
import { computeSummary, buildSummaryText } from '../js/calc.js';
import { formatMoney } from '../js/money.js';

const QR = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

test('normalizePayment: ไม่กรอกอะไรเลย -> null, ไม่มี error (ไม่บังคับ)', () => {
  assert.deepEqual(normalizePayment({ promptpay: '', bank: '', account: '' }), { payment: null, errors: [] });
  assert.deepEqual(normalizePayment(undefined), { payment: null, errors: [] });
});

test('normalizePayment: พร้อมเพย์ เบอร์มือถือ/บัตรประชาชน และรูปแบบที่ผิด', () => {
  assert.equal(normalizePayment({ promptpay: '081-234-5678' }).payment.promptpay, '0812345678');
  assert.equal(normalizePayment({ promptpay: '1 2345 67890 12 3' }).payment.promptpay, '1234567890123');
  assert.match(normalizePayment({ promptpay: '12345' }).errors[0], /10 หลัก/);
});

test('normalizePayment: บัญชีธนาคารต้องมีทั้งธนาคารและเลขบัญชี', () => {
  assert.deepEqual(normalizePayment({ bank: 'กสิกรไทย', account: '123-4-56789-0' }).payment, { bank: 'กสิกรไทย', account: '1234567890' });
  assert.match(normalizePayment({ account: '1234567890' }).errors.join(), /เลือกธนาคาร/);
  assert.match(normalizePayment({ bank: 'กสิกรไทย' }).errors.join(), /เลขบัญชี/);
  assert.match(normalizePayment({ bank: 'กสิกรไทย', account: '123' }).errors.join(), /10–15 หลัก/);
});

test('normalizePayment: รูป QR ต้องเป็น data URL ของรูป', () => {
  assert.equal(normalizePayment({ qr: QR }).payment.qr, QR);
  assert.ok(normalizePayment({ qr: 'javascript:alert(1)' }).errors.length);
});

test('format: พร้อมเพย์ / เลขบัญชี', () => {
  assert.equal(formatPromptPay('0812345678'), '081-234-5678');
  assert.equal(formatPromptPay('1234567890123'), '1-2345-67890-12-3');
  assert.equal(formatAccount('1234567890'), '123-4-56789-0');
  assert.deepEqual(paymentTextLines({ promptpay: '0812345678', bank: 'กสิกรไทย', account: '1234567890' }), [
    'พร้อมเพย์ 081-234-5678',
    'บัญชีกสิกรไทย 123-4-56789-0',
  ]);
});

test('addMember: เพิ่มทีละคน ชื่อมีคอมมาไม่ถูกแยก, ชื่อซ้ำ/ว่างไม่ได้', () => {
  let s = createEmptyState();
  s = addMember(s, 'มิก, โอ๊ต').state;
  assert.equal(s.members.length, 1);
  assert.equal(s.members[0].name, 'มิก, โอ๊ต');
  assert.throws(() => addMember(s, ' มิก,  โอ๊ต '), /มีชื่อนี้อยู่แล้ว/);
  assert.throws(() => addMember(s, '   '), /กรุณากรอกชื่อ/);
  assert.throws(() => addMember(s, 'มุก', { promptpay: '99' }), /พร้อมเพย์/);
  assert.equal(s.members.length, 1, 'ข้อมูลรับเงินผิด ต้องไม่เพิ่มสมาชิก');
});

test('updateMember: เพิ่ม/ลบช่องทางรับเงิน, export/import เก็บข้อมูลครบ', () => {
  let s = addMember(createEmptyState(), 'มิก', { promptpay: '0812345678', qr: QR }).state;
  const id = s.members[0].id;
  const back = importData(exportData(s));
  assert.deepEqual(back.state.members[0].payment, { promptpay: '0812345678', qr: QR });
  s = updateMember(s, id, 'มิกกี้', { promptpay: '', bank: '', account: '' });
  assert.equal(s.members[0].name, 'มิกกี้');
  assert.equal(s.members[0].payment, undefined);
});

test('ข้อความสรุป: แสดงช่องทางรับเงินของคนที่ต้องได้รับเงินเท่านั้น', () => {
  let s = createEmptyState();
  s = addMember(s, 'มิก', { promptpay: '0812345678', bank: 'กสิกรไทย', account: '1234567890', qr: QR }).state;
  s = addMember(s, 'โอ๊ต', { promptpay: '0899999999' }).state;
  const [mik, oat] = s.members;
  s = { ...s, items: [{ id: 'i1', name: 'อาหาร', amount: 20000, participants: [mik.id, oat.id], payers: [{ memberId: mik.id, amount: 20000 }] }] };
  const byId = new Map(s.members.map((m) => [m.id, m]));
  const text = buildSummaryText(computeSummary(s), formatMoney, {
    paymentOf: (id) => ({ lines: paymentTextLines(byId.get(id).payment), hasQr: !!byId.get(id).payment?.qr }),
  });
  assert.match(text, /โอ๊ต โอนให้ มิก 100\.00 บาท/);
  assert.match(text, /🏦 ช่องทางรับเงิน\n• มิก\n   พร้อมเพย์ 081-234-5678\n   บัญชีกสิกรไทย 123-4-56789-0\n   มี QR Code/);
  assert.doesNotMatch(text, /089-999-9999/, 'โอ๊ตเป็นคนโอน ไม่ต้องแสดงช่องทางรับเงิน');
});

test('ล้างทีละส่วน: รายการ / ช่องทางรับเงิน / สมาชิก (รายการถูกล้างด้วย)', () => {
  let s = addMember(createEmptyState(), 'มิก', { promptpay: '0812345678' }).state;
  s = addMember(s, 'โอ๊ต').state;
  const [mik, oat] = s.members;
  s = { ...s, items: [{ id: 'i1', name: 'อาหาร', amount: 100, participants: [mik.id, oat.id], payers: [{ memberId: mik.id, amount: 100 }] }] };

  const a = clearItems(s);
  assert.equal(a.items.length, 0);
  assert.equal(a.members.length, 2);
  assert.equal(a.members[0].payment.promptpay, '0812345678');

  const b = clearPayments(s);
  assert.equal(b.items.length, 1);
  assert.ok(b.members.every((m) => !('payment' in m)));

  const c = clearMembers(s);
  assert.deepEqual([c.members.length, c.items.length], [0, 0]);
  assert.equal(s.items.length, 1, 'ไม่แก้ state เดิม');
});
