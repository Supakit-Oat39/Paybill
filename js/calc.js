// ระบบคำนวณการหารค่าใช้จ่าย — ใช้สูตรเดียวกันกับทุกรายการ (อาหาร, น้ำ, SC, VAT, ค่าส่ง ฯลฯ)
// ทุกจำนวนเงินเป็นสตางค์ (จำนวนเต็ม)

/**
 * ตรวจสอบรายการหนึ่งรายการ คืนค่า array ของข้อความผิดพลาด (ว่าง = ถูกต้อง)
 */
export function validateItem(item, members) {
  const errors = [];
  const memberIds = new Set(members.map((m) => m.id));
  if (!item.name || !String(item.name).trim()) errors.push('กรุณากรอกชื่อรายการ');
  if (!Number.isSafeInteger(item.amount) || item.amount <= 0) errors.push('ราคาต้องมากกว่า 0');
  const participants = (item.participants || []).filter((id) => memberIds.has(id));
  if (participants.length === 0) errors.push('ต้องเลือกผู้ร่วมรับผิดชอบอย่างน้อย 1 คน');
  if (participants.length !== (item.participants || []).length) errors.push('มีผู้ร่วมรับผิดชอบที่ไม่อยู่ในรายชื่อสมาชิก');
  const payers = item.payers || [];
  if (payers.length === 0) errors.push('กรุณาเลือกผู้จ่ายเงินจริง');
  for (const p of payers) {
    if (!memberIds.has(p.memberId)) errors.push('มีผู้จ่ายที่ไม่อยู่ในรายชื่อสมาชิก');
    if (!Number.isSafeInteger(p.amount) || p.amount <= 0) errors.push('ยอดที่ผู้จ่ายแต่ละคนจ่ายต้องมากกว่า 0');
  }
  if (new Set(payers.map((p) => p.memberId)).size !== payers.length) errors.push('ผู้จ่ายซ้ำกัน');
  const paidSum = payers.reduce((s, p) => s + (p.amount || 0), 0);
  if (payers.length > 0 && Number.isSafeInteger(item.amount) && paidSum !== item.amount) {
    errors.push('ยอดจ่ายรวมของผู้จ่ายต้องเท่ากับราคารายการ');
  }
  return [...new Set(errors)];
}

/**
 * หารเงินเท่ากัน โดยกระจายเศษสตางค์ให้สมาชิกที่ได้รับเศษ "น้อยที่สุดจนถึงตอนนี้" ก่อน
 * (เท่ากันให้เรียงตามลำดับสมาชิก) เพื่อไม่ให้คนเดิมรับเศษทุกรายการ
 * ผลรวมส่วนแบ่ง = amount เสมอ
 *
 * @param {number} amount สตางค์
 * @param {string[]} participantIds เรียงตามลำดับสมาชิกแล้ว
 * @param {Map<string, number>} [extraCounter] ตัวนับจำนวนครั้งที่แต่ละคนได้รับเศษ (จะถูกอัปเดต)
 * @returns {Map<string, number>}
 */
export function splitEvenly(amount, participantIds, extraCounter = new Map()) {
  const n = participantIds.length;
  const shares = new Map();
  if (n === 0) return shares;
  const base = Math.floor(amount / n);
  const remainder = amount - base * n; // 0 <= remainder < n
  participantIds.forEach((id) => shares.set(id, base));
  const order = participantIds
    .map((id, idx) => ({ id, idx, extras: extraCounter.get(id) || 0 }))
    .sort((a, b) => a.extras - b.extras || a.idx - b.idx);
  for (let i = 0; i < remainder; i++) {
    const { id } = order[i];
    shares.set(id, shares.get(id) + 1);
    extraCounter.set(id, (extraCounter.get(id) || 0) + 1);
  }
  return shares;
}

/**
 * สร้างรายการโอนเงิน ให้จำนวนธุรกรรมน้อยที่สุดเท่าที่ทำได้
 * 1) จับคู่คนที่ยอดค้างจ่าย = ยอดที่อีกคนต้องได้รับพอดีก่อน
 * 2) ที่เหลือจับคู่แบบ greedy (ยอดมากสุดกับยอดมากสุด)
 * ผลรวมยอดโอนออก = ผลรวมยอดที่ต้องได้รับ เสมอ
 *
 * @param {{id:string, net:number}[]} balances net > 0 = ต้องได้รับ, net < 0 = ต้องจ่ายเพิ่ม
 */
