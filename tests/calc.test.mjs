import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSummary, splitEvenly, settle, buildSummaryText, validateItem } from '../js/calc.js';
import { formatMoney, parseMoney } from '../js/money.js';

const B = (baht) => Math.round(baht * 100); // บาท -> สตางค์ (ใช้เฉพาะใน test)
const M = [
  { id: 'mik', name: 'มิก' },
  { id: 'oat', name: 'โอ๊ต' },
  { id: 'ui', name: 'อุ๋ย' },
  { id: 'muk', name: 'มุก' },
];
const ALL = M.map((m) => m.id);
const item = (id, amount, participants, payers) => ({ id, name: id, amount, participants, payers });
const byId = (summary) => Object.fromEntries(summary.perMember.map((m) => [m.id, m]));

test('หัวข้อ 3: Test Case หลัก (มิก โอ๊ต อุ๋ย มุก)', () => {
  const state = {
    members: M,
    items: [
      item('บิลแรก', B(610), ALL, [{ memberId: 'oat', amount: B(610) }]),
      item('บิลสอง', B(2582), ALL, [{ memberId: 'mik', amount: B(2582) }]),
      item('บิลสาม', B(450), ['mik', 'ui', 'oat'], [{ memberId: 'mik', amount: B(450) }]),
    ],
  };
  const s = computeSummary(state);
  const p = byId(s);

  assert.equal(s.total, B(3642), 'ยอดรวม 3,642');
  assert.equal(s.memberCount, 4);

  // ส่วนแบ่งต่อรายการ
  assert.deepEqual(Object.values(s.itemShares['บิลแรก']), [15250, 15250, 15250, 15250]);
  assert.deepEqual(Object.values(s.itemShares['บิลสอง']), [64550, 64550, 64550, 64550]);
  assert.deepEqual(Object.values(s.itemShares['บิลสาม']), [15000, 15000, 15000]);

  // ยอดจ่ายจริง
  assert.equal(p.mik.paid, B(3032));
  assert.equal(p.oat.paid, B(610));
  assert.equal(p.ui.paid, 0);
  assert.equal(p.muk.paid, 0);

  // ยอดรับผิดชอบ
  assert.equal(p.mik.owed, B(948));
  assert.equal(p.oat.owed, B(948));
  assert.equal(p.ui.owed, B(948));
  assert.equal(p.muk.owed, B(798));

  // ยอดสุทธิ
  assert.equal(p.mik.net, B(2084));
  assert.equal(p.mik.status, 'receive');
  assert.equal(p.oat.net, -B(338));
  assert.equal(p.oat.status, 'pay');
  assert.equal(p.ui.net, -B(948));
  assert.equal(p.muk.net, -B(798));

  // การโอน: ทุกคนโอนให้มิกโดยตรง 3 รายการ
  assert.deepEqual(s.transfers, [
    { from: 'oat', to: 'mik', amount: B(338) },
    { from: 'ui', to: 'mik', amount: B(948) },
    { from: 'muk', to: 'mik', amount: B(798) },
  ]);
  const received = s.transfers.filter((t) => t.to === 'mik').reduce((a, t) => a + t.amount, 0);
  assert.equal(received, B(2084), 'มิกได้รับคืนรวม 2,084');

  assert.equal(p.mik.owed + p.oat.owed + p.ui.owed + p.muk.owed, s.total);
  assert.ok(s.checks.owedEqualsTotal && s.checks.paidEqualsTotal);
  assert.equal(formatMoney(p.mik.net), '2,084.00');
});

test('หัวข้อ 2: ตัวอย่างการหาร อาหาร/น้ำ/SC/VAT ใช้สูตรเดียวกัน', () => {
  const state = {
    members: M,
    items: [
      item('food', B(1000), ['mik', 'oat'], [{ memberId: 'mik', amount: B(1000) }]),
      item('water', B(200), ALL, [{ memberId: 'mik', amount: B(200) }]),
      item('sc', B(400), ALL, [{ memberId: 'mik', amount: B(400) }]),
      item('vat', B(300), ALL, [{ memberId: 'mik', amount: B(300) }]),
    ],
  };
  const s = computeSummary(state);
  const p = byId(s);
  assert.equal(s.itemShares.food.mik, B(500));
  assert.equal(s.itemShares.water.ui, B(50));
  assert.equal(s.itemShares.sc.muk, B(100));
  assert.equal(s.itemShares.vat.oat, B(75));
  assert.equal(p.mik.owed, B(725));
  assert.equal(p.oat.owed, B(725));
  assert.equal(p.ui.owed, B(225));
  assert.equal(p.muk.owed, B(225));
  assert.equal(s.total, B(1900));
});

