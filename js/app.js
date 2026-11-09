import { formatMoney, parseMoney, toInputValue } from './money.js';
import { computeSummary, buildSummaryText, splitEvenly, validateItem } from './calc.js';
import {
  addMember, updateMember, removeMember, getMemberUsage, upsertItem, removeItem,
  clearAll, clearMembers, clearItems, clearPayments, exportData, importData,
} from './state.js';
import { loadState, saveState, loadPrefs, savePrefs } from './storage.js';
import { BANKS, QR_MAX_LENGTH, formatPromptPay, formatAccount, paymentTextLines, hasPayment } from './payment.js';

// ====================== helpers ======================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const baht = (satang) => `฿${formatMoney(satang)}`;

// พาสเทล [พื้นหลัง, ตัวอักษร] — คอนทราสต์อ่านง่าย
const AVATAR_COLORS = [
  ['#BDEBD3', '#1B6F4D'], ['#CDE7FB', '#245E8F'], ['#FFE3B3', '#8A5A00'], ['#FFD6C9', '#A2401F'],
  ['#E3DBFB', '#5B3FA8'], ['#D2F1F0', '#17706C'], ['#FBD9E8', '#9C2F62'], ['#E6EFC6', '#5A6B12'],
];
function avatarColor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name) {
  const s = String(name || '?').trim();
  const chars = [...s.replace(/^[เ-ไ]/, '')]; // ข้ามสระหน้า เ แ โ ใ ไ
  return (chars[0] || '?').toUpperCase();
}
const avatar = (m, cls = '') => {
  const [bg, fg] = avatarColor(m.id);
  return `<span class="avatar ${cls}" style="background:${bg};color:${fg}" aria-hidden="true">${esc(initials(m.name))}</span>`;
};

// ไอคอนรายการแบบอีโมจิ (เดาจากชื่อ ใช้แค่ตกแต่ง ไม่มีผลกับการคำนวณ)
const EMOJI_RULES = [
  [/service|ค่าบริการ|เซอร์วิส|\bsc\b|s\/c/i, '🛎️'],
  [/\bvat\b|ภาษี|\btax\b/i, '🧾'],
  [/ส่ง|delivery|grab|lineman|shipping|แกร็บ/i, '🛵'],
  [/เบียร์|beer|ไวน์|wine|เหล้า|cocktail|ค็อกเทล/i, '🍺'],

  [/น้ำ|water|โค้ก|coke|pepsi|soda|โซดา|juice|น้ำผลไม้|drink|เครื่องดื่ม|ice/i, '🥤'],
  [/เค้ก|cake|ขนม|dessert|ไอศกรีม|ice ?cream|บิงซู|โทสต์|toast|ของหวาน|ข้าวเหนียวมะม่วง|sticky rice/i, '🍰'],
  [/หมูกระทะ|ชาบู|shabu|สุกี้|ปิ้งย่าง|bbq|บาร์บีคิว|grill|ย่าง/i, '🍲'],
  [/ก๋วยเตี๋ยว|noodle|ราเมน|ramen|บะหมี่|ผัดไทย|pad ?thai|ยำ|ต้มยำ|tom ?yum/i, '🍜'],
  [/กาแฟ|coffee|latte|ลาเต้|americano|espresso|คาปู|ชา(?!บู|ม)|tea|โกโก้|cocoa/i, '☕'],
  [/pizza|พิซซ่า/i, '🍕'], [/burger|เบอร์เกอร์/i, '🍔'], [/sushi|ซูชิ|ข้าวปั้น/i, '🍣'],
  [/ข้าว|rice|กะเพรา|ผัด|fried|curry|แกง/i, '🍛'],
  [/ไก่|chicken|หมู|pork|เนื้อ|beef|กุ้ง|shrimp|ปลา|fish|steak|สเต็ก/i, '🍗'],
  [/แท็กซี่|taxi|รถ|น้ำมัน|fuel|gas|ทางด่วน|toll|parking|ที่จอด|bts|mrt|ตั๋ว|ticket/i, '🚗'],
  [/โรงแรม|hotel|ที่พัก|airbnb|ห้องพัก|resort|รีสอร์ท/i, '🏨'],
  [/หนัง|movie|cinema|คาราโอเกะ|karaoke|เกม|game/i, '🎬'],
  [/ของขวัญ|gift|วันเกิด|birthday/i, '🎁'],
  [/ซื้อ|shop|ตลาด|market|7-?11|เซเว่น|ซุปเปอร์|super|grocery|lotus|โลตัส|big ?c/i, '🛒'],
];
function itemEmoji(name) {
  for (const [re, e] of EMOJI_RULES) if (re.test(String(name))) return e;
  return '🍽️';
}

const ICONS = {
  item: '<svg viewBox="0 0 24 24"><path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10M17 21V3c-2.2 1.2-3.5 3.6-3.5 7v3H17"/></svg>',
  service: '<svg viewBox="0 0 24 24"><path d="M4 18h16M6 18a6 6 0 0 1 12 0M12 9V7M10 7h4"/></svg>',
  vat: '<svg viewBox="0 0 24 24"><path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/></svg>',
  check: '<svg class="chip__check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20zM12 10v4M12 17v.5"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 20V9M7 14l5-5 5 5M5 4h14"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8a2 2 0 0 1 2-2h1.5l1.4-2h6.2l1.4 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.5"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 9"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/></svg>',
  users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></svg>',
  receipt: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-2.5-1.8L13 21l-2.5-1.8L8 21l-2-1.5z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
};

function inferKind(name) {
  const t = String(name).toLowerCase();
  if (/service|ค่าบริการ|เซอร์วิส|\bsc\b|s\/c/.test(t)) return 'service';
  if (/\bvat\b|ภาษี|\btax\b/.test(t)) return 'vat';
  return 'item';
}

// ====================== app state ======================
let { state, warnings: loadWarnings } = loadState();
let prefs = loadPrefs();
let summary = computeSummary(state);
let currentTab = 'bills';

function commit(next, okMsg) {
  state = next;
  summary = computeSummary(state);
  const saved = saveState(state);
  render();
  if (!saved) toast('บันทึกลงเบราว์เซอร์ไม่สำเร็จ (พื้นที่เต็มหรือโหมดส่วนตัว) กรุณาส่งออกไฟล์สำรอง', 'error');
  else if (okMsg) toast(okMsg, 'ok');
}

function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  savePrefs(prefs);
}

const memberById = (id) => state.members.find((m) => m.id === id);
const memberName = (id) => memberById(id)?.name ?? '(ไม่ทราบ)';

