// End-to-end test บนเบราว์เซอร์จริง (Playwright + Chromium)
// ติดตั้ง:  npm install && npx playwright install chromium
// รัน:      npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 5190 + Math.floor(Math.random() * 500);
const URL_ = `http://localhost:${PORT}/`;
let server;
let browser;
let page;
let tmp;
const pageErrors = [];

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'paybill-e2e-'));
  server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { cwd: ROOT, stdio: 'pipe' });
  await new Promise((r) => server.stdout.once('data', r));
  browser = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'th-TH', acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL_ });
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(URL_);
});

after(async () => {
  await browser?.close();
  server?.kill();
});

const state = () => page.evaluate(() => window.__paybill.state);
const summary = () => page.evaluate(() => window.__paybill.summary);
const sheet = () => page.locator('.sheet.is-open').last();
const dialogYes = async () => {
  await page.locator('.dialog.is-open [data-yes]').click();
  await page.waitForTimeout(250);
};
const closeAnim = () => page.waitForTimeout(320);

async function addMemberUI(name) {
  await page.locator('[data-action="add-member"]').first().click();
  await page.fill('#member-name', name);
  await sheet().locator('button[type=submit]').click();
  await closeAnim();
}

async function addItem(name, amount, payer, { exclude = [] } = {}) {
  await page.click('.fab');
  await page.fill('#item-name', name);
  await page.fill('#item-amount', amount);
  for (const x of exclude) await sheet().locator(`#part-chips .chip:has-text("${x}")`).click();
  await sheet().locator(`#payer-area .chip:has-text("${payer}")`).click();
  await sheet().locator('.sheet__foot button[type=submit]').click();
  await closeAnim();
}

test('เพิ่มสมาชิกทีละคน (ไม่มี placeholder) + Test Case หัวข้อ 3 ผ่าน UI', async () => {
  await page.locator('[data-action="add-member"]').first().click();
  assert.equal(await page.getAttribute('#member-name', 'placeholder'), null);
  assert.equal(await sheet().locator('#pay-promptpay').count(), 0, 'หน้าเพิ่มสมาชิกไม่มีช่องทางรับเงิน');
  await sheet().locator('.sheet__foot [data-close]').click();
  await closeAnim();
  // ยังไม่มีข้อมูล -> ไม่แสดงปุ่มล้าง
  assert.equal(await page.locator('#clear-members').isVisible(), false);
  assert.equal(await page.locator('#clear-items').isVisible(), false);
  for (const n of ['มิก', 'โอ๊ต', 'อุ๋ย', 'มุก']) await addMemberUI(n);
  assert.equal(await page.locator('#clear-members').isVisible(), true);
  assert.deepEqual((await state()).members.map((m) => m.name), ['มิก', 'โอ๊ต', 'อุ๋ย', 'มุก']);

  await addItem('บิลแรก', '610', 'โอ๊ต');
  await addItem('บิลสอง', '2582', 'มิก');
  await addItem('บิลสาม', '450', 'มิก', { exclude: ['มุก'] });

  await page.click('.tab[data-tab=summary]');
  assert.equal(await page.textContent('[data-testid=sum-total]'), '฿3,642.00');
  const rows = await page.$$eval('[data-testid=summary-table] tbody tr', (trs) =>
    trs.map((tr) => [...tr.children].map((td) => td.textContent.trim())),
  );
  assert.deepEqual(rows, [
    ['มิก', '948.00', '3,032.00', '+2,084.00'],
    ['โอ๊ต', '948.00', '610.00', '-338.00'],
    ['อุ๋ย', '948.00', '0.00', '-948.00'],
    ['มุก', '798.00', '0.00', '-798.00'],
  ]);
  const transfers = await page.$$eval('[data-testid=transfers] .transfer', (els) =>
    els.map((e) => e.textContent.replace(/\s+/g, '')),
  );
  assert.deepEqual(transfers, ['อโอ๊ตโอนให้มิก฿338.00', 'ออุ๋ยโอนให้มิก฿948.00', 'มมุกโอนให้มิก฿798.00']);

  // คัดลอกสรุปผล
  await page.click('[data-action=copy-summary]');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /โอ๊ต โอนให้ มิก 338\.00 บาท/);
  assert.match(clip, /ยอดรวมทั้งหมด 3,642\.00 บาท/);
  assert.match(clip, /มิก: จ่ายทั้งหมด 948\.00 \/ จ่ายจริง 3,032\.00/);
  assert.doesNotMatch(clip, /ช่องทางรับเงิน/, 'ยังไม่กรอกช่องทางรับเงิน ต้องไม่แสดงหัวข้อนี้');
});

