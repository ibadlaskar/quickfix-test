'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const api = read('src/api.js');
const schema = read('src/schema.sql');
const customer = read('public/customer.html');
const customerJs = read('public/customer.js');
const adminJs = read('public/app.js');
const techJs = read('public/tech.js');

test('Netlify deployment publishes public assets and builds the serverless API', () => {
  const netlify = read('netlify.toml');
  assert.match(netlify, /publish\s*=\s*"public"/);
  assert.match(netlify, /npm install && npm run build/);
  assert.match(netlify, /directory\s*=\s*"netlify\/functions"/);
  assert.match(read('package.json'), /"build"\s*:/);
});

test('compiled Netlify function exists and has valid JavaScript syntax-compatible entry', () => {
  const compiled = read('netlify/functions/api.js');
  assert.match(compiled, /exports\.handler\s*=\s*async/);
  assert.match(compiled, /\/customer\/bookings/);
  assert.match(compiled, /\/customer\/auth\/otp\/start/);
  assert.match(compiled, /customer = pub === \"customer\"/);
  assert.match(compiled, /qfb_customer/);
  assert.match(compiled, /var SCHEMA_VERSION = 4/);
});

test('customer authentication uses real provider verification and secure password hashing', () => {
  assert.match(api, /TWILIO_ACCOUNT_SID/);
  assert.match(api, /TWILIO_VERIFY_SERVICE_SID/);
  assert.match(api, /Mobile OTP is not configured yet/);
  assert.match(api, /crypto\.scryptSync/);
  assert.match(api, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(api, /failed_attempts\+1>=5/);
});

test('customer booking writes to the shared bookings table and records customer_web source', () => {
  assert.match(api, /INSERT INTO bookings\(customer_id,category_id,address,locality,preferred_at,inspection_fee,problem,source\)[\s\S]*?'customer_web'/);
  assert.match(api, /FROM bookings b JOIN service_categories/);
  assert.match(api, /R\('GET', '\/customer\/bookings'/);
});

test('customer-owned data routes scope queries to authenticated customer identity', () => {
  assert.match(api, /WHERE u\.id=\$1 ORDER BY b\.created_at DESC LIMIT 100/);
  assert.match(api, /WHERE u\.id=\$1 AND b\.booking_code=\$2/);
  assert.match(api, /x\.customer = a/);
});

test('schema preserves the existing admin, technician, booking, quote and payment models', () => {
  for (const table of ['admin_users','technicians','customers','users','bookings','booking_assignments','quotes','quote_items','payments','audit_logs','service_categories']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), `missing ${table}`);
  }
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS one_current_assignment/);
  assert.match(schema, /ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source/);
});

test('customer page exposes booking, login, profile and account entry points', () => {
  for (const id of ['navAccount','heroBook','serviceGrid','account','accountPanel','authContent','bookingDialog','bookingForm','dashboard','bookingList','logoutBtn']) {
    assert.match(customer, new RegExp(`id="${id}"`), `missing customer element #${id}`);
  }
  assert.match(customerJs, /customer\/auth\/login/);
  assert.match(customerJs, /customer\/register/);
  assert.match(customerJs, /customer\/auth\/change-password|change-password/);
  assert.match(customerJs, /customer\/bookings/);
});

test('admin and technician application assets are present', () => {
  assert.ok(fs.existsSync(path.join(root, 'public/admin.html')));
  assert.ok(fs.existsSync(path.join(root, 'public/tech.html')));
  assert.match(adminJs, /\/bookings/);
  assert.match(techJs, /\/tech/);
});

test('public contact details use the configured business call and WhatsApp numbers', () => {
  for (const p of ['public/index.html','public/customer.html']) {
    const html = read(p);
    assert.match(html, /tel:8822951734/);
    assert.match(html, /wa\.me\/919577792954/);
  }
});

test('SMS secrets are documented as server environment variables, not frontend values', () => {
  const env = read('.env.example');
  assert.match(env, /^DATABASE_URL=/m);
  assert.match(env, /^SESSION_SECRET=/m);
  assert.match(env, /^TWILIO_ACCOUNT_SID=/m);
  assert.doesNotMatch(customer + customerJs, /TWILIO_AUTH_TOKEN|TWILIO_ACCOUNT_SID|DATABASE_URL/);
});