// ====================== toast ======================
function toast(msg, type = '') {
  const root = $('#toast-root');
  root.replaceChildren();
  const el = document.createElement('div');
  el.className = `toast ${type ? `toast--${type}` : ''}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 5000 : 2600);
}

// ====================== sheets & dialogs ======================
const stack = [];

function lockScroll() {
  document.body.classList.toggle('no-scroll', stack.length > 0);
}

/**
 * เปิด bottom sheet
 * @returns {{el:HTMLElement, body:HTMLElement, foot:HTMLElement, close:()=>void}}
 */
function openSheet({ title, body = '', foot = '', tall = false, onClose, label }) {
  const root = $('#sheet-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const el = document.createElement('section');
  el.className = `sheet ${tall ? 'sheet--tall' : ''}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', label || title);
  el.innerHTML = `
    <div class="sheet__grip" aria-hidden="true"></div>
    <div class="sheet__head">
      <h2 class="sheet__title">${esc(title)}</h2>
      <button class="icon-btn icon-btn--plain icon-btn--sm" data-close aria-label="ปิด">${ICONS.close}</button>
    </div>
    <div class="sheet__body">${body}</div>
    ${foot ? `<div class="sheet__foot">${foot}</div>` : ''}`;
  root.append(backdrop, el);
  const prevFocus = document.activeElement;
  let closed = false;
  const entry = {
    el,
    body: $('.sheet__body', el),
    foot: $('.sheet__foot', el),
    close() {
      if (closed) return;
      closed = true;
      el.classList.remove('is-open');
      backdrop.classList.remove('is-open');
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      lockScroll();
      setTimeout(() => {
        el.remove();
        backdrop.remove();
      }, 260);
      onClose && onClose();
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
    },
  };
  backdrop.addEventListener('click', () => entry.close());
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) entry.close();
  });
  stack.push(entry);
  lockScroll();
  requestAnimationFrame(() => {
    el.classList.add('is-open');
    backdrop.classList.add('is-open');
  });
  return entry;
}

