// การจัดการข้อมูล (pure functions) — ทุกฟังก์ชันคืน state ใหม่ ไม่แก้ state เดิม
import { validateItem } from './calc.js';
import { normalizePayment } from './payment.js';

export const SCHEMA_VERSION = 1;
export const APP_ID = 'paybill-bill-splitter';

export function createEmptyState() {
  return { version: SCHEMA_VERSION, members: [], items: [], updatedAt: null };
}

let counter = 0;
export function uid(prefix = 'id') {
  counter += 1;
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

const touch = (state) => ({ ...state, updatedAt: new Date().toISOString() });
const normName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const sameName = (a, b) => normName(a).toLocaleLowerCase() === normName(b).toLocaleLowerCase();

/** แยกชื่อจากข้อความ รองรับคั่นด้วยคอมมา ขึ้นบรรทัดใหม่ หรือ "/" */
export function splitNames(text) {
  return String(text ?? '')
    .split(/[,\n/、，]+/)
    .map(normName)
    .filter(Boolean);
}

/**
 * เพิ่มสมาชิกได้หลายคนพร้อมกัน
 * @returns {{state, added: object[], skipped: {name:string, reason:string}[]}}
 */
export function addMembers(state, namesText) {
  const names = Array.isArray(namesText) ? namesText.map(normName).filter(Boolean) : splitNames(namesText);
  const members = [...state.members];
  const added = [];
  const skipped = [];
  for (const name of names) {
    if (name.length > 40) {
      skipped.push({ name, reason: 'ชื่อยาวเกิน 40 ตัวอักษร' });
    } else if (members.some((m) => sameName(m.name, name))) {
      skipped.push({ name, reason: 'มีชื่อนี้อยู่แล้ว' });
    } else {
      const m = { id: uid('m'), name };
      members.push(m);
      added.push(m);
    }
  }
  return { state: added.length ? touch({ ...state, members }) : state, added, skipped };
}

/**
 * เพิ่มสมาชิกทีละคน (ชื่อมีคอมมาได้ ไม่ถูกแยก) พร้อมช่องทางรับเงิน (ไม่บังคับ)
 * @throws Error ถ้าชื่อว่าง/ยาวเกิน/ซ้ำ หรือข้อมูลรับเงินไม่ถูกต้อง
 */
export function addMember(state, rawName, rawPayment) {
  const name = normName(rawName);
  if (!name) throw new Error('กรุณากรอกชื่อสมาชิก');
  if (name.length > 40) throw new Error('ชื่อยาวเกิน 40 ตัวอักษร');
  if (state.members.some((m) => sameName(m.name, name))) throw new Error('มีชื่อนี้อยู่แล้ว');
  const { payment, errors } = normalizePayment(rawPayment);
  if (errors.length) throw new Error(errors.join('\n'));
  const member = { id: uid('m'), name, ...(payment ? { payment } : {}) };
  return { state: touch({ ...state, members: [...state.members, member] }), member };
}

/** แก้ไขชื่อ และ/หรือ ช่องทางรับเงิน (ส่ง rawPayment = undefined ถ้าไม่แก้) */
export function updateMember(state, memberId, rawName, rawPayment) {
  let next = renameMember(state, memberId, rawName);
  if (rawPayment === undefined) return next;
  const { payment, errors } = normalizePayment(rawPayment);
  if (errors.length) throw new Error(errors.join('\n'));
  return touch({
    ...next,
    members: next.members.map((m) => {
      if (m.id !== memberId) return m;
      const { payment: _old, ...rest } = m;
      return payment ? { ...rest, payment } : rest;
    }),
  });
}

export function renameMember(state, memberId, newName) {
  const name = normName(newName);
  if (!name) throw new Error('กรุณากรอกชื่อสมาชิก');
  if (name.length > 40) throw new Error('ชื่อยาวเกิน 40 ตัวอักษร');
  if (!state.members.some((m) => m.id === memberId)) throw new Error('ไม่พบสมาชิก');
  if (state.members.some((m) => m.id !== memberId && sameName(m.name, name))) {
    throw new Error('มีชื่อนี้อยู่แล้ว');
  }
  return touch({ ...state, members: state.members.map((m) => (m.id === memberId ? { ...m, name } : m)) });
}

/** ตรวจว่าสมาชิกถูกใช้อยู่ในรายการใดบ้าง */
export function getMemberUsage(state, memberId) {
  const participantIn = state.items.filter((it) => it.participants.includes(memberId));
  const payerIn = state.items.filter((it) => it.payers.some((p) => p.memberId === memberId));
  const soleParticipantIn = participantIn.filter((it) => it.participants.length === 1);
  const involved = state.items.filter((it) => participantIn.includes(it) || payerIn.includes(it));
  return { participantIn, payerIn, soleParticipantIn, involved, isUsed: involved.length > 0 };
}

/**
 * ลบสมาชิก
 * options.strategy:
 *  - 'detach'      เอาสมาชิกออกจากรายการที่เกี่ยวข้อง
 *                  (รายการที่เหลือผู้ร่วมรับผิดชอบ 0 คนจะถูกลบ,
 *                   ยอดที่สมาชิกคนนี้เคยจ่ายจะย้ายไปให้ options.transferPaymentsTo)
 *  - 'deleteItems' ลบทุกรายการที่สมาชิกคนนี้เกี่ยวข้อง
 * ถ้าสมาชิกไม่ถูกใช้ในรายการใด ไม่ต้องส่ง strategy
 */
export function removeMember(state, memberId, options = {}) {
  const usage = getMemberUsage(state, memberId);
  if (!state.members.some((m) => m.id === memberId)) throw new Error('ไม่พบสมาชิก');
  const members = state.members.filter((m) => m.id !== memberId);
  let items = state.items;
  const removedItems = [];

  if (usage.isUsed) {
    if (options.strategy === 'deleteItems') {
      items = items.filter((it) => {
        const hit = usage.involved.includes(it);
        if (hit) removedItems.push(it);
        return !hit;
      });
    } else if (options.strategy === 'detach') {
      const target = options.transferPaymentsTo;
      if (usage.payerIn.length > 0) {
        if (!target || target === memberId || !members.some((m) => m.id === target)) {
          throw new Error('กรุณาเลือกสมาชิกที่จะรับยอดที่จ่ายไปแล้วแทน');
        }
      }
      items = [];
      for (const it of state.items) {
        const participants = it.participants.filter((id) => id !== memberId);
        if (participants.length === 0) {
          removedItems.push(it);
          continue;
        }
        let payers = it.payers;
        const mine = payers.find((p) => p.memberId === memberId);
        if (mine) {
          payers = payers.filter((p) => p.memberId !== memberId);
          const existing = payers.find((p) => p.memberId === target);
          payers = existing
            ? payers.map((p) => (p.memberId === target ? { ...p, amount: p.amount + mine.amount } : p))
            : [...payers, { memberId: target, amount: mine.amount }];
        }
        items.push({ ...it, participants, payers });
      }
    } else {
      throw new Error('สมาชิกนี้ถูกใช้อยู่ในรายการ กรุณาเลือกวิธีจัดการก่อนลบ');
    }
  }
  return { state: touch({ ...state, members, items }), removedItems };
}

/** ทำความสะอาดข้อมูลรายการก่อนบันทึก */
function cleanItem(raw) {
  return {
    id: raw.id || uid('i'),
    name: normName(raw.name),
    amount: raw.amount,
    participants: [...new Set(raw.participants || [])],
    payers: (raw.payers || [])
      .filter((p) => p && p.memberId && p.amount !== 0)
      .map((p) => ({ memberId: p.memberId, amount: p.amount })),
    source: raw.source || 'manual',
    kind: raw.kind || 'item',
  };
}

/** เพิ่มหรือแก้ไขรายการ (ตรวจสอบความถูกต้องก่อน) */
export function upsertItem(state, rawItem) {
  const item = cleanItem(rawItem);
  const errors = validateItem(item, state.members);
  if (errors.length) {
    const err = new Error(errors.join('\n'));
    err.errors = errors;
    throw err;
  }
  const exists = state.items.some((it) => it.id === item.id);
  const items = exists ? state.items.map((it) => (it.id === item.id ? item : it)) : [...state.items, item];
  return { state: touch({ ...state, items }), item };
}

/** เพิ่มหลายรายการพร้อมกัน — ถ้ารายการใดไม่ถูกต้องจะไม่เพิ่มเลยสักรายการ */
export function addItems(state, rawItems) {
  let next = state;
  const added = [];
  rawItems.forEach((raw, idx) => {
    try {
      const r = upsertItem(next, { ...raw, id: undefined });
      next = r.state;
      added.push(r.item);
    } catch (e) {
      const err = new Error(`แถวที่ ${idx + 1} (${raw.name || 'ไม่มีชื่อ'}): ${e.message}`);
      err.rowIndex = idx;
      throw err;
    }
  });
  return { state: next, added };
}

export function removeItem(state, itemId) {
  return touch({ ...state, items: state.items.filter((it) => it.id !== itemId) });
}

/** ล้างสมาชิกทั้งหมด — รายการทั้งหมดถูกล้างด้วย เพราะทุกรายการอ้างถึงสมาชิก */
export function clearMembers(state) {
  return touch({ ...state, members: [], items: [] });
}

/** ล้างรายการค่าใช้จ่ายทั้งหมด (สมาชิกและช่องทางรับเงินยังอยู่) */
export function clearItems(state) {
  return touch({ ...state, items: [] });
}

/** ล้างช่องทางรับเงินของทุกคน (สมาชิกและรายการยังอยู่) */
export function clearPayments(state) {
  return touch({ ...state, members: state.members.map(({ payment: _p, ...m }) => m) });
}

export function clearAll() {
  return touch(createEmptyState());
}

// ---------- สำรอง / กู้คืนข้อมูล ----------

export function exportData(state) {
  return JSON.stringify(
    {
      app: APP_ID,
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: { members: state.members, items: state.items },
    },
    null,
    2,
  );
}

/**
 * นำเข้าข้อมูลจาก JSON (ตรวจสอบโครงสร้างอย่างเข้มงวด)
 * @returns {{state, warnings: string[]}}
 */
export function importData(jsonText) {
  let parsed;
  try {
    parsed = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
  } catch {
    throw new Error('ไฟล์ไม่ใช่ JSON ที่ถูกต้อง');
  }
  const data = parsed && parsed.app === APP_ID ? parsed.data : parsed;
  if (!data || !Array.isArray(data.members) || !Array.isArray(data.items)) {
    throw new Error('ไฟล์ไม่ใช่ข้อมูลสำรองของ Bill Splitter');
  }
  const warnings = [];
  const members = [];
  for (const m of data.members) {
    const name = normName(m && m.name);
    if (!m || typeof m.id !== 'string' || !name) throw new Error('ข้อมูลสมาชิกในไฟล์ไม่ถูกต้อง');
    if (members.some((x) => x.id === m.id)) throw new Error('พบรหัสสมาชิกซ้ำในไฟล์');
    const member = { id: m.id, name };
    if (m.payment) {
      const { payment, errors } = normalizePayment(m.payment);
      if (errors.length) warnings.push(`ข้อมูลรับเงินของ "${name}" ไม่ถูกต้อง จึงไม่นำเข้า: ${errors.join(', ')}`);
      if (payment && !errors.length) member.payment = payment;
    }
    members.push(member);
  }
  let state = { ...createEmptyState(), members };
  for (const raw of data.items) {
    if (!raw || typeof raw !== 'object') throw new Error('ข้อมูลรายการในไฟล์ไม่ถูกต้อง');
    const item = cleanItem({
      ...raw,
      amount: raw.amount,
      participants: Array.isArray(raw.participants) ? raw.participants : [],
      payers: Array.isArray(raw.payers) ? raw.payers : [],
    });
    const errors = validateItem(item, members);
    if (errors.length) {
      warnings.push(`ข้ามรายการ "${item.name || '(ไม่มีชื่อ)'}": ${errors.join(', ')}`);
      continue;
    }
    if (state.items.some((x) => x.id === item.id)) item.id = uid('i');
    state = { ...state, items: [...state.items, item] };
  }
  return { state: touch(state), warnings };
}