export function settle(balances) {
  const order = new Map(balances.map((b, i) => [b.id, i]));
  const creditors = balances.filter((b) => b.net > 0).map((b) => ({ id: b.id, left: b.net }));
  const debtors = balances.filter((b) => b.net < 0).map((b) => ({ id: b.id, left: -b.net }));
  const transfers = [];

  // ขั้นที่ 1: จับคู่ยอดเท่ากันพอดี
  for (const d of debtors) {
    const c = creditors.find((c) => c.left > 0 && c.left === d.left);
    if (c) {
      transfers.push({ from: d.id, to: c.id, amount: d.left });
      c.left = 0;
      d.left = 0;
    }
  }

  // ขั้นที่ 2: greedy
  const byLeftDesc = (a, b) => b.left - a.left || order.get(a.id) - order.get(b.id);
  for (;;) {
    const ds = debtors.filter((d) => d.left > 0).sort(byLeftDesc);
    const cs = creditors.filter((c) => c.left > 0).sort(byLeftDesc);
    if (ds.length === 0 || cs.length === 0) break;
    const d = ds[0];
    const c = cs[0];
    const amount = Math.min(d.left, c.left);
    transfers.push({ from: d.id, to: c.id, amount });
    d.left -= amount;
    c.left -= amount;
  }

  transfers.sort((a, b) => order.get(a.from) - order.get(b.from) || order.get(a.to) - order.get(b.to));
  return transfers;
}

/**
 * คำนวณสรุปทั้งหมด
 * @param {{members:{id:string,name:string}[], items:any[]}} state
 */
export function computeSummary(state) {
  const members = state.members || [];
  const items = state.items || [];
  const memberIndex = new Map(members.map((m, i) => [m.id, i]));
  const owed = new Map(members.map((m) => [m.id, 0]));
  const paid = new Map(members.map((m) => [m.id, 0]));
  const extraCounter = new Map();
  const itemShares = {};
  const invalidItems = [];
  let total = 0;

  for (const item of items) {
    const errors = validateItem(item, members);
    if (errors.length) {
      invalidItems.push({ id: item.id, name: item.name, errors });
      continue;
    }
    const participants = [...new Set(item.participants)].sort(
      (a, b) => memberIndex.get(a) - memberIndex.get(b),
    );
    const shares = splitEvenly(item.amount, participants, extraCounter);
    itemShares[item.id] = Object.fromEntries(shares);
    for (const [id, share] of shares) owed.set(id, owed.get(id) + share);
    for (const p of item.payers) paid.set(p.memberId, paid.get(p.memberId) + p.amount);
    total += item.amount;
  }

  const perMember = members.map((m) => {
    const net = paid.get(m.id) - owed.get(m.id);
    return {
      id: m.id,
      name: m.name,
      owed: owed.get(m.id),
      paid: paid.get(m.id),
      net,
      status: net > 0 ? 'receive' : net < 0 ? 'pay' : 'settled',
    };
  });

  const transfers = settle(perMember);
  const totalOwed = perMember.reduce((s, m) => s + m.owed, 0);
  const totalPaid = perMember.reduce((s, m) => s + m.paid, 0);

  return {
    total,
    memberCount: members.length,
    itemCount: items.length - invalidItems.length,
    perMember,
    transfers,
    itemShares,
    invalidItems,
    checks: {
      owedEqualsTotal: totalOwed === total,
      paidEqualsTotal: totalPaid === total,
    },
  };
}

/**
 * ข้อความสรุปสำหรับแชร์/คัดลอกไปส่งในแอปแชต
 * opts.paymentOf(memberId) -> { lines: string[], hasQr: boolean } | null  (ช่องทางรับเงิน ไม่บังคับ)
 */
export function buildSummaryText(summary, formatMoney, opts = {}) {
  const { title = 'สรุปการหารบิล', paymentOf } = opts;
  const name = new Map(summary.perMember.map((m) => [m.id, m.name]));
  const lines = [];
  lines.push(`🧾 ${title}`);
  lines.push(`ยอดรวมทั้งหมด ${formatMoney(summary.total)} บาท · สมาชิก ${summary.memberCount} คน`);
  lines.push('');
  lines.push('👤 ยอดของแต่ละคน');
  for (const m of summary.perMember) {
    const status =
      m.status === 'receive'
        ? `ต้องได้รับ ${formatMoney(m.net)}`
        : m.status === 'pay'
          ? `ต้องจ่ายเพิ่ม ${formatMoney(-m.net)}`
          : 'จ่ายครบพอดี';
    lines.push(`• ${m.name}: จ่ายทั้งหมด ${formatMoney(m.owed)} / จ่ายจริง ${formatMoney(m.paid)} → ${status}`);
  }
  lines.push('');
  lines.push('💸 รายการโอนเงิน');
  if (summary.transfers.length === 0) {
    lines.push('ไม่มีรายการที่ต้องโอน');
  } else {
    for (const t of summary.transfers) {
      lines.push(`• ${name.get(t.from)} โอนให้ ${name.get(t.to)} ${formatMoney(t.amount)} บาท`);
    }
  }
  if (paymentOf) {
    const receivers = [...new Set(summary.transfers.map((t) => t.to))];
    const blocks = [];
    for (const id of receivers) {
      const p = paymentOf(id);
      if (!p || (!p.lines.length && !p.hasQr)) continue;
      blocks.push(`• ${name.get(id)}`);
      for (const l of p.lines) blocks.push(`   ${l}`);
      if (p.hasQr) blocks.push('   มี QR Code (ส่งรูปแยก / ดูในแอป)');
    }
    if (blocks.length) {
      lines.push('');
      lines.push('🏦 ช่องทางรับเงิน');
      lines.push(...blocks);
    }
  }
  return lines.join('\n');
}