test('ช่องทางรับเงิน: กรอกผิดแจ้งเตือน, กรอกพร้อมเพย์+บัญชี+รูป QR แล้วแสดงในหน้าสรุปและข้อความคัดลอก', async () => {
  // หน้าสรุปมีปุ่มเพิ่มช่องทางรับเงินให้คนที่ต้องได้รับเงิน
  await page.locator('[data-action=edit-payment][data-id]').first().click();
  await page.fill('#pay-promptpay', '12345');
  await sheet().locator('button[type=submit]').click();
  assert.match(await sheet().locator('#payment-err').textContent(), /10 หลัก/);

  await page.fill('#pay-promptpay', '0812345678');
  await sheet().locator('#pay-bank').selectOption('กสิกรไทย');
  await page.fill('#pay-account', '123-4-56789-0');
  const qrPath = join(tmp, 'qr.png');
  const p2 = await browser.newPage({ viewport: { width: 300, height: 300 } });
  await p2.setContent('<div style="width:300px;height:300px;background:repeating-linear-gradient(45deg,#000 0 20px,#fff 20px 40px)"></div>');
  await p2.screenshot({ path: qrPath });
  await p2.close();
  await sheet().locator('[data-testid=qr-file]').setInputFiles(qrPath);
  await sheet().locator('.qr-thumb').waitFor();
  await sheet().locator('button[type=submit]').click();
  await closeAnim();

  const mik = (await state()).members.find((m) => m.name === 'มิก');
  assert.equal(mik.payment.promptpay, '0812345678');
  assert.deepEqual([mik.payment.bank, mik.payment.account], ['กสิกรไทย', '1234567890']);
  assert.match(mik.payment.qr, /^data:image\/jpeg;base64,/);

  const card = await page.textContent('#page-summary .pay-card');
  assert.match(card, /081-234-5678/);
  assert.match(card, /123-4-56789-0/);
  assert.equal(await page.locator('#page-summary .pay-card .qr-thumb').count(), 1);

  await page.click('[data-action=copy-summary]');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /🏦 ช่องทางรับเงิน\n• มิก\n   พร้อมเพย์ 081-234-5678\n   บัญชีกสิกรไทย 123-4-56789-0\n   มี QR Code/);

  // ปุ่มแชร์: ใช้เมนูแชร์ของเครื่อง (จำลอง) ส่งข้อความ + รูป QR
  await page.evaluate(() => {
    window.__shared = null;
    navigator.share = async (data) => { window.__shared = { text: data.text, files: (data.files || []).map((f) => [f.name, f.type]) }; };
    navigator.canShare = () => true;
  });
  await page.click('[data-action=share-summary]');
  const shared = await page.evaluate(() => window.__shared);
  assert.match(shared.text, /โอ๊ต โอนให้ มิก 338\.00 บาท/);
  assert.deepEqual(shared.files, [['QR-มิก.jpg', 'image/jpeg']]);
  assert.doesNotMatch(await page.textContent('#page-summary'), /LINE/);

  // ไม่มีเมนูแชร์ (คอมพิวเตอร์) -> คัดลอกแทน
  await page.evaluate(() => { delete navigator.share; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.click('[data-action=share-summary]');
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /🏦 ช่องทางรับเงิน/);

  // คัดลอกเลขบัญชีอย่างเดียว
  await page.locator('#page-summary [data-action=copy-number][data-value="1234567890"]').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '1234567890');
});

test('ข้อมูลยังอยู่หลังรีโหลด (LocalStorage)', async () => {
  await page.reload();
  const s = await state();
  assert.equal(s.members.length, 4);
  assert.equal(s.items.length, 3);
  assert.equal((await summary()).total, 364200);
});