test('เศษสตางค์: 100 บาท / 3 คน กระจายเศษ ผลรวมเท่ากับราคาพอดี', () => {
  const shares = splitEvenly(10000, ['a', 'b', 'c']);
  assert.deepEqual([...shares.values()], [3334, 3333, 3333]);
  assert.equal([...shares.values()].reduce((a, b) => a + b), 10000);
});

test('เศษสตางค์: 0.05 บาท / 3 คน', () => {
  const shares = splitEvenly(5, ['a', 'b', 'c']);
  assert.deepEqual([...shares.values()], [2, 2, 1]);
});

test('เศษสตางค์: ราคาน้อยกว่าจำนวนคน (0.02 บาท / 4 คน)', () => {
  const shares = splitEvenly(2, ['a', 'b', 'c', 'd']);
  assert.deepEqual([...shares.values()], [1, 1, 0, 0]);
});

test('เศษสตางค์กระจายอย่างเป็นธรรมข้ามหลายรายการ (ไม่ตกที่คนแรกตลอด)', () => {
  const members = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ];
  const items = [1, 2, 3].map((n) => item(`x${n}`, 10000, ['a', 'b', 'c'], [{ memberId: 'a', amount: 10000 }]));
  const s = computeSummary({ members, items });
  const owed = s.perMember.map((m) => m.owed);
  assert.deepEqual(owed, [10000, 10000, 10000], 'สามรายการ ๆ ละ 100/3 -> ทุกคนได้เศษคนละ 1 ครั้ง');
  assert.equal(owed.reduce((a, b) => a + b), s.total);
});

test('เศษสตางค์: ยอดรวมส่วนแบ่ง = ยอดรวมรายการเสมอ (สุ่ม 500 กรณี)', () => {
  let seed = 42;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let round = 0; round < 500; round++) {
    const members = Array.from({ length: 2 + rnd(7) }, (_, i) => ({ id: `m${i}`, name: `M${i}` }));
    const items = Array.from({ length: 1 + rnd(8) }, (_, i) => {
      const amount = 1 + rnd(500000);
      const participants = members.filter(() => rnd(2)).map((m) => m.id);
      if (participants.length === 0) participants.push(members[0].id);
      const payer1 = members[rnd(members.length)].id;
      const payer2 = members[rnd(members.length)].id;
      const split = payer1 !== payer2 && amount > 1 ? 1 + rnd(amount - 1) : amount;
      const payers =
        split === amount
          ? [{ memberId: payer1, amount }]
          : [
              { memberId: payer1, amount: split },
              { memberId: payer2, amount: amount - split },
            ];
      return item(`i${i}`, amount, participants, payers);
    });
    const s = computeSummary({ members, items });
    assert.equal(s.invalidItems.length, 0);
    assert.ok(s.checks.owedEqualsTotal, 'owed == total');
    assert.ok(s.checks.paidEqualsTotal, 'paid == total');
    for (const it of items) {
      const sum = Object.values(s.itemShares[it.id]).reduce((a, b) => a + b, 0);
      assert.equal(sum, it.amount);
      const vals = Object.values(s.itemShares[it.id]);
      assert.ok(Math.max(...vals) - Math.min(...vals) <= 1, 'ส่วนแบ่งต่างกันไม่เกิน 1 สตางค์');
    }
    // ผลรวมยอดโอนต้องเท่ากับยอดที่ต้องได้รับ และหลังโอนทุกคนเป็นศูนย์
    const after = new Map(s.perMember.map((m) => [m.id, m.net]));
    for (const t of s.transfers) {
      assert.ok(t.amount > 0);
      after.set(t.from, after.get(t.from) + t.amount);
      after.set(t.to, after.get(t.to) - t.amount);
    }
    for (const v of after.values()) assert.equal(v, 0);
    const nonZero = s.perMember.filter((m) => m.net !== 0).length;
    assert.ok(s.transfers.length <= Math.max(0, nonZero - 1), 'จำนวนการโอนไม่เกิน (คนที่มียอดค้าง - 1)');
  }
});

