import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyState, addMembers, renameMember, removeMember, getMemberUsage,
  upsertItem, addItems, removeItem, clearAll, exportData, importData,
} from '../js/state.js';
import { computeSummary } from '../js/calc.js';

function setup() {
  let s = createEmptyState();
  s = addMembers(s, 'มิก, โอ๊ต, อุ๋ย, มุก').state;
  const id = Object.fromEntries(s.members.map((m) => [m.name, m.id]));
  return { s, id };
}

test('เพิ่มสมาชิกหลายคนพร้อมกัน และกันชื่อซ้ำ', () => {
  let s = createEmptyState();
  const r = addMembers(s, 'มิก, โอ๊ต\nอุ๋ย / มุก');
  assert.equal(r.added.length, 4);
  assert.deepEqual(r.state.members.map((m) => m.name), ['มิก', 'โอ๊ต', 'อุ๋ย', 'มุก']);
  const r2 = addMembers(r.state, ' มิก ,  เบียร์ ');
  assert.equal(r2.added.length, 1);
  assert.equal(r2.skipped[0].reason, 'มีชื่อนี้อยู่แล้ว');
  assert.equal(r2.state.members.length, 5);
  assert.equal(addMembers(r2.state, '   ,  ').added.length, 0);
});

test('แก้ไขชื่อสมาชิก', () => {
  const { s, id } = setup();
  const s2 = renameMember(s, id['มุก'], 'มุกดา');
  assert.equal(s2.members.find((m) => m.id === id['มุก']).name, 'มุกดา');
  assert.throws(() => renameMember(s2, id['มุก'], 'มิก'), /มีชื่อนี้อยู่แล้ว/);
  assert.throws(() => renameMember(s2, id['มุก'], '  '), /กรุณากรอกชื่อ/);
});

test('ลบสมาชิกที่ไม่ถูกใช้ -> ลบได้ทันที', () => {
  const { s, id } = setup();
  const r = removeMember(s, id['มุก']);
  assert.equal(r.state.members.length, 3);
});

test('ลบสมาชิกที่ถูกใช้อยู่ โดยไม่เลือกวิธีจัดการ -> ถูกปฏิเสธ', () => {
  const { s, id } = setup();
  const s2 = upsertItem(s, {
    name: 'ข้าว', amount: 10000, participants: [id['มิก'], id['มุก']], payers: [{ memberId: id['มิก'], amount: 10000 }],
  }).state;
  assert.ok(getMemberUsage(s2, id['มุก']).isUsed);
  assert.throws(() => removeMember(s2, id['มุก']), /เลือกวิธีจัดการ/);
});

test('ลบสมาชิก แบบ "เอาออกจากรายการที่เกี่ยวข้อง" + ย้ายยอดที่จ่ายแล้ว', () => {
  const { s, id } = setup();
  let st = upsertItem(s, {
    name: 'ข้าว', amount: 10000, participants: [id['มิก'], id['มุก']], payers: [{ memberId: id['มุก'], amount: 10000 }],
  }).state;
  st = upsertItem(st, {
    name: 'ขนมของมุก', amount: 5000, participants: [id['มุก']], payers: [{ memberId: id['มิก'], amount: 5000 }],
  }).state;
  assert.throws(() => removeMember(st, id['มุก'], { strategy: 'detach' }), /เลือกสมาชิกที่จะรับยอด/);
  const r = removeMember(st, id['มุก'], { strategy: 'detach', transferPaymentsTo: id['โอ๊ต'] });
  assert.equal(r.state.members.length, 3);
  assert.equal(r.removedItems.length, 1, 'รายการที่เหลือผู้รับผิดชอบ 0 คนถูกลบ');
  assert.equal(r.state.items.length, 1);
  const rice = r.state.items[0];
  assert.deepEqual(rice.participants, [id['มิก']]);
  assert.deepEqual(rice.payers, [{ memberId: id['โอ๊ต'], amount: 10000 }]);
  const sum = computeSummary(r.state);
  assert.equal(sum.invalidItems.length, 0);
  assert.ok(sum.checks.owedEqualsTotal && sum.checks.paidEqualsTotal);
});