test('ผู้ร่วมรับผิดชอบ: ปุ่มยกเลิกทั้งหมด -> บันทึกไม่ได้, เลือกทั้งหมด -> ได้', async () => {
  await page.click('.tab[data-tab=bills]');
  await page.click('.fab');
  await page.fill('#item-name', 'ทดสอบ');
  await page.fill('#item-amount', '100');
  await sheet().locator('[data-none]').click();
  assert.match(await page.textContent('#split-info'), /อย่างน้อย 1 คน/);
  await sheet().locator('button[type=submit]').click();
  assert.match(await page.textContent('#item-err'), /อย่างน้อย 1 คน/);
  await sheet().locator('[data-all]').click();
  assert.match(await page.textContent('#split-info'), /4 คน.*คนละ ฿25\.00/);
  await page.keyboard.press('Escape');
  await closeAnim();
  assert.equal((await state()).items.length, 3);
});

test('เศษสตางค์: 100 บาท หาร 3 คน แสดงช่วง และยอดรวมถูกต้อง', async () => {
  await addItem('หารสาม', '100', 'มุก', { exclude: ['มุก'] });
  const s = await summary();
  const it = (await state()).items.find((i) => i.name === 'หารสาม');
  const shares = Object.values(s.itemShares[it.id]).sort();
  assert.deepEqual(shares, [3333, 3333, 3334]);
  assert.ok(s.checks.owedEqualsTotal);
  const meta = await page.locator(`.item:has-text("หารสาม") .item__meta`).textContent();
  assert.match(meta, /คนละ 33\.33–33\.34/);
});

test('แก้ไขรายการ: แบ่งกันจ่าย 2 คน (ยอดต้องครบ) และลบรายการพร้อมยืนยัน', async () => {
  await page.locator('.item:has-text("หารสาม")').click();
  await sheet().locator('[data-mode=multi]').click();
  // ยอดเดิมของมุก 100 -> แก้เป็น 60 แล้วให้ มิก จ่าย "ที่เหลือ"
  const mukId = (await state()).members.find((m) => m.name === 'มุก').id;
  const mikId = (await state()).members.find((m) => m.name === 'มิก').id;
  await page.fill(`#pay-${mukId}`, '60');
  assert.match(await page.textContent('#pay-status'), /ขาดอีก 40\.00/);
  await sheet().locator('[data-pay-amount="' + mikId + '"] + [data-fill]').click();
  assert.match(await page.textContent('#pay-status'), /ครบพอดี/);
  await page.fill('#item-name', 'หารสาม (แก้)');
  await sheet().locator('button[type=submit]').click();
  await closeAnim();
  const it = (await state()).items.find((i) => i.name === 'หารสาม (แก้)');
  assert.deepEqual(
    it.payers.map((p) => p.amount).sort((a, b) => a - b),
    [4000, 6000],
  );

  // ลบ: กดยกเลิกก่อน -> ยังอยู่
  await page.locator('.item:has-text("หารสาม (แก้)")').click();
  await sheet().locator('[data-del]').click();
  await page.locator('.dialog.is-open [data-no]').click();
  await page.waitForTimeout(250);
  assert.ok((await state()).items.some((i) => i.name === 'หารสาม (แก้)'));
  await sheet().locator('[data-del]').click();
  await dialogYes();
  await closeAnim();
  assert.ok(!(await state()).items.some((i) => i.name.startsWith('หารสาม')));
  assert.equal((await summary()).total, 364200);
});