test('ผู้จ่ายหลายคนในรายการเดียว', () => {
  const state = {
    members: M,
    items: [
      item('dinner', B(1200), ALL, [
        { memberId: 'mik', amount: B(700) },
        { memberId: 'oat', amount: B(500) },
      ]),
    ],
  };
  const s = computeSummary(state);
  const p = byId(s);
  assert.equal(p.mik.net, B(400));
  assert.equal(p.oat.net, B(200));
  assert.equal(p.ui.net, -B(300));
  assert.equal(p.muk.net, -B(300));
  const total = s.transfers.reduce((a, t) => a + t.amount, 0);
  assert.equal(total, B(600));
});

test('settle: จับคู่ยอดเท่ากันพอดีก่อน เพื่อลดจำนวนการโอน', () => {
  const t = settle([
    { id: 'a', net: 500 },
    { id: 'b', net: 300 },
    { id: 'c', net: -300 },
    { id: 'd', net: -500 },
  ]);
  assert.equal(t.length, 2);
  assert.deepEqual(t, [
    { from: 'c', to: 'b', amount: 300 },
    { from: 'd', to: 'a', amount: 500 },
  ]);
});

test('ไม่มีใครค้างจ่าย -> ไม่มีรายการโอน และสถานะ "จ่ายครบพอดี"', () => {
  const s = computeSummary({
    members: M.slice(0, 2),
    items: [
      item('a', 100, ['mik'], [{ memberId: 'mik', amount: 100 }]),
      item('b', 100, ['oat'], [{ memberId: 'oat', amount: 100 }]),
    ],
  });
  assert.equal(s.transfers.length, 0);
  assert.ok(s.perMember.every((m) => m.status === 'settled'));
});

test('validateItem: ต้องมีผู้ร่วมรับผิดชอบ ≥ 1, ยอดผู้จ่ายรวม = ราคา', () => {
  assert.ok(validateItem(item('x', 100, [], [{ memberId: 'mik', amount: 100 }]), M).some((e) => e.includes('อย่างน้อย 1')));
  assert.ok(
    validateItem(item('x', 100, ['mik'], [{ memberId: 'mik', amount: 60 }, { memberId: 'oat', amount: 30 }]), M).some((e) =>
      e.includes('เท่ากับราคา'),
    ),
  );
  assert.ok(validateItem(item('x', 0, ['mik'], [{ memberId: 'mik', amount: 0 }]), M).length > 0);
  assert.ok(validateItem(item('x', 100, ['mik'], []), M).some((e) => e.includes('ผู้จ่าย')));
  assert.deepEqual(validateItem(item('x', 100, ['mik'], [{ memberId: 'oat', amount: 100 }]), M), []);
});

test('รายการที่ข้อมูลไม่ถูกต้องจะไม่ถูกนำมาคำนวณ และถูกรายงาน', () => {
  const s = computeSummary({ members: M, items: [item('bad', 100, ['ghost'], [{ memberId: 'mik', amount: 100 }])] });
  assert.equal(s.total, 0);
  assert.equal(s.invalidItems.length, 1);
});

test('ข้อความสรุปสำหรับ LINE', () => {
  const s = computeSummary({
    members: M,
    items: [
      item('บิลแรก', B(610), ALL, [{ memberId: 'oat', amount: B(610) }]),
      item('บิลสอง', B(2582), ALL, [{ memberId: 'mik', amount: B(2582) }]),
      item('บิลสาม', B(450), ['mik', 'ui', 'oat'], [{ memberId: 'mik', amount: B(450) }]),
    ],
  });
  const text = buildSummaryText(s, formatMoney);
  assert.match(text, /ยอดรวมทั้งหมด 3,642\.00 บาท/);
  assert.match(text, /โอ๊ต โอนให้ มิก 338\.00 บาท/);
  assert.match(text, /อุ๋ย โอนให้ มิก 948\.00 บาท/);
  assert.match(text, /มุก โอนให้ มิก 798\.00 บาท/);
  assert.match(text, /มิก: จ่ายทั้งหมด 948\.00 \/ จ่ายจริง 3,032\.00 → ต้องได้รับ 2,084\.00/);
});

test('money: parse/format', () => {
  assert.equal(parseMoney('1,234.5'), 123450);
  assert.equal(parseMoney('152.50'), 15250);
  assert.equal(parseMoney('๖๑๐'), 61000);
  assert.equal(parseMoney('0.1'), 10);
  assert.equal(parseMoney('.5'), 50);
  assert.equal(parseMoney('12.345'), null);
  assert.equal(parseMoney('1,23'), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney(0.1 + 0.2), 30);
  assert.equal(formatMoney(364200), '3,642.00');
  assert.equal(formatMoney(-33800), '-338.00');
  assert.equal(formatMoney(5), '0.05');
});