test('ลบสมาชิก แบบ "ลบรายการที่เกี่ยวข้องทั้งหมด"', () => {
  const { s, id } = setup();
  let st = upsertItem(s, {
    name: 'A', amount: 100, participants: [id['มิก']], payers: [{ memberId: id['มุก'], amount: 100 }],
  }).state;
  st = upsertItem(st, {
    name: 'B', amount: 100, participants: [id['มิก']], payers: [{ memberId: id['มิก'], amount: 100 }],
  }).state;
  const r = removeMember(st, id['มุก'], { strategy: 'deleteItems' });
  assert.deepEqual(r.state.items.map((i) => i.name), ['B']);
});

test('เพิ่ม/แก้ไข/ลบ รายการ และสรุปคำนวณใหม่', () => {
  const { s, id } = setup();
  const all = Object.values(id);
  const r = upsertItem(s, { name: 'ชาบู', amount: 40000, participants: all, payers: [{ memberId: id['มิก'], amount: 40000 }] });
  assert.equal(computeSummary(r.state).total, 40000);

  // แก้ไข: ราคา ผู้ร่วม และผู้จ่าย (แบ่งจ่าย 2 คน)
  const edited = upsertItem(r.state, {
    ...r.item, name: 'ชาบู (แก้)', amount: 30000, participants: [id['มิก'], id['โอ๊ต']],
    payers: [{ memberId: id['มิก'], amount: 20000 }, { memberId: id['โอ๊ต'], amount: 10000 }],
  }).state;
  assert.equal(edited.items.length, 1);
  const sum = computeSummary(edited);
  assert.equal(sum.total, 30000);
  assert.equal(sum.perMember.find((m) => m.id === id['มิก']).net, 5000);
  assert.equal(sum.perMember.find((m) => m.id === id['โอ๊ต']).net, -5000);

  assert.throws(() => upsertItem(edited, { ...r.item, participants: [] }), /อย่างน้อย 1 คน/);
  assert.throws(
    () => upsertItem(edited, { ...r.item, payers: [{ memberId: id['มิก'], amount: 100 }] }),
    /เท่ากับราคารายการ/,
  );

  const removed = removeItem(edited, r.item.id);
  assert.equal(removed.items.length, 0);
  assert.equal(computeSummary(removed).total, 0);
});

test('addItems (นำเข้าจาก OCR) เป็น all-or-nothing', () => {
  const { s, id } = setup();
  const ok = { name: 'A', amount: 100, participants: [id['มิก']], payers: [{ memberId: id['มิก'], amount: 100 }], kind: 'item' };
  const bad = { name: 'VAT', amount: 7, participants: [], payers: [{ memberId: id['มิก'], amount: 7 }], kind: 'vat' };
  assert.throws(() => addItems(s, [ok, bad]), /แถวที่ 2/);
  const r = addItems(s, [ok, { ...bad, participants: [id['มิก']] }]);
  assert.equal(r.state.items.length, 2);
  assert.equal(r.state.items[1].kind, 'vat');
});

test('ล้างข้อมูลทั้งหมด', () => {
  const { s } = setup();
  const c = clearAll(s);
  assert.equal(c.members.length, 0);
  assert.equal(c.items.length, 0);
});

test('ส่งออก/นำเข้า JSON (สำรองและกู้คืนข้อมูล)', () => {
  const { s, id } = setup();
  const st = upsertItem(s, {
    name: 'บิลแรก', amount: 61000, participants: Object.values(id), payers: [{ memberId: id['โอ๊ต'], amount: 61000 }],
  }).state;
  const json = exportData(st);
  const { state: restored, warnings } = importData(json);
  assert.deepEqual(warnings, []);
  assert.deepEqual(restored.members, st.members);
  assert.deepEqual(restored.items, st.items);
  assert.deepEqual(computeSummary(restored), computeSummary(st));

  assert.throws(() => importData('{not json'), /JSON/);
  assert.throws(() => importData('{"foo":1}'), /ไม่ใช่ข้อมูลสำรอง/);
  // รายการเสียจะถูกข้ามพร้อมคำเตือน
  const broken = JSON.parse(json);
  broken.data.items.push({ id: 'x', name: 'เสีย', amount: 100, participants: ['ghost'], payers: [] });
  const r = importData(JSON.stringify(broken));
  assert.equal(r.state.items.length, 1);
  assert.equal(r.warnings.length, 1);
});