test('แก้ไขชื่อสมาชิก และลบสมาชิกที่ถูกใช้อยู่ (ต้องเลือกวิธีจัดการ)', async () => {
  await page.locator('.member:has-text("มุก")').click();
  await page.fill('#member-name', 'มุกดา');
  await sheet().locator('button[type=submit]').click();
  await closeAnim();
  assert.ok((await state()).members.some((m) => m.name === 'มุกดา'));

  // เพิ่มสมาชิกที่ไม่ถูกใช้ แล้วลบได้ทันที
  await addMemberUI('เบียร์');
  await page.locator('.member:has-text("เบียร์")').click();
  await sheet().locator('[data-del]').click();
  await closeAnim();
  await dialogYes();
  assert.ok(!(await state()).members.some((m) => m.name === 'เบียร์'));

  // ลบ "โอ๊ต" ซึ่งเป็นผู้จ่ายบิลแรก -> แสดงรายการที่เกี่ยวข้อง, กดยกเลิกการลบ
  await page.locator('.member:has-text("โอ๊ต")').click();
  await sheet().locator('[data-del]').click();
  await closeAnim();
  assert.equal(await sheet().locator('.affected li').count(), 3);
  await sheet().locator('.sheet__foot [data-close]').click();
  await closeAnim();
  assert.equal((await state()).members.length, 4);
  assert.equal((await summary()).total, 364200);
});

test('ส่งออก JSON -> ล้างข้อมูลทั้งหมด -> นำเข้า JSON กู้คืนได้', async () => {
  const before = await state();
  await page.locator('#page-bills [data-action=open-menu]').click();
  const [download] = await Promise.all([page.waitForEvent('download'), sheet().locator('[data-m=export]').click()]);
  const file = join(tmp, 'backup.json');
  await download.saveAs(file);
  const json = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(json.app, 'paybill-bill-splitter');
  await closeAnim();

  // ล้างข้อมูล: ปุ่มยืนยันถูกปิดจนกว่าจะติ๊กยอมรับ
  await page.locator('#page-bills [data-action=open-menu]').click();
  await sheet().locator('[data-m=clear]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.dialog.is-open [data-yes]').isDisabled(), true);
  await page.locator('.dialog.is-open [data-req]').check();
  await dialogYes();
  assert.equal((await state()).members.length, 0);
  assert.equal((await state()).items.length, 0);

  // ไฟล์ผิดรูปแบบ
  const badFile = join(tmp, 'bad.json');
  await writeFile(badFile, '{"hello":1}');
  await page.setInputFiles('#import-file', badFile);
  await page.waitForTimeout(300);
  assert.match(await page.textContent('#toast-root'), /ไม่ใช่ข้อมูลสำรอง/);

  await page.setInputFiles('#import-file', file);
  await page.waitForTimeout(300);
  await dialogYes();
  const after = await state();
  assert.deepEqual(after.members, before.members);
  assert.deepEqual(after.items, before.items);
  assert.equal((await summary()).total, 364200);
});

test('ล้างข้อมูลทีละส่วน: รายการ / ช่องทางรับเงิน / สมาชิก', async () => {
  await page.click('.tab[data-tab=bills]');
  const before = await state();
  assert.ok(before.items.length > 0);

  // ล้างรายการ: กดยกเลิกก่อน ข้อมูลต้องไม่หาย
  await page.click('#clear-items');
  await page.waitForTimeout(300);
  await page.locator('.dialog.is-open [data-no]').click();
  await page.waitForTimeout(250);
  assert.equal((await state()).items.length, before.items.length);

  // ช่องทางรับเงิน (หน้าสรุปผล) ต้องล้างก่อนรายการ เพราะการ์ดจะแสดงเฉพาะตอนมีคนต้องได้รับเงิน
  await page.locator('.member:has-text("มิก")').waitFor();
  await page.evaluate(() => {});
  await page.click('.tab[data-tab=summary]');
  if (await page.locator('[data-action=clear-payments]').count()) {
    await page.click('[data-action=clear-payments]');
    await page.waitForTimeout(300);
    await dialogYes();
    assert.ok((await state()).members.every((m) => !m.payment));
  }
  await page.click('.tab[data-tab=bills]');

  await page.click('#clear-items');
  await page.waitForTimeout(300);
  await dialogYes();
  let s = await state();
  assert.equal(s.items.length, 0);
  assert.equal(s.members.length, before.members.length, 'สมาชิกยังอยู่');
  assert.equal(await page.locator('#clear-items').isVisible(), false);

  await page.click('#clear-members');
  await page.waitForTimeout(300);
  await dialogYes();
  s = await state();
  assert.deepEqual([s.members.length, s.items.length], [0, 0]);
});

test('ไม่มี JavaScript error ระหว่างทดสอบ', () => {
  assert.deepEqual(pageErrors, []);
});