/** หน้าต่างยืนยัน คืนค่า Promise<boolean> */
function confirmDialog({ title, message, confirmText = 'ยืนยัน', cancelText = 'ยกเลิก', danger = true, requireCheck }) {
  return new Promise((resolve) => {
    const root = $('#sheet-root');
    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    backdrop.style.zIndex = 60;
    const el = document.createElement('div');
    el.className = 'dialog';
    el.style.zIndex = 61;
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="dialog__icon ${danger ? '' : 'dialog__icon--info'}">${danger ? ICONS.warn : ICONS.info}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(message)}</p>
      ${requireCheck ? `<label class="radio-card" style="margin-top:12px"><input type="checkbox" data-req /><span>${esc(requireCheck)}</span></label>` : ''}
      <div class="dialog__actions">
        <button class="btn btn--outline" data-no>${esc(cancelText)}</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-yes ${requireCheck ? 'disabled' : ''}>${esc(confirmText)}</button>
      </div>`;
    root.append(backdrop, el);
    const entry = {
      el,
      close: () => finish(false),
    };
    stack.push(entry);
    lockScroll();
    function finish(v) {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      lockScroll();
      el.classList.remove('is-open');
      backdrop.classList.remove('is-open');
      setTimeout(() => {
        el.remove();
        backdrop.remove();
      }, 200);
      resolve(v);
    }
    const req = $('[data-req]', el);
    if (req) req.addEventListener('change', () => ($('[data-yes]', el).disabled = !req.checked));
    $('[data-no]', el).addEventListener('click', () => finish(false));
    $('[data-yes]', el).addEventListener('click', () => finish(true));
    backdrop.addEventListener('click', () => finish(false));
    requestAnimationFrame(() => {
      el.classList.add('is-open');
      backdrop.classList.add('is-open');
      $('[data-no]', el).focus();
    });
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) {
    e.preventDefault();
    stack[stack.length - 1].close();
  }
});

// ====================== render: bills page ======================
function shareText(itemId) {
  const shares = Object.values(summary.itemShares[itemId] || {});
  if (!shares.length) return '';
  const min = Math.min(...shares);
  const max = Math.max(...shares);
  return min === max ? `คนละ ${formatMoney(min)}` : `คนละ ${formatMoney(min)}–${formatMoney(max)}`;
}

function payerText(item) {
  if (!item.payers.length) return 'ยังไม่ระบุผู้จ่าย';
  if (item.payers.length === 1) return `${memberName(item.payers[0].memberId)} จ่าย`;
  return `${item.payers.length} คนแบ่งจ่าย`;
}

function renderBills() {
  $('#hero-total').textContent = formatMoney(summary.total);
  $('#hero-members').textContent = state.members.length;
  $('#hero-items').textContent = state.items.length;
  $('#members-count').textContent = state.members.length;
  $('#items-count').textContent = state.items.length;
  $('#storage-notice').hidden = !!prefs.noticeDismissed;

  $('#clear-members').hidden = !state.members.length;
  $('#clear-items').hidden = !state.items.length;

  const ml = $('#members-list');
  ml.innerHTML = state.members.length
    ? state.members
        .map(
          (m) =>
            `<button class="member" data-action="edit-member" data-id="${esc(m.id)}" aria-label="แก้ไขหรือลบสมาชิก ${esc(m.name)}">${avatar(m)}<span>${esc(m.name)}</span></button>`,
        )
        .join('')
    : `<div class="empty" style="width:100%"><div class="empty__emoji" aria-hidden="true">👋</div><p>ยังไม่มีสมาชิก เริ่มจากเพิ่มรายชื่อเพื่อนในกลุ่ม</p>
        <button class="btn btn--primary btn--sm" data-action="add-member">${ICONS.plus} เพิ่มสมาชิก</button></div>`;

  const invalid = new Set(summary.invalidItems.map((x) => x.id));
  const il = $('#items-list');
  il.innerHTML = state.items.length
    ? state.items
        .map((it) => {
          const kind = it.kind && it.kind !== 'item' ? it.kind : inferKind(it.name);
          return `<button class="item ${invalid.has(it.id) ? 'item--invalid' : ''}" data-action="edit-item" data-id="${esc(it.id)}">
            <span class="item__icon kind-${kind}" aria-hidden="true">${itemEmoji(it.name)}</span>
            <span class="item__body">
              <p class="item__name">${esc(it.name)}</p>
              <p class="item__meta">${it.participants.length} คน · ${shareText(it.id)}</p>
            </span>
            <span class="item__right">
              <p class="item__amount num">${formatMoney(it.amount)}</p>
              <p class="item__payer">${esc(payerText(it))}</p>
            </span>
          </button>`;
        })
        .join('')
    : `<div class="empty"><div class="empty__emoji" aria-hidden="true">🍜</div><p>ยังไม่มีรายการค่าใช้จ่าย<br/>เพิ่มรายการแรกได้เลย</p>
        <button class="btn btn--primary btn--sm" data-action="add-item">${ICONS.plus} เพิ่มรายการ</button></div>`;
}

// ====================== render: summary page ======================
const paymentOf = (id) => {
  const p = memberById(id)?.payment;
  return { lines: paymentTextLines(p), hasQr: !!p?.qr };
};
const summaryText = () => buildSummaryText(summary, formatMoney, { paymentOf });
const receiverIds = () => [...new Set(summary.transfers.map((t) => t.to))];

function paymentCardHtml() {
  const ids = receiverIds();
  if (!ids.length) return '';
  return `<section class="card" aria-labelledby="t-pay">
    <div class="card__head"><h3 class="card__title" id="t-pay">ช่องทางรับเงิน</h3>
      ${state.members.some((m) => hasPayment(m.payment)) ? `<button class="btn-clear" data-action="clear-payments" aria-label="ล้างช่องทางรับเงินทั้งหมด">${ICONS.trash}ล้าง</button>` : ''}</div>
    <div class="pay-list">
      ${ids
        .map((id) => {
          const m = memberById(id);
          const p = m.payment;
          const incoming = summary.transfers.filter((t) => t.to === id).reduce((a, t) => a + t.amount, 0);
          const head = `<div class="pay-card__head">${avatar(m)}<div><strong>${esc(m.name)}</strong><small>รอรับ ฿${formatMoney(incoming)}</small></div></div>`;
          if (!hasPayment(p)) {
            return `<div class="pay-card">${head}
              <button class="btn btn--outline btn--sm" data-action="edit-payment" data-id="${esc(id)}">${ICONS.plus} เพิ่มช่องทางรับเงิน</button></div>`;
          }
          const rows = [];
          if (p.promptpay) rows.push(['พร้อมเพย์', formatPromptPay(p.promptpay), p.promptpay]);
          if (p.account) rows.push([p.bank, formatAccount(p.account), p.account]);
          return `<div class="pay-card">${head}
            ${rows
              .map(
                ([label, shown, raw]) => `<div class="pay-row"><span><small>${esc(label)}</small><b class="num">${esc(shown)}</b></span>
                  <button class="btn btn--soft btn--sm" data-action="copy-number" data-value="${esc(raw)}" aria-label="คัดลอก ${esc(label)} ของ ${esc(m.name)}">${ICONS.copy} คัดลอก</button></div>`,
              )
              .join('')}
            ${
              p.qr
                ? `<div class="pay-qr"><img class="qr-thumb" src="${p.qr}" alt="QR Code รับเงินของ ${esc(m.name)} (แตะเพื่อขยาย)" data-zoom />
                    <button class="btn btn--soft btn--sm" data-action="save-qr" data-id="${esc(id)}">${ICONS.download} บันทึกรูป QR</button></div>`
                : ''
            }
            <button class="link pay-card__edit" data-action="edit-payment" data-id="${esc(id)}">แก้ไข</button>
          </div>`;
        })
        .join('')}
    </div>
  </section>`;
}

function dataUrlToFile(dataUrl, name) {
  const [head, b64] = dataUrl.split(',');
  const type = head.match(/data:(.*?);/)[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type });
}
const qrFileName = (m) => `QR-${m.name.replace(/[\\/:*?"<>|\s]+/g, '_')}.jpg`;

function renderSummary() {
  const root = $('#summary-content');
  if (!state.members.length) {
    root.innerHTML = `<div class="empty"><div class="empty__emoji" aria-hidden="true">📊</div><p>ยังไม่มีข้อมูลให้สรุป<br/>เพิ่มสมาชิกและรายการที่หน้า "รายการบิล" ก่อน</p>
      <button class="btn btn--primary btn--sm" data-tab-go="bills">ไปหน้ารายการบิล</button></div>`;
    return;
  }
  const s = summary;
  const name = (id) => esc(memberName(id));
  const sumOwed = s.perMember.reduce((a, m) => a + m.owed, 0);
  const sumPaid = s.perMember.reduce((a, m) => a + m.paid, 0);

  const statusLabel = (m) =>
    m.status === 'receive'
      ? `<span class="pill pill--receive">ต้องได้รับ<strong>${formatMoney(m.net)}</strong></span>`
      : m.status === 'pay'
        ? `<span class="pill pill--pay">ต้องจ่ายเพิ่ม<strong>${formatMoney(-m.net)}</strong></span>`
        : `<span class="pill pill--settled">จ่ายครบพอดี<strong>0.00</strong></span>`;

  root.innerHTML = `
    <div class="sum-hero">
      <div class="stat stat--wide"><p class="stat__label">ยอดรวมค่าใช้จ่ายทั้งหมด</p><p class="stat__value" data-testid="sum-total">฿${formatMoney(s.total)}</p></div>
      <div class="stat"><p class="stat__label">จำนวนสมาชิก</p><p class="stat__value">${s.memberCount} <small style="font-size:14px;font-weight:500">คน</small></p></div>
      <div class="stat"><p class="stat__label">จำนวนรายการ</p><p class="stat__value">${state.items.length} <small style="font-size:14px;font-weight:500">รายการ</small></p></div>
    </div>

    ${
      s.invalidItems.length
        ? `<div class="notice notice--danger">${ICONS.warn}<p>มี ${s.invalidItems.length} รายการที่ข้อมูลไม่ครบ จึงยังไม่ถูกนำมาคำนวณ: ${s.invalidItems.map((x) => esc(x.name)).join(', ')}</p></div>`
        : ''
    }
    ${
      !s.checks.owedEqualsTotal || !s.checks.paidEqualsTotal
        ? `<div class="notice notice--danger">${ICONS.warn}<p>ตรวจพบยอดรวมไม่ตรงกัน กรุณาตรวจสอบรายการ</p></div>`
        : ''
    }

    <section class="card" style="margin-top:14px" aria-labelledby="t-transfer">
      <h3 class="card__title" id="t-transfer">ใครต้องโอนให้ใคร <span class="count">${s.transfers.length}</span></h3>
      ${
        s.transfers.length
          ? `<div class="transfers" data-testid="transfers">${s.transfers
              .map((t) => {
                const from = memberById(t.from);
                const to = memberById(t.to);
                return `<div class="transfer">
                  ${avatar(from)}
                  <div class="transfer__who"><span>${name(t.from)}</span><span class="transfer__arrow">โอนให้ ${ICONS.arrow}</span><span>${name(t.to)}</span></div>
                  <span class="transfer__amount">฿${formatMoney(t.amount)}</span>
                </div>`;
              })
              .join('')}</div>`
          : `<p style="margin:0;color:var(--muted)">${state.items.length ? 'ทุกคนจ่ายครบพอดี ไม่ต้องโอนเงิน' : 'ยังไม่มีรายการค่าใช้จ่าย'}</p>`
      }
    </section>

    ${paymentCardHtml()}

    <section class="card" aria-labelledby="t-status">
      <h3 class="card__title" id="t-status">สถานะของแต่ละคน</h3>
      <div class="status-list">
        ${s.perMember
          .map(
            (m) => `<div class="status-row">${avatar(m, 'avatar--lg')}
              <div class="status-row__body"><p class="status-row__name">${esc(m.name)}</p>
              <p class="status-row__sub">จ่ายทั้งหมด ${formatMoney(m.owed)} · จ่ายจริง ${formatMoney(m.paid)}</p></div>
              ${statusLabel(m)}</div>`,
          )
          .join('')}
      </div>
    </section>

    <section class="card" aria-labelledby="t-table">
      <h3 class="card__title" id="t-table">ตารางสรุปยอด</h3>
      <div class="table-wrap">
        <table class="sum-table" data-testid="summary-table">
          <thead><tr><th>สมาชิก</th><th>จ่ายทั้งหมด</th><th>จ่ายจริง</th><th>ผลต่างสุทธิ</th></tr></thead>
          <tbody>
            ${s.perMember
              .map(
                (m) => `<tr data-member="${esc(m.name)}"><td>${esc(m.name)}</td><td>${formatMoney(m.owed)}</td><td>${formatMoney(m.paid)}</td>
                <td class="net--${m.status}">${m.net > 0 ? '+' : ''}${formatMoney(m.net)}</td></tr>`,
              )
              .join('')}
          </tbody>
          <tfoot><tr><td>รวม</td><td>${formatMoney(sumOwed)}</td><td>${formatMoney(sumPaid)}</td><td>0.00</td></tr></tfoot>
        </table>
      </div>
      <div class="legend">
        <div><span style="background:var(--receive)"></span><b>ต้องได้รับ</b> = ยอดจ่ายจริงมากกว่ายอดจ่ายทั้งหมด</div>
        <div><span style="background:var(--pay)"></span><b>ต้องจ่ายเพิ่ม</b> = ยอดจ่ายจริงน้อยกว่ายอดจ่ายทั้งหมด</div>
        <div><span style="background:var(--muted)"></span>ผลต่างสุทธิ = ยอดจ่ายจริง − ยอดจ่ายทั้งหมด</div>
      </div>
    </section>

    <div class="copy-bar">
      <button class="btn btn--primary" data-action="share-summary">${ICONS.share} แชร์สรุปผล</button>
      <button class="btn btn--soft" data-action="copy-summary" aria-label="คัดลอกสรุปผล">${ICONS.copy} คัดลอก</button>
    </div>`;
}

function render() {
  renderBills();
  renderSummary();
}

function switchTab(tab) {
  currentTab = tab;
  $$('.page').forEach((p) => (p.hidden = p.dataset.page !== tab));
  $$('.tab').forEach((t) => {
    const on = t.dataset.tab === tab;
    t.classList.toggle('is-active', on);
    if (on) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0 });
  history.replaceState(null, '', tab === 'summary' ? '#summary' : '#bills');
}

// ====================== members ======================
/** ย่อรูป QR ให้เล็กพอเก็บใน LocalStorage (ยังสแกนได้) */
async function imageToDataUrl(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('เปิดรูปนี้ไม่ได้ กรุณาใช้ไฟล์ JPG หรือ PNG'));
      el.src = url;
    });
    for (const [max, q] of [[900, 0.9], [700, 0.85], [500, 0.8]]) {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', q);
      if (data.length <= QR_MAX_LENGTH) return data;
    }
    throw new Error('รูปมีขนาดใหญ่เกินไป');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function paymentFieldsHtml(p = {}) {
  return `
    <div class="field">
      <label class="field__label" for="pay-promptpay">พร้อมเพย์ <span class="field__hint">เบอร์มือถือหรือเลขบัตรประชาชน</span></label>
      <input class="input" id="pay-promptpay" inputmode="numeric" autocomplete="off" maxlength="20" value="${esc(p.promptpay ? formatPromptPay(p.promptpay) : '')}" />
    </div>
    <div class="field">
      <label class="field__label" for="pay-bank">ธนาคาร</label>
      <select class="select" id="pay-bank">
        <option value="">— ไม่ระบุ —</option>
        ${BANKS.map((b) => `<option ${p.bank === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}
        ${p.bank && !BANKS.includes(p.bank) ? `<option selected>${esc(p.bank)}</option>` : ''}
      </select>
    </div>
    <div class="field">
      <label class="field__label" for="pay-account">เลขบัญชี</label>
      <input class="input" id="pay-account" inputmode="numeric" autocomplete="off" maxlength="20" value="${esc(p.account ? formatAccount(p.account) : '')}" />
    </div>
    <div class="field">
      <span class="field__label">รูป QR Code รับเงิน</span>
      <div class="qr-field" id="qr-field"></div>
    </div>`;
}

/** ผูก event ของช่องทางรับเงิน คืนฟังก์ชันอ่านค่า */
function bindPaymentFields(root, initial = {}) {
  let qr = initial.qr || '';
  const box = $('#qr-field', root);
  const draw = () => {
    box.innerHTML = qr
      ? `<img class="qr-thumb" src="${qr}" alt="รูป QR Code รับเงิน" data-zoom />
         <div class="qr-field__actions">
           <label class="btn btn--soft btn--sm">${ICONS.image} เปลี่ยนรูป<input type="file" accept="image/*" class="sr-only" data-qr-file data-testid="qr-file" /></label>
           <button type="button" class="btn btn--danger-soft btn--sm" data-qr-del>${ICONS.trash} ลบรูป</button>
         </div>`
      : `<label class="btn btn--outline btn--block">${ICONS.image} เลือกรูป QR จากเครื่อง<input type="file" accept="image/*" class="sr-only" data-qr-file data-testid="qr-file" /></label>`;
  };
  draw();
  box.addEventListener('change', async (e) => {
    const f = e.target.closest('[data-qr-file]')?.files?.[0];
    if (!f) return;
    try {
      qr = await imageToDataUrl(f);
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-qr-del]')) {
      qr = '';
      draw();
    }
  });
  return () => ({
    promptpay: $('#pay-promptpay', root).value,
    bank: $('#pay-bank', root).value,
    account: $('#pay-account', root).value,
    qr,
  });
}

function openAddMember() {
  const sh = openSheet({
    title: 'เพิ่มสมาชิก',
    body: `
      <form id="add-member-form" novalidate>
        <div class="field">
          <label class="field__label" for="member-name">ชื่อสมาชิก</label>
          <input class="input" id="member-name" maxlength="40" autocomplete="off" enterkeyhint="done" />
        </div>
        <div id="add-member-err"></div>
      </form>`,
    foot: `<button class="btn btn--outline" data-close>ยกเลิก</button><button class="btn btn--primary" form="add-member-form" type="submit">เพิ่มสมาชิก</button>`,
  });
  const input = $('#member-name', sh.el);
  setTimeout(() => input.focus(), 250);
  $('#add-member-form', sh.el).addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const r = addMember(state, input.value);
      sh.close();
      commit(r.state, `เพิ่ม ${r.member.name} แล้ว`);
    } catch (err) {
      $('#add-member-err', sh.el).innerHTML = `<div class="errors">${esc(err.message)}</div>`;
    }
  });
}

function openEditMember(id) {
  const m = memberById(id);
  if (!m) return;
  const usage = getMemberUsage(state, id);
  const sh = openSheet({
    title: 'แก้ไขสมาชิก',
    body: `
      <form id="edit-member-form" novalidate>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">${avatar(m, 'avatar--lg')}
          <div><strong>${esc(m.name)}</strong><br/><small style="color:var(--muted)">อยู่ใน ${usage.involved.length} รายการ</small></div></div>
        <div class="field">
          <label class="field__label" for="member-name">ชื่อสมาชิก</label>
          <input class="input" id="member-name" value="${esc(m.name)}" maxlength="40" autocomplete="off" />
        </div>
        <div id="edit-member-err"></div>
        <button type="button" class="btn btn--danger-soft btn--block" data-del>${ICONS.trash} ลบสมาชิก</button>
      </form>`,
    foot: `<button class="btn btn--outline" data-close>ยกเลิก</button><button class="btn btn--primary" form="edit-member-form" type="submit">บันทึก</button>`,
  });
  $('#edit-member-form', sh.el).addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const next = updateMember(state, id, $('#member-name', sh.el).value);
      sh.close();
      commit(next, 'บันทึกชื่อแล้ว');
    } catch (err) {
      $('#edit-member-err', sh.el).innerHTML = `<div class="errors">${esc(err.message)}</div>`;
    }
  });
  $('[data-del]', sh.el).addEventListener('click', () => {
    sh.close();
    deleteMemberFlow(id);
  });
}

/** ช่องทางรับเงิน (เปิดจากหน้าสรุปผลเท่านั้น) */
function openPaymentSheet(id) {
  const m = memberById(id);
  if (!m) return;
  const sh = openSheet({
    title: 'ช่องทางรับเงิน',
    tall: true,
    body: `
      <form id="payment-form" novalidate>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">${avatar(m, 'avatar--lg')}
          <div><strong>${esc(m.name)}</strong><br/><small style="color:var(--muted)">ไม่บังคับ · กรอกช่องทางใดช่องทางหนึ่งหรือทั้งหมดก็ได้</small></div></div>
        ${paymentFieldsHtml(m.payment)}
        <div id="payment-err"></div>
      </form>`,
    foot: `<button class="btn btn--outline" data-close>ยกเลิก</button><button class="btn btn--primary" form="payment-form" type="submit">บันทึก</button>`,
  });
  const readPayment = bindPaymentFields(sh.el, m.payment);
  $('#payment-form', sh.el).addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const next = updateMember(state, id, m.name, readPayment());
      sh.close();
      commit(next, 'บันทึกช่องทางรับเงินแล้ว');
    } catch (err) {
      $('#payment-err', sh.el).innerHTML = `<div class="errors">${esc(err.message).replace(/\n/g, '<br/>')}</div>`;
    }
  });
}

async function deleteMemberFlow(id) {
  const m = memberById(id);
  if (!m) return;
  const usage = getMemberUsage(state, id);
  if (!usage.isUsed) {
    const ok = await confirmDialog({
      title: `ลบ "${m.name}" ?`,
      message: 'สมาชิกคนนี้ยังไม่อยู่ในรายการใด ลบได้ทันที',
      confirmText: 'ลบสมาชิก',
    });
    if (ok) commit(removeMember(state, id).state, `ลบ ${m.name} แล้ว`);
    return;
  }

  const others = state.members.filter((x) => x.id !== id);
  const paidTotal = usage.payerIn.reduce((s, it) => s + it.payers.find((p) => p.memberId === id).amount, 0);
  const needTarget = usage.payerIn.length > 0;
  const canDetach = !needTarget || others.length > 0;

  const sh = openSheet({
    title: `ลบ "${m.name}"`,
    body: `
      <div class="notice notice--warn" style="margin-top:0">${ICONS.warn}<p><strong>${esc(m.name)}</strong> ถูกใช้อยู่ใน ${usage.involved.length} รายการ
        กรุณาเลือกวิธีจัดการก่อนลบ เพื่อไม่ให้ยอดคำนวณผิด</p></div>
      <ul class="affected">
        ${usage.involved
          .map((it) => {
            const tags = [];
            if (it.participants.includes(id)) tags.push('<span class="tag">ร่วมรับผิดชอบ</span>');
            const p = it.payers.find((x) => x.memberId === id);
            if (p) tags.push(`<span class="tag tag--warn">จ่ายไป ${formatMoney(p.amount)}</span>`);
            if (it.participants.length === 1 && it.participants[0] === id) tags.push('<span class="tag tag--red">รับผิดชอบคนเดียว</span>');
            return `<li><span>${esc(it.name)} ${tags.join('')}</span><span class="num">${formatMoney(it.amount)}</span></li>`;
          })
          .join('')}
      </ul>
      <label class="radio-card" ${canDetach ? '' : 'style="opacity:.5"'}>
        <input type="radio" name="del-strategy" value="detach" ${canDetach ? 'checked' : 'disabled'} />
        <span><strong>เอาออกจากรายการที่เกี่ยวข้อง</strong>
          <small>รายการยังอยู่ ส่วนแบ่งจะหารใหม่ในคนที่เหลือ
          ${usage.soleParticipantIn.length ? `<br/>⚠️ ${usage.soleParticipantIn.length} รายการที่มีเขาคนเดียวจะถูกลบ: ${usage.soleParticipantIn.map((x) => esc(x.name)).join(', ')}` : ''}</small>
          ${
            needTarget && canDetach
              ? `<div class="field" style="margin:10px 0 0"><label class="field__label" for="pay-target">ยอดที่ ${esc(m.name)} จ่ายไปแล้ว ${formatMoney(paidTotal)} บาท ให้ย้ายเป็นของ</label>
                 <select class="select" id="pay-target">${others.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></div>`
              : ''
          }
        </span>
      </label>
      <label class="radio-card">
        <input type="radio" name="del-strategy" value="deleteItems" ${canDetach ? '' : 'checked'} />
        <span><strong>ลบรายการที่เกี่ยวข้องทั้งหมด</strong><small>ลบ ${usage.involved.length} รายการด้านบนออกด้วย</small></span>
      </label>
      <div id="del-err"></div>`,
    foot: `<button class="btn btn--outline" data-close>ยกเลิกการลบ</button><button class="btn btn--danger" data-confirm>ลบสมาชิก</button>`,
  });
  $('[data-confirm]', sh.el).addEventListener('click', () => {
    const strategy = $('input[name="del-strategy"]:checked', sh.el)?.value;
    try {
      const r = removeMember(state, id, { strategy, transferPaymentsTo: $('#pay-target', sh.el)?.value });
      sh.close();
      commit(r.state, `ลบ ${m.name} แล้ว${r.removedItems.length ? ` (ลบ ${r.removedItems.length} รายการ)` : ''}`);
    } catch (err) {
      $('#del-err', sh.el).innerHTML = `<div class="errors">${esc(err.message)}</div>`;
    }
  });
}

// ====================== item form ======================
function participantsChips(selected, attr = 'data-part') {
  return state.members
    .map(
      (m) =>
        `<button type="button" class="chip" ${attr}="${esc(m.id)}" aria-pressed="${selected.has(m.id)}">${avatar(m)}${esc(m.name)}${ICONS.check}</button>`,
    )
    .join('');
}

function needMembersFirst() {
  if (state.members.length) return false;
  confirmDialog({
    title: 'ยังไม่มีสมาชิก',
    message: 'กรุณาเพิ่มสมาชิกก่อน จึงจะเลือกผู้ร่วมรับผิดชอบและผู้จ่ายได้',
    confirmText: 'เพิ่มสมาชิก',
    danger: false,
  }).then((ok) => ok && openAddMember());
  return true;
}

function openItemForm(itemId) {
  if (needMembersFirst()) return;
  const existing = itemId ? state.items.find((i) => i.id === itemId) : null;
  const defaultPayer = memberById(prefs.lastPayer) ? prefs.lastPayer : state.members[0].id;
  const draft = {
    participants: new Set(existing ? existing.participants : state.members.map((m) => m.id)),
    mode: existing && existing.payers.length > 1 ? 'multi' : 'single',
    single: existing?.payers.length === 1 ? existing.payers[0].memberId : defaultPayer,
    multi: new Map((existing?.payers || []).map((p) => [p.memberId, toInputValue(p.amount)])),
  };

  const sh = openSheet({
    title: existing ? 'แก้ไขรายการ' : 'เพิ่มรายการ',
    tall: true,
    body: `
      <form id="item-form" novalidate>
        <div class="field">
          <label class="field__label" for="item-name">ชื่อรายการ</label>
          <input class="input" id="item-name" maxlength="80" placeholder="เช่น อาหาร, เครื่องดื่ม" value="${esc(existing?.name || '')}" autocomplete="off" />
        </div>
        <div class="field">
          <label class="field__label" for="item-amount">ราคา (บาท)</label>
          <div class="input-prefix"><span>฿</span><input class="input input--money" id="item-amount" inputmode="decimal" placeholder="0.00" value="${existing ? toInputValue(existing.amount) : ''}" autocomplete="off" /></div>
        </div>
        <div class="field">
          <div class="field__label"><span>ผู้ร่วมรับผิดชอบ</span>
            <span class="chip-tools"><button type="button" class="btn btn--soft btn--sm" data-all>เลือกทั้งหมด</button><button type="button" class="btn btn--outline btn--sm" data-none>ยกเลิกทั้งหมด</button></span></div>
          <div class="chips" id="part-chips" role="group" aria-label="ผู้ร่วมรับผิดชอบ"></div>
          <div class="split-info" id="split-info" aria-live="polite"></div>
        </div>
        <div class="field">
          <div class="field__label"><span>ผู้จ่ายเงินจริง</span></div>
          <div class="segmented" role="group" aria-label="รูปแบบการจ่าย">
            <button type="button" data-mode="single">จ่ายคนเดียว</button>
            <button type="button" data-mode="multi">แบ่งกันจ่ายหลายคน</button>
          </div>
          <div id="payer-area"></div>
        </div>
        <div id="item-err"></div>
        ${existing ? `<button type="button" class="btn btn--danger-soft btn--block" data-del>${ICONS.trash} ลบรายการนี้</button>` : ''}
      </form>`,
    foot: `<button class="btn btn--outline" data-close>ยกเลิก</button><button class="btn btn--primary" form="item-form" type="submit">${existing ? 'บันทึกการแก้ไข' : 'เพิ่มรายการ'}</button>`,
  });
  const f = $('#item-form', sh.el);
  const amountInput = $('#item-amount', sh.el);
  const amountValue = () => parseMoney(amountInput.value);

  function renderParticipants() {
    $('#part-chips', sh.el).innerHTML = participantsChips(draft.participants);
    renderSplitInfo();
  }
  function renderSplitInfo() {
    const n = draft.participants.size;
    const amt = amountValue();
    const box = $('#split-info', sh.el);
    box.classList.toggle('is-empty', n === 0);
    if (n === 0) {
      box.innerHTML = '<span>ต้องเลือกผู้ร่วมรับผิดชอบอย่างน้อย 1 คน</span>';
      return;
    }
    let per = '—';
    if (amt != null && amt > 0) {
      const ids = state.members.filter((m) => draft.participants.has(m.id)).map((m) => m.id);
      const vals = [...splitEvenly(amt, ids).values()];
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      per = min === max ? `คนละ ฿${formatMoney(min)}` : `คนละ ฿${formatMoney(min)}–${formatMoney(max)} (กระจายเศษสตางค์)`;
    }
    box.innerHTML = `<span>${n} คนร่วมรับผิดชอบ</span><strong class="num">${per}</strong>`;
  }
  function renderPayers() {
    $$('[data-mode]', sh.el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === draft.mode)));
    const area = $('#payer-area', sh.el);
    if (draft.mode === 'single') {
      area.innerHTML = `<div class="chips" role="radiogroup" aria-label="ผู้จ่ายเงินจริง">${state.members
        .map(
          (m) =>
            `<button type="button" class="chip" role="radio" data-payer="${esc(m.id)}" aria-checked="${draft.single === m.id}">${avatar(m)}${esc(m.name)}${ICONS.check}</button>`,
        )
        .join('')}</div>`;
    } else {
      area.innerHTML = `<div class="payer-rows">${state.members
        .map(
          (m) => `<div class="payer-row">
            <label class="payer-row__name" for="pay-${esc(m.id)}">${avatar(m)}<span>${esc(m.name)}</span></label>
            <input class="input input--money" id="pay-${esc(m.id)}" data-pay-amount="${esc(m.id)}" inputmode="decimal" placeholder="0.00" value="${esc(draft.multi.get(m.id) || '')}" />
            <button type="button" class="btn btn--soft btn--sm" data-fill="${esc(m.id)}" title="ใส่ยอดที่เหลือ">ที่เหลือ</button>
          </div>`,
        )
        .join('')}</div><div class="pay-status" id="pay-status" aria-live="polite"></div>`;
      renderPayStatus();
    }
  }
  function multiPayers() {
    const res = [];
    let bad = false;
    for (const [id, txt] of draft.multi) {
      if (!String(txt).trim()) continue;
      const v = parseMoney(txt);
      if (v == null || v < 0) bad = true;
      else if (v > 0) res.push({ memberId: id, amount: v });
    }
    return { payers: res, bad };
  }
  function renderPayStatus() {
    const el = $('#pay-status', sh.el);
    if (!el) return;
    const amt = amountValue() || 0;
    const { payers, bad } = multiPayers();
    const sum = payers.reduce((s, p) => s + p.amount, 0);
    const diff = amt - sum;
    el.className = `pay-status ${!bad && diff === 0 && amt > 0 ? 'ok' : 'bad'}`;
    el.textContent = bad
      ? 'มีช่องที่กรอกตัวเลขไม่ถูกต้อง'
      : `จ่ายรวม ${formatMoney(sum)} จากราคา ${formatMoney(amt)} · ${diff === 0 ? 'ครบพอดี ✓' : diff > 0 ? `ขาดอีก ${formatMoney(diff)}` : `เกิน ${formatMoney(-diff)}`}`;
  }

  renderParticipants();
  renderPayers();
  if (!existing) setTimeout(() => $('#item-name', sh.el).focus(), 250);

  amountInput.addEventListener('input', () => {
    amountInput.classList.remove('is-invalid');
    renderSplitInfo();
    renderPayStatus();
  });
  f.addEventListener('input', (e) => {
    const id = e.target.dataset.payAmount;
    if (id) {
      draft.multi.set(id, e.target.value);
      renderPayStatus();
    }
  });
  f.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.part) {
      const id = t.dataset.part;
      draft.participants.has(id) ? draft.participants.delete(id) : draft.participants.add(id);
      t.setAttribute('aria-pressed', String(draft.participants.has(id)));
      renderSplitInfo();
    } else if (t.hasAttribute('data-all')) {
      draft.participants = new Set(state.members.map((m) => m.id));
      renderParticipants();
    } else if (t.hasAttribute('data-none')) {
      draft.participants = new Set();
      renderParticipants();
    } else if (t.dataset.mode) {
      if (t.dataset.mode === 'multi' && draft.mode === 'single' && draft.multi.size === 0) {
        const amt = amountValue();
        if (draft.single && amt) draft.multi.set(draft.single, toInputValue(amt));
      }
      draft.mode = t.dataset.mode;
      renderPayers();
    } else if (t.dataset.payer) {
      draft.single = t.dataset.payer;
      $$('[data-payer]', sh.el).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.payer === draft.single)));
    } else if (t.dataset.fill) {
      const id = t.dataset.fill;
      draft.multi.delete(id);
      const amt = amountValue() || 0;
      const rest = amt - multiPayers().payers.reduce((s, p) => s + p.amount, 0);
      if (rest > 0) draft.multi.set(id, toInputValue(rest));
      renderPayers();
    } else if (t.hasAttribute('data-del')) {
      confirmDialog({ title: `ลบ "${existing.name}" ?`, message: 'รายการนี้จะถูกลบและสรุปผลจะคำนวณใหม่', confirmText: 'ลบรายการ' }).then(
        (ok) => {
          if (!ok) return;
          sh.close();
          commit(removeItem(state, existing.id), 'ลบรายการแล้ว');
        },
      );
    }
  });

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#item-name', sh.el).value;
    const amount = amountValue();
    const errs = [];
    if (amount == null) {
      errs.push('กรุณากรอกราคาเป็นตัวเลข (ทศนิยมไม่เกิน 2 ตำแหน่ง)');
      amountInput.classList.add('is-invalid');
    }
    let payers = [];
    if (draft.mode === 'single') {
      if (draft.single && amount != null) payers = [{ memberId: draft.single, amount }];
    } else {
      const r = multiPayers();
      if (r.bad) errs.push('ยอดของผู้จ่ายบางคนไม่ถูกต้อง');
      payers = r.payers;
      if (!payers.length) errs.push('กรุณากรอกยอดที่ผู้จ่ายแต่ละคนจ่าย');
    }
    const raw = {
      id: existing?.id,
      name,
      amount: amount ?? NaN,
      participants: state.members.filter((m) => draft.participants.has(m.id)).map((m) => m.id),
      payers,
      kind: inferKind(name),
      source: existing?.source || 'manual',
    };
    if (!errs.length) errs.push(...validateItem(raw, state.members));
    if (errs.length) {
      $('#item-err', sh.el).innerHTML = `<div class="errors"><ul>${[...new Set(errs)].map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
      $('#item-err', sh.el).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const r = upsertItem(state, raw);
    if (draft.mode === 'single') setPref('lastPayer', draft.single);
    sh.close();
    commit(r.state, existing ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มรายการแล้ว');
  });
}

// ====================== data menu ======================
function openMenu() {
  const sh = openSheet({
    title: 'ข้อมูลและการสำรอง',
    body: `
      <div class="notice" style="margin:0 0 14px">${ICONS.info}<p>ข้อมูลเก็บใน LocalStorage ของเบราว์เซอร์และอุปกรณ์นี้เท่านั้น
        ไม่ซิงก์ไปเครื่องอื่น ถ้าล้างข้อมูลเว็บไซต์/เบราว์เซอร์ ข้อมูลจะหาย ควรส่งออกไฟล์สำรองเป็นระยะ</p></div>
      <div class="menu-list">
        <button class="menu-item" data-m="export"><span class="menu-item__icon">${ICONS.download}</span><span><strong>ส่งออกข้อมูลสำรอง (JSON)</strong><small>ดาวน์โหลดไฟล์เก็บไว้</small></span></button>
        <button class="menu-item" data-m="import"><span class="menu-item__icon">${ICONS.upload}</span><span><strong>นำเข้าไฟล์สำรอง (JSON)</strong><small>กู้คืนข้อมูล (แทนที่ข้อมูลปัจจุบัน)</small></span></button>
      </div>
      <div class="menu-danger">
        <p class="menu-danger__label">เริ่มทริปใหม่</p>
        <button class="menu-item menu-item--danger" data-m="clear"><span class="menu-item__icon">${ICONS.trash}</span><span><strong>ล้างข้อมูลทั้งหมด</strong><small>ลบสมาชิก รายการ และช่องทางรับเงินทั้งหมด</small></span></button>
      </div>`,
  });
  sh.body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-m]');
    if (!t) return;
    sh.close();
    if (t.dataset.m === 'export') doExport();
    if (t.dataset.m === 'import') $('#import-file').click();
    if (t.dataset.m === 'clear') doClearAll();
  });
}

function doExport() {
  const blob = new Blob([exportData(state)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  a.href = URL.createObjectURL(blob);
  a.download = `paybill-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('ส่งออกไฟล์สำรองแล้ว', 'ok');
}

async function doImportFile(file) {
  try {
    const text = await file.text();
    const r = importData(text);
    const ok = await confirmDialog({
      title: 'กู้คืนข้อมูลจากไฟล์?',
      message: `ไฟล์มีสมาชิก ${r.state.members.length} คน และ ${r.state.items.length} รายการ\nข้อมูลปัจจุบัน (${state.members.length} คน, ${state.items.length} รายการ) จะถูกแทนที่`,
      confirmText: 'แทนที่ข้อมูล',
    });
    if (!ok) return;
    commit(r.state, 'กู้คืนข้อมูลแล้ว');
    if (r.warnings.length) toast(r.warnings.join('\n'), 'error');
  } catch (err) {
    toast(err.message || 'นำเข้าไฟล์ไม่สำเร็จ', 'error');
  }
}

async function doClearMembers() {
  const n = state.members.length;
  const k = state.items.length;
  const ok = await confirmDialog({
    title: 'ล้างสมาชิกทั้งหมด?',
    message: k
      ? `สมาชิก ${n} คนจะถูกลบ และรายการค่าใช้จ่าย ${k} รายการจะถูกลบไปด้วย เพราะทุกรายการต้องมีสมาชิก`
      : `สมาชิก ${n} คนจะถูกลบ`,
    confirmText: 'ล้างสมาชิก',
  });
  if (ok) commit(clearMembers(state), 'ล้างสมาชิกแล้ว');
}

async function doClearItems() {
  const ok = await confirmDialog({
    title: 'ล้างรายการทั้งหมด?',
    message: `รายการค่าใช้จ่าย ${state.items.length} รายการจะถูกลบ ส่วนสมาชิกยังอยู่ครบ`,
    confirmText: 'ล้างรายการ',
  });
  if (ok) commit(clearItems(state), 'ล้างรายการแล้ว');
}

async function doClearPayments() {
  const ok = await confirmDialog({
    title: 'ล้างช่องทางรับเงิน?',
    message: 'พร้อมเพย์ บัญชีธนาคาร และรูป QR ของทุกคนจะถูกลบ ส่วนสมาชิกและรายการยังอยู่ครบ',
    confirmText: 'ล้างช่องทางรับเงิน',
  });
  if (ok) commit(clearPayments(state), 'ล้างช่องทางรับเงินแล้ว');
}

async function doClearAll() {
  if (!state.members.length && !state.items.length) {
    toast('ไม่มีข้อมูลให้ล้าง');
    return;
  }
  const ok = await confirmDialog({
    title: 'ล้างข้อมูลทั้งหมด?',
    message: `สมาชิก ${state.members.length} คน และรายการ ${state.items.length} รายการจะถูกลบถาวร ไม่สามารถกู้คืนได้ (ยกเว้นมีไฟล์สำรอง)`,
    confirmText: 'ล้างข้อมูลทั้งหมด',
    requireCheck: 'ฉันเข้าใจว่าข้อมูลทั้งหมดจะถูกลบถาวร',
  });
  if (ok) commit(clearAll(), 'ล้างข้อมูลทั้งหมดแล้ว');
}

// ====================== copy / share ======================
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

async function copySummary() {
  const ok = await copyText(summaryText());
  if (!ok) return toast('คัดลอกไม่สำเร็จ', 'error');
  const hasQr = receiverIds().some((id) => memberById(id)?.payment?.qr);
  toast(hasQr ? 'คัดลอกข้อความแล้ว วางในแอปแชตได้เลย (รูป QR ต้องส่งแยก)' : 'คัดลอกสรุปผลแล้ว วางในแอปแชตได้เลย', 'ok');
}

// ====================== global events ======================
document.addEventListener('click', async (e) => {
  const zoom = e.target.closest('img[data-zoom]');
  if (zoom) {
    const z = document.createElement('div');
    z.className = 'img-zoom';
    z.setAttribute('role', 'dialog');
    z.setAttribute('aria-label', 'รูปขยาย แตะเพื่อปิด');
    z.innerHTML = `<img src="${zoom.src}" alt="${esc(zoom.alt)}" />`;
    z.addEventListener('click', () => z.remove());
    document.body.appendChild(z);
    return;
  }
  const tab = e.target.closest('[data-tab]');
  if (tab) return switchTab(tab.dataset.tab);
  const go = e.target.closest('[data-tab-go]');
  if (go) return switchTab(go.dataset.tabGo);
  const a = e.target.closest('[data-action]');
  if (!a) return;
  switch (a.dataset.action) {
    case 'add-member': return openAddMember();
    case 'edit-member': return openEditMember(a.dataset.id);
    case 'add-item': return openItemForm();
    case 'edit-item': return openItemForm(a.dataset.id);
    case 'open-menu': return openMenu();
    case 'export': return doExport();
    case 'dismiss-notice':
      setPref('noticeDismissed', true);
      return render();
    case 'edit-payment': return openPaymentSheet(a.dataset.id);
    case 'clear-all': return doClearAll();
    case 'clear-members': return doClearMembers();
    case 'clear-items': return doClearItems();
    case 'clear-payments': return doClearPayments();
    case 'copy-summary': return copySummary();
    case 'share-summary': {
      const text = summaryText();
      if (!navigator.share) return copySummary(); // คอมพิวเตอร์ที่ไม่มีเมนูแชร์ -> คัดลอกแทน
      const files = receiverIds()
        .map(memberById)
        .filter((m) => m?.payment?.qr)
        .map((m) => dataUrlToFile(m.payment.qr, qrFileName(m)));
      try {
        if (files.length && navigator.canShare?.({ files, text })) await navigator.share({ files, text });
        else await navigator.share({ text });
      } catch (err) {
        if (err?.name !== 'AbortError') return copySummary(); // แชร์ไม่ได้ -> คัดลอกแทน
      }
      return;
    }
    case 'copy-number': {
      const ok = await copyText(a.dataset.value);
      return toast(ok ? `คัดลอก ${a.dataset.value} แล้ว` : 'คัดลอกไม่สำเร็จ', ok ? 'ok' : 'error');
    }
    case 'save-qr': {
      const m = memberById(a.dataset.id);
      if (!m?.payment?.qr) return;
      const link = document.createElement('a');
      link.href = m.payment.qr;
      link.download = qrFileName(m);
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
  }
});

$('#import-file').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (f) doImportFile(f);
});

// ซิงก์เมื่อเปิดหลายแท็บ
window.addEventListener('storage', (e) => {
  if (e.key && e.key.startsWith('paybill:v1:data')) {
    state = loadState().state;
    summary = computeSummary(state);
    render();
  }
});

// ====================== init ======================
render();
switchTab(location.hash === '#summary' ? 'summary' : 'bills');
if (loadWarnings.length) toast(loadWarnings.join('\n'), 'error');

// เปิดให้ทดสอบอัตโนมัติ / debug
window.__paybill = { get state() { return state; }, get summary() { return summary; } };
