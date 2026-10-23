'use strict';
const { Pool } = require('pg');
const crypto = require('crypto');
const SCHEMA = require('./schema.sql');
const E = process.env;

let pool;
function dbConfig() {
  let u = E.DATABASE_URL || ''; const cfg = { max: 3, idleTimeoutMillis: 10000 };
  // Supabase poolers use their own certificate chain; keep the connection encrypted but let node accept it.
  if (/supabase\.(co|com)/.test(u)) { u = u.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, ''); cfg.ssl = { rejectUnauthorized: false }; }
  cfg.connectionString = u; return cfg;
}
const db = () => pool || (pool = new Pool(dbConfig()));
const Q = (s, p) => db().query(s, p);
class HttpError extends Error { constructor(c, m) { super(m); this.code = c; } }
const bad = (m) => new HttpError(400, m);

// ---------- security helpers ----------
const sign = (s) => crypto.createHmac('sha256', E.SESSION_SECRET).update(s).digest('base64url');
const same = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const mkToken = (id, t = 'a', ttl = 8 * 3600e3) => { const p = Buffer.from(JSON.stringify({ sub: id, t, exp: Date.now() + ttl })).toString('base64url'); return p + '.' + sign(p); };
function readToken(t, type = 'a') {
  if (!t) return null; const [p, s] = t.split('.');
  if (!p || !s || !same(s, sign(p))) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url')); return o.exp > Date.now() && (o.t || 'a') === type ? o.sub : null; } catch { return null; }
}
const hashPw = (pw) => { const s = crypto.randomBytes(16).toString('hex'); return 'scrypt$' + s + '$' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const checkPw = (pw, h) => { const [, s, x] = h.split('$'); return same(crypto.scryptSync(pw, s, 64).toString('hex'), x); };
const cookie = (n, v, age) => `${n}=${v}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;

// ---------- validation helpers ----------
const S = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
const opt = (v, max = 500) => S(v, max) || null;
const req = (v, label, max) => { const x = S(v, max); if (!x) throw bad(label + ' is required'); return x; };
function mob(v, label, required) {
  let x = S(v, 20).replace(/[\s-]/g, '').replace(/^(\+91|91)(?=\d{10}$)/, '');
  if (!x) { if (required) throw bad(label + ' is required'); return null; }
  if (!/^[6-9]\d{9}$/.test(x)) throw bad(label + ' must be a valid 10-digit mobile number');
  return x;
}
const intOrNull = (v, label, min, max) => {
  if (v === '' || v == null) return null; const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number between ${min} and ${max}`); return n;
};
function techData(b) {
  const email = S(b.email, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email address is not valid');
  const pin = S(b.pin_code, 6); if (!/^\d{6}$/.test(pin)) throw bad('PIN code must be 6 digits');
  const av = S(b.availability, 20) || null;
  if (av && !['full_time', 'part_time', 'weekend'].includes(av)) throw bad('Invalid availability');
  return {
    full_name: req(b.full_name, 'Full legal name', 120), mobile: mob(b.mobile, 'Mobile number', true),
    alt_mobile: mob(b.alt_mobile, 'Alternate mobile'), email: email || null,
    address: req(b.address, 'Current address', 300), locality: req(b.locality, 'Town/locality', 100), pin_code: pin,
    emergency_name: opt(b.emergency_name, 120), emergency_mobile: mob(b.emergency_mobile, 'Emergency contact number'),
    experience_years: intOrNull(b.experience_years, 'Years of experience', 0, 60), experience_notes: opt(b.experience_notes, 1000),
    qualifications: opt(b.qualifications, 500), tools: opt(b.tools, 500), own_transport: !!b.own_transport,
    working_hours: opt(b.working_hours, 100), availability: av, service_localities: opt(b.service_localities, 300),
    max_distance_km: intOrNull(b.max_distance_km, 'Maximum distance', 0, 500), assessment_notes: opt(b.assessment_notes, 1000),
  };
}
function agreementData(a) {
  a = a || {};
  const basis = S(a.commission_basis, 30), sched = S(a.settlement_schedule, 20), rate = Number(a.commission_rate);
  if (!['labour_only', 'labour_and_parts', 'fixed_per_job', 'custom'].includes(basis)) throw bad('Choose a commission basis');
  if (!['daily', 'weekly', 'fortnightly'].includes(sched)) throw bad('Choose a settlement schedule');
  if (!(rate >= 0 && rate <= (basis === 'fixed_per_job' ? 100000 : 100))) throw bad(basis === 'fixed_per_job' ? 'Enter the fixed amount per job' : 'Commission rate must be between 0 and 100');
  return { version: S(a.version, 20) || 'v1.0', commission_basis: basis, commission_rate: rate, settlement_schedule: sched };
}
const CHECKS = ['mobile_verified', 'identity_checked', 'address_checked', 'skills_assessed', 'qualifications_reviewed'];
async function skillIds(c, arr) {
  const ids = [...new Set((arr || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return [];
  const r = await c.query('SELECT id FROM service_categories WHERE is_active AND id = ANY($1)', [ids]);
  if (r.rowCount !== ids.length) throw bad('One or more selected services are not available');
  return ids;
}
function build(kind, table, obj, where) {
  const k = Object.keys(obj), v = Object.values(obj);
  if (kind === 'ins') return [`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, v];
  return [`UPDATE ${table} SET ${k.map((x, i) => x + '=$' + (i + 1)).join(',')}, updated_at=now() WHERE ${where[0]}=$${k.length + 1} RETURNING *`, [...v, where[1]]];
}
async function tx(fn) {
  const c = await db().connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
const audit = (c, x, action, type, id, reason, details) =>
  c.query('INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,reason,details,ip) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [x.admin ? x.admin.id : null, action, type, id, reason || null, details ? JSON.stringify(details) : null, x.ip]);
const dupMsg = (e) => { if (e.code === '23505') { if (/mobile/.test(e.detail || e.constraint || '')) return 'A technician with this mobile number already exists'; return 'This record already exists'; } };

// ---------- routes ----------
const routes = [];
const R = (m, p, fn, pub) => routes.push([m, new RegExp('^' + p + '/?$'), fn, pub]);
const TC = '(QFB-TECH-\\d{4,})';

R('GET', '/setup/status', async () => {
  const out = { configured: !!(E.DATABASE_URL && E.SESSION_SECRET && E.SESSION_SECRET.length >= 32 && E.SETUP_TOKEN), tables: false, hasAdmin: false };
  if (!E.DATABASE_URL) return out;
  try { const r = await Q("SELECT to_regclass('public.admin_users') t"); out.tables = !!r.rows[0].t;
    if (out.tables) out.hasAdmin = (await Q('SELECT 1 FROM admin_users LIMIT 1')).rowCount > 0; } catch (e) { out.dbError = true; }
  return out;
}, 'pub');

R('POST', '/setup', async (x) => {
  if (!E.SETUP_TOKEN || E.SETUP_TOKEN.length < 12) throw new HttpError(500, 'SETUP_TOKEN is not set on the server (min 12 characters)');
  if (!same(S(x.body.token, 200), E.SETUP_TOKEN)) throw new HttpError(403, 'Setup token is incorrect');
  if (x.body.action === 'migrate') { await Q(SCHEMA); await Q("INSERT INTO app_meta(key,value) VALUES('schema_version',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [String(SCHEMA_VERSION)]); return { ok: true, message: 'Database tables are ready' }; }
  if (x.body.action === 'create_admin') {
    if ((await Q('SELECT 1 FROM admin_users LIMIT 1')).rowCount) throw new HttpError(403, 'An administrator already exists. Setup is closed.');
    const email = req(x.body.email, 'Email', 120).toLowerCase(), name = req(x.body.name, 'Name', 100), pw = S(x.body.password, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email address is not valid');
    if (pw.length < 10) throw bad('Password must be at least 10 characters');
    const r = await Q("INSERT INTO admin_users(email,name,role,password_hash) VALUES($1,$2,'owner',$3) RETURNING id", [email, name, hashPw(pw)]);
    await audit({ query: (...a) => Q(...a) }, { admin: { id: r.rows[0].id }, ip: x.ip }, 'admin.created', 'admin', r.rows[0].id, 'First owner account created');
    return { ok: true };
  }
  throw bad('Unknown setup action');
}, 'pub');

R('POST', '/login', async (x) => {
  const email = S(x.body.email, 120).toLowerCase(), pw = S(x.body.password, 200);
  const r = await Q('SELECT * FROM admin_users WHERE email=$1', [email]);
  const a = r.rows[0], fail = new HttpError(401, 'Incorrect email or password');
  if (!a) { crypto.scryptSync(pw, 'x', 64); throw fail; }
  if (a.locked_until && a.locked_until > new Date()) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  if (!a.is_active || !checkPw(pw, a.password_hash)) {
    await Q("UPDATE admin_users SET failed_attempts=failed_attempts+1, locked_until=CASE WHEN failed_attempts+1>=5 THEN now()+interval '15 minutes' END WHERE id=$1", [a.id]);
    await audit({ query: (...q) => Q(...q) }, { admin: { id: a.id }, ip: x.ip }, 'login.failed', 'admin', a.id);
    throw fail;
  }
  await Q('UPDATE admin_users SET failed_attempts=0, locked_until=NULL, last_login_at=now() WHERE id=$1', [a.id]);
  await audit({ query: (...q) => Q(...q) }, { admin: a, ip: x.ip }, 'login', 'admin', a.id);
  return { body: { name: a.name, email: a.email, role: a.role }, cookie: cookie('qfb_session', mkToken(a.id), 28800) };
}, 'pub');

R('POST', '/logout', async (x) => ({ body: { ok: true }, cookie: cookie('qfb_session', '', 0) }), true);
R('GET', '/me', async (x) => ({ name: x.admin.name, email: x.admin.email, role: x.admin.role }));
R('GET', '/categories', async () => (await Q('SELECT id,name,description,inspection_fee,is_active,sort_order FROM service_categories ORDER BY is_active DESC,sort_order,name')).rows);

R('GET', '/dashboard', async () => {
  const c = (await Q(`SELECT
   (SELECT count(*) FROM technicians) tech_total,
   (SELECT count(*) FROM technicians WHERE status='active') tech_active,
   (SELECT count(*) FROM technicians WHERE verification_status IN ('pending','under_review')) tech_pending,
   (SELECT count(*) FROM technicians WHERE status='suspended') tech_suspended,
   (SELECT count(*) FROM customers) customers,
   (SELECT count(*) FROM bookings) bookings,
   (SELECT count(*) FROM bookings WHERE work_status IN ('requested','confirmed','assigned')) bookings_open,
   (SELECT count(*) FROM bookings WHERE work_status='completed') bookings_done,
   (SELECT count(*) FROM bookings b WHERE b.work_status NOT IN ('completed','cancelled') AND NOT EXISTS (SELECT 1 FROM booking_assignments a WHERE a.booking_id=b.id AND a.is_current)) bookings_unassigned,
   (SELECT COALESCE(sum(amount_collected),0) FROM payments)-(SELECT COALESCE(sum(amount),0) FROM payment_adjustments WHERE kind='refund') cash,
   (SELECT COALESCE(sum(commission_amount),0) FROM technician_commission_ledger) owed,
   (SELECT COALESCE(sum(amount_settled),0) FROM technician_settlements WHERE status='verified') settled`)).rows[0];
  const n = (k) => Number(c[k]);
  return {
    cards: { tech_total: n('tech_total'), tech_active: n('tech_active'), tech_pending: n('tech_pending'), tech_suspended: n('tech_suspended'),
      customers: n('customers'), bookings: n('bookings'), bookings_open: n('bookings_open'), bookings_done: n('bookings_done'), bookings_unassigned: n('bookings_unassigned'),
      cash: n('cash'), owed: n('owed'), outstanding: n('owed') - n('settled'), settled: n('settled') },
    activity: (await Q(`SELECT a.action,a.entity_id,a.reason,a.created_at,u.name admin FROM audit_logs a LEFT JOIN admin_users u ON u.id=a.admin_id WHERE a.action NOT IN ('login','login.failed') ORDER BY a.id DESC LIMIT 8`)).rows,
    bookings: (await Q(`SELECT b.booking_code,b.work_status,b.created_at,cu.name customer,sc.name service FROM bookings b JOIN customers cu ON cu.id=b.customer_id JOIN service_categories sc ON sc.id=b.category_id ORDER BY b.created_at DESC LIMIT 5`)).rows,
    approvals: (await Q(`SELECT tech_code,full_name,verification_status,created_at FROM technicians WHERE verification_status IN ('pending','under_review') ORDER BY created_at LIMIT 6`)).rows,
    overdue: (await Q(`SELECT s.id,t.tech_code,t.full_name,s.due_date,(s.commission_due+s.adjustments-s.amount_settled) balance FROM technician_settlements s JOIN technicians t ON t.id=s.technician_id WHERE s.status IN ('pending','submitted','rejected') AND s.due_date<current_date ORDER BY s.due_date LIMIT 6`)).rows,
  };
});

R('GET', '/technicians', async (x) => {
  const q = x.query, w = [], p = [], add = (sql, v) => { p.push(v); w.push(sql.replace('?', '$' + p.length)); };
  if (q.q) { p.push('%' + S(q.q, 60).toLowerCase() + '%'); w.push(`(lower(t.tech_code) LIKE $${p.length} OR lower(t.full_name) LIKE $${p.length} OR t.mobile LIKE $${p.length})`); }
  if (q.status) add('t.status=?', S(q.status, 20));
  if (q.verification) add('t.verification_status=?', S(q.verification, 20));
  if (q.area) add('lower(t.locality) LIKE ?', '%' + S(q.area, 60).toLowerCase() + '%');
  if (q.category) add('EXISTS (SELECT 1 FROM technician_skills s WHERE s.technician_id=t.id AND s.approved AND s.category_id=?)', parseInt(q.category, 10) || 0);
  const sorts = { created: 't.created_at', name: 't.full_name', code: 't.tech_code', experience: 't.experience_years' };
  const col = sorts[q.sort] || 't.created_at', dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const page = Math.max(1, parseInt(q.page, 10) || 1), size = 15, where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const total = Number((await Q(`SELECT count(*) FROM technicians t ${where}`, p)).rows[0].count);
  const rows = (await Q(`SELECT t.tech_code,t.full_name,t.mobile,t.locality,t.status,t.verification_status,t.experience_years,t.created_at,
    (SELECT string_agg(c.name,', ' ORDER BY c.sort_order) FROM technician_skills s JOIN service_categories c ON c.id=s.category_id WHERE s.technician_id=t.id AND s.approved) skills
    FROM technicians t ${where} ORDER BY ${col} ${dir}, t.id LIMIT ${size} OFFSET ${(page - 1) * size}`, p)).rows;
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / size)) };
});

R('POST', '/technicians', async (x) => {
  const d = techData(x.body), b = x.body, ag = b.agreement && b.agreement.accepted ? agreementData(b.agreement) : null;
  try {
    return await tx(async (c) => {
      const ids = await skillIds(c, b.skills);
      if ((await c.query('SELECT 1 FROM technicians WHERE mobile=$1', [d.mobile])).rowCount) throw new HttpError(409, 'A technician with this mobile number already exists');
      const code = (await c.query("SELECT 'QFB-TECH-' || lpad(nextval('technician_code_seq')::text, 4, '0') AS code")).rows[0].code;
      const [sql, v] = build('ins', 'technicians', { ...d, tech_code: code, created_by: x.admin.id });
      const t = (await c.query(sql, v)).rows[0];
      for (const id of ids) await c.query('INSERT INTO technician_skills(technician_id,category_id,approved_by) VALUES($1,$2,$3)', [t.id, id, x.admin.id]);
      const vc = b.verification || {};
      await c.query(`INSERT INTO technician_verifications(technician_id,${CHECKS.join(',')}) VALUES($1,${CHECKS.map((_, i) => '$' + (i + 2)).join(',')})`, [t.id, ...CHECKS.map((k) => !!vc[k])]);
      if (ag) await c.query('INSERT INTO technician_agreements(technician_id,version,commission_basis,commission_rate,settlement_schedule,recorded_by) VALUES($1,$2,$3,$4,$5,$6)', [t.id, ag.version, ag.commission_basis, ag.commission_rate, ag.settlement_schedule, x.admin.id]);
      await audit(c, x, 'technician.created', 'technician', code, null, { name: d.full_name });
      return { tech_code: code };
    });
  } catch (e) { const m = dupMsg(e); if (m) throw new HttpError(409, m); throw e; }
});

async function loadTech(code) {
  const t = (await Q('SELECT * FROM technicians WHERE tech_code=$1', [code])).rows[0];
  if (!t) throw new HttpError(404, 'Technician not found'); return t;
}

R('GET', '/technicians/' + TC, async (x) => {
  const t = await loadTech(x.params[0]), id = t.id;
  const one = async (s, p) => (await Q(s, p || [id])).rows;
  const st = (await Q(`SELECT
    (SELECT count(*) FROM booking_assignments WHERE technician_id=$1) assigned,
    (SELECT count(*) FROM booking_assignments a JOIN bookings b ON b.id=a.booking_id WHERE a.technician_id=$1 AND a.is_current AND b.work_status='completed') completed,
    (SELECT count(*) FROM booking_assignments a JOIN bookings b ON b.id=a.booking_id WHERE a.technician_id=$1 AND b.work_status='cancelled') cancelled,
    (SELECT round(avg(rating),1) FROM reviews WHERE technician_id=$1) rating,
    (SELECT count(*) FROM complaints WHERE technician_id=$1) complaints,
    (SELECT COALESCE(sum(amount_collected),0) FROM payments WHERE technician_id=$1)-(SELECT COALESCE(sum(ad.amount),0) FROM payment_adjustments ad JOIN payments p ON p.id=ad.payment_id WHERE ad.kind='refund' AND p.technician_id=$1) cash,
    (SELECT COALESCE(sum(commission_amount),0) FROM technician_commission_ledger WHERE technician_id=$1) owed,
    (SELECT COALESCE(sum(amount_settled),0) FROM technician_settlements WHERE technician_id=$1 AND status='verified') settled`, [id])).rows[0];
  return {
    tech: Object.assign({}, t, { password_hash: undefined, failed_attempts: undefined, locked_until: undefined, has_login: !!(t.login_enabled && t.password_hash) }), stats: { ...st, outstanding: Number(st.owed) - Number(st.settled) },
    categories: await one('SELECT c.id,c.name,(s.technician_id IS NOT NULL AND s.approved) approved FROM service_categories c LEFT JOIN technician_skills s ON s.category_id=c.id AND s.technician_id=$1 WHERE c.is_active OR s.technician_id IS NOT NULL ORDER BY c.sort_order'),
    verification: (await one('SELECT v.*,u.name verified_by_name FROM technician_verifications v LEFT JOIN admin_users u ON u.id=v.verified_by WHERE technician_id=$1'))[0],
    agreement: (await one('SELECT * FROM technician_agreements WHERE technician_id=$1 ORDER BY accepted_at DESC LIMIT 1'))[0] || null,
    ledger: await one(`SELECT l.entry_type,l.commission_amount,l.technician_share,l.note,l.created_at,b.booking_code,p.receipt_no,p.amount_collected,(si.ledger_id IS NOT NULL) settled FROM technician_commission_ledger l LEFT JOIN bookings b ON b.id=l.booking_id LEFT JOIN payments p ON p.id=l.payment_id LEFT JOIN settlement_items si ON si.ledger_id=l.id WHERE l.technician_id=$1 ORDER BY l.created_at DESC,l.id DESC LIMIT 25`),
    settlements: await one('SELECT id,status,due_date,commission_due,amount_settled,(commission_due+adjustments-amount_settled) balance FROM technician_settlements WHERE technician_id=$1 ORDER BY created_at DESC LIMIT 10'),
    notes: await one('SELECT n.note,n.created_at,u.name admin FROM technician_notes n LEFT JOIN admin_users u ON u.id=n.admin_id WHERE technician_id=$1 ORDER BY n.id DESC LIMIT 30'),
    activity: await one(`SELECT a.action,a.reason,a.created_at,u.name admin FROM audit_logs a LEFT JOIN admin_users u ON u.id=a.admin_id WHERE a.entity_type='technician' AND a.entity_id=$1 ORDER BY a.id DESC LIMIT 30`, [t.tech_code]),
  };
});

R('PATCH', '/technicians/' + TC, async (x) => {
  const t = await loadTech(x.params[0]), d = techData(x.body);
  try {
    await tx(async (c) => {
      const [sql, v] = build('upd', 'technicians', d, ['id', t.id]); await c.query(sql, v);
      if (Array.isArray(x.body.skills)) {
        const ids = await skillIds(c, x.body.skills);
        await c.query('DELETE FROM technician_skills WHERE technician_id=$1 AND NOT (category_id = ANY($2))', [t.id, ids]);
        for (const id of ids) await c.query('INSERT INTO technician_skills(technician_id,category_id,approved_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [t.id, id, x.admin.id]);
      }
      await audit(c, x, 'technician.edited', 'technician', t.tech_code);
    });
  } catch (e) { const m = dupMsg(e); if (m) throw new HttpError(409, m); throw e; }
  return { ok: true };
});

R('POST', '/technicians/' + TC + '/status', async (x) => {
  const t = await loadTech(x.params[0]), act = S(x.body.action, 20), reason = S(x.body.reason, 500);
  const rules = { activate: [['pending', 'inactive'], 'active', false], deactivate: [['active'], 'inactive', true], suspend: [['active', 'inactive', 'pending'], 'suspended', true], reinstate: [['suspended'], 'active', true] };
  const r = rules[act]; if (!r) throw bad('Unknown action');
  if (!r[0].includes(t.status)) throw bad(`Cannot ${act} a technician whose status is ${t.status}`);
  if (r[2] && reason.length < 3) throw bad('A reason is required');
  if (r[1] === 'active') {
    if (t.verification_status !== 'verified') throw bad('Only verified technicians can be activated');
    if (!(await Q('SELECT 1 FROM technician_agreements WHERE technician_id=$1', [t.id])).rowCount) throw bad('Record the accepted agreement first');
    if (!(await Q('SELECT 1 FROM technician_skills WHERE technician_id=$1 AND approved', [t.id])).rowCount) throw bad('Approve at least one skill first');
  }
  await tx(async (c) => { await c.query('UPDATE technicians SET status=$1, updated_at=now() WHERE id=$2', [r[1], t.id]); await audit(c, x, 'technician.' + act, 'technician', t.tech_code, reason, { from: t.status, to: r[1] }); });
  return { ok: true, status: r[1] };
});

R('POST', '/technicians/' + TC + '/verification', async (x) => {
  const t = await loadTech(x.params[0]), b = x.body, status = S(b.status, 20), reason = S(b.reason, 500);
  if (!['pending', 'under_review', 'verified', 'rejected'].includes(status)) throw bad('Invalid verification status');
  if (status === 'rejected' && reason.length < 3) throw bad('A reason is required to reject');
  const ch = CHECKS.map((k) => !!(b.checks || {})[k]), cur = (await Q('SELECT 1 FROM technician_agreements WHERE technician_id=$1', [t.id])).rowCount;
  if (status === 'verified') {
    if (!(ch[1] && ch[3])) throw bad('Identity must be checked and skills assessed before verifying');
    if (!cur) throw bad('Record the accepted agreement before verifying');
  }
  await tx(async (c) => {
    await c.query(`UPDATE technician_verifications SET ${CHECKS.map((k, i) => k + '=$' + (i + 1)).join(',')}, notes=$6, rejection_reason=$7, verified_at=$8, verified_by=$9, updated_at=now() WHERE technician_id=$10`,
      [...ch, opt(b.notes, 1000), status === 'rejected' ? reason : null, status === 'verified' ? new Date() : null, status === 'verified' ? x.admin.id : null, t.id]);
    await c.query('UPDATE technicians SET verification_status=$1, status=CASE WHEN $1 IN (\'rejected\',\'pending\',\'under_review\') AND status=\'active\' THEN \'inactive\' ELSE status END, updated_at=now() WHERE id=$2', [status, t.id]);
    await audit(c, x, 'technician.verification.' + status, 'technician', t.tech_code, reason || null);
  });
  return { ok: true };
});

R('POST', '/technicians/' + TC + '/agreement', async (x) => {
  const t = await loadTech(x.params[0]); if (!x.body.accepted) throw bad('Confirm that the technician accepted the agreement');
  const a = agreementData(x.body);
  await tx(async (c) => {
    await c.query('INSERT INTO technician_agreements(technician_id,version,commission_basis,commission_rate,settlement_schedule,recorded_by) VALUES($1,$2,$3,$4,$5,$6)', [t.id, a.version, a.commission_basis, a.commission_rate, a.settlement_schedule, x.admin.id]);
    await audit(c, x, 'technician.agreement', 'technician', t.tech_code, null, a);
  });
  return { ok: true };
});

R('POST', '/technicians/' + TC + '/notes', async (x) => {
  const t = await loadTech(x.params[0]), note = req(x.body.note, 'Note', 1000);
  await tx(async (c) => { await c.query('INSERT INTO technician_notes(technician_id,admin_id,note) VALUES($1,$2,$3)', [t.id, x.admin.id, note]); await audit(c, x, 'technician.note', 'technician', t.tech_code); });
  return { ok: true };
});

// ---------- Customer web app: OTP registration, password login, orders ----------
const customerCookie = (v, age = 28800) => cookie('qfb_customer', v, age);
const normalizeCustomerMobile = (v) => mob(v, 'Mobile number', true);
const twilioConfigured = () => !!(E.TWILIO_ACCOUNT_SID && E.TWILIO_AUTH_TOKEN && E.TWILIO_VERIFY_SERVICE_SID);
async function twilioVerify(mobile, code, start = false) {
  if (!twilioConfigured()) throw new HttpError(503, 'Mobile OTP is not configured yet. The site owner must configure the SMS verification provider.');
  const url = `https://verify.twilio.com/v2/Services/${encodeURIComponent(E.TWILIO_VERIFY_SERVICE_SID)}/${start ? 'Verifications' : 'VerificationCheck'}`;
  const params = new URLSearchParams(start ? { To: '+91' + mobile, Channel: 'sms' } : { To: '+91' + mobile, Code: code });
  const auth = Buffer.from(E.TWILIO_ACCOUNT_SID + ':' + E.TWILIO_AUTH_TOKEN).toString('base64');
  const resp = await fetch(url, { method: 'POST', headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 429) throw new HttpError(429, 'Please wait before requesting another OTP.');
    if (!start && resp.status >= 400) return false;
    throw new HttpError(502, 'The OTP provider could not process the request. Please try again later.');
  }
  return start ? true : data.status === 'approved';
}
R('GET', '/customer/catalog', async () => ({
  services: (await Q('SELECT id,name,description,inspection_fee,sort_order FROM service_categories WHERE is_active ORDER BY sort_order,name')).rows,
  service_area: 'Hailakandi, Assam', call_number: '8822951734', whatsapp_number: '9577792954'
}), 'pub');
R('POST', '/customer/auth/otp/start', async (x) => {
  const mobile = normalizeCustomerMobile(x.body.mobile);
  await twilioVerify(mobile, null, true);
  return { ok: true, message: 'OTP sent if the mobile number can receive SMS. It expires according to the verification provider settings.' };
}, 'pub');
R('POST', '/customer/auth/otp/verify', async (x) => {
  const mobile = normalizeCustomerMobile(x.body.mobile), code = req(x.body.code, 'OTP', 10);
  const ok = await twilioVerify(mobile, code, false);
  if (!ok) throw new HttpError(401, 'The OTP is invalid or expired. Request a new code and try again.');
  const existing = (await Q(`SELECT u.id,u.password_hash,u.is_active,c.id customer_id FROM users u LEFT JOIN customers c ON c.id=u.customer_id WHERE u.role='customer' AND u.mobile=$1 ORDER BY u.created_at LIMIT 1`, [mobile])).rows[0];
  if (existing && existing.password_hash) return { ok: true, existing_account: true, message: 'This number already has an account. Log in with your password or choose Forgot password.' };
  return { ok: true, enrollment_token: mkToken(mobile, 'enroll', 10 * 60e3), message: 'Mobile verified. Complete your profile and set a password.' };
}, 'pub');
R('POST', '/customer/register', async (x) => {
  const mobile = readToken(S(x.body.enrollment_token, 2000), 'enroll');
  if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) throw new HttpError(401, 'Your verification session expired. Verify your mobile number again.');
  const name = req(x.body.name, 'Full name', 120), address = req(x.body.address, 'Address', 300), locality = req(x.body.locality, 'Town / locality', 100), password = S(x.body.password, 200);
  if (password.length < 10) throw bad('Password must be at least 10 characters');
  return await tx(async (c) => {
    let cu = (await c.query('SELECT id FROM customers WHERE mobile=$1', [mobile])).rows[0];
    if (cu) await c.query('UPDATE customers SET name=$1,address=$2,locality=$3 WHERE id=$4', [name,address,locality,cu.id]);
    else cu = (await c.query('INSERT INTO customers(name,mobile,address,locality) VALUES($1,$2,$3,$4) RETURNING id', [name,mobile,address,locality])).rows[0];
    const prior = (await c.query("SELECT id,password_hash,is_active FROM users WHERE role='customer' AND (customer_id=$1 OR mobile=$2) ORDER BY created_at LIMIT 1", [cu.id,mobile])).rows[0];
    if (prior && prior.password_hash) throw new HttpError(409, 'An account already exists for this mobile number. Please log in instead.');
    let uid;
    if (prior) {
      if (!prior.is_active) throw new HttpError(403, 'This customer account is disabled. Contact support.');
      uid = prior.id;
      await c.query("UPDATE users SET customer_id=$1,mobile=$2,password_hash=$3,failed_attempts=0,locked_until=NULL,is_active=true,must_change_password=false WHERE id=$4", [cu.id,mobile,hashPw(password),uid]);
    } else uid = (await c.query("INSERT INTO users(role,mobile,customer_id,password_hash) VALUES('customer',$1,$2,$3) RETURNING id", [mobile,cu.id,hashPw(password)])).rows[0].id;
    await audit(c, { admin: null, ip: x.ip }, 'customer.registered', 'customer', cu.id, null, { mobile_verified: true });
    return { body: { ok: true, customer: { name, mobile, address, locality } }, cookie: customerCookie(mkToken(uid, 'c')) };
  });
}, 'pub');
R('POST', '/customer/auth/login', async (x) => {
  const mobile = normalizeCustomerMobile(x.body.mobile), password = S(x.body.password, 200);
  const u = (await Q("SELECT u.*,c.name,c.address,c.locality FROM users u JOIN customers c ON c.id=u.customer_id WHERE u.role='customer' AND u.mobile=$1 ORDER BY u.created_at LIMIT 1", [mobile])).rows[0];
  const fail = new HttpError(401, 'Incorrect mobile number or password');
  if (!u || !u.password_hash) { crypto.scryptSync(password || 'x', 'qfb-customer-login', 64); throw fail; }
  if (!u.is_active) throw new HttpError(403, 'This account is disabled. Please contact QuickFix Barak support.');
  if (u.locked_until && u.locked_until > new Date()) throw new HttpError(429, 'Too many attempts. Please try again in 15 minutes.');
  if (!checkPw(password, u.password_hash)) {
    await Q("UPDATE users SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts+1>=5 THEN now()+interval '15 minutes' END WHERE id=$1", [u.id]);
    throw fail;
  }
  await Q('UPDATE users SET failed_attempts=0,locked_until=NULL,last_login_at=now() WHERE id=$1', [u.id]);
  return { body: { ok: true, customer: { name:u.name,mobile:u.mobile,address:u.address,locality:u.locality } }, cookie: customerCookie(mkToken(u.id, 'c')) };
}, 'pub');
R('POST', '/customer/auth/forgot/verify', async (x) => {
  const mobile = normalizeCustomerMobile(x.body.mobile), code = req(x.body.code, 'OTP', 10);
  const ok = await twilioVerify(mobile, code, false);
  if (!ok) throw new HttpError(401, 'The OTP is invalid or expired.');
  const u = (await Q("SELECT id,is_active FROM users WHERE role='customer' AND mobile=$1 AND password_hash IS NOT NULL ORDER BY created_at LIMIT 1", [mobile])).rows[0];
  if (!u || !u.is_active) throw new HttpError(400, 'No active password account was found for this mobile number.');
  return { ok: true, reset_token: mkToken(u.id, 'reset', 10 * 60e3) };
}, 'pub');
R('POST', '/customer/auth/forgot/reset', async (x) => {
  const uid = readToken(S(x.body.reset_token, 2000), 'reset');
  if (!uid) throw new HttpError(401, 'Password reset session expired. Verify your mobile number again.');
  const pw = S(x.body.password, 200); if (pw.length < 10) throw bad('Password must be at least 10 characters');
  const r = await Q("UPDATE users SET password_hash=$1,failed_attempts=0,locked_until=NULL,must_change_password=false WHERE id=$2 AND role='customer' AND is_active RETURNING id", [hashPw(pw),uid]);
  if (!r.rowCount) throw new HttpError(401, 'Customer account not found or disabled');
  return { ok: true, message: 'Password updated. You can now log in.' };
}, 'pub');
R('POST', '/customer/logout', async () => ({ body: { ok: true }, cookie: customerCookie('', 0) }), 'pub');
R('GET', '/customer/me', async (x) => {
  const r = (await Q('SELECT c.id,c.name,c.mobile,c.email,c.address,c.locality,c.created_at FROM users u JOIN customers c ON c.id=u.customer_id WHERE u.id=$1 AND u.role=\'customer\' AND u.is_active', [x.customer.id])).rows[0];
  if (!r) throw new HttpError(401, 'Customer account not found'); return r;
}, 'customer');
R('POST', '/customer/auth/change-password', async (x) => {
  const current = S(x.body.current_password, 200), next = S(x.body.password, 200);
  if (next.length < 10) throw bad('New password must be at least 10 characters');
  const u = (await Q("SELECT id,password_hash FROM users WHERE id=$1 AND role='customer' AND is_active", [x.customer.id])).rows[0];
  if (!u || !u.password_hash || !checkPw(current, u.password_hash)) throw new HttpError(401, 'Current password is incorrect');
  await Q('UPDATE users SET password_hash=$1,failed_attempts=0,locked_until=NULL,must_change_password=false WHERE id=$2', [hashPw(next),u.id]);
  return { ok: true, message: 'Password updated successfully.' };
}, 'customer');
R('GET', '/customer/payments', async (x) => ({ rows: (await Q(`SELECT p.receipt_no,p.amount_collected,p.method,p.paid_at,b.booking_code,sc.name service,
  COALESCE((SELECT sum(pa.amount) FROM payment_adjustments pa WHERE pa.payment_id=p.id AND pa.kind='refund'),0) refunded
  FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN service_categories sc ON sc.id=b.category_id JOIN users u ON u.customer_id=b.customer_id AND u.role='customer'
  WHERE u.id=$1 ORDER BY p.paid_at DESC LIMIT 100`, [x.customer.id])).rows }), 'customer');
R('GET', '/customer/complaints', async (x) => ({ rows: (await Q(`SELECT co.id,co.description,co.status,co.resolution,co.created_at,b.booking_code,sc.name service
  FROM complaints co JOIN bookings b ON b.id=co.booking_id JOIN service_categories sc ON sc.id=b.category_id JOIN users u ON u.customer_id=b.customer_id AND u.role='customer'
  WHERE u.id=$1 ORDER BY co.created_at DESC LIMIT 100`, [x.customer.id])).rows }), 'customer');
R('POST', '/customer/bookings/' + BC + '/quote/(accepted|rejected)', async (x) => {
  const code=x.params[0], action=x.params[1];
  return await tx(async c=>{
    const b=(await c.query("SELECT b.id,b.booking_code FROM bookings b JOIN users u ON u.customer_id=b.customer_id AND u.role='customer' WHERE u.id=$1 AND b.booking_code=$2",[x.customer.id,code])).rows[0];
    if(!b) throw new HttpError(404,'Booking not found');
    const q=(await c.query("SELECT id,version,status FROM quotes WHERE booking_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE",[b.id])).rows[0];
    if(!q) throw new HttpError(404,'No quotation exists for this booking');
    if(q.status!=='pending') throw bad('This quotation is no longer awaiting your response');
    await c.query('UPDATE quotes SET status=$1,approved_at=CASE WHEN $1=\'accepted\' THEN now() ELSE approved_at END WHERE id=$2',[action,q.id]);
    if(action==='accepted') await c.query("UPDATE bookings SET work_status='quote_accepted',updated_at=now() WHERE id=$1 AND work_status IN ('quote_pending','diagnosing','assigned','confirmed','requested')",[b.id]);
    else await c.query("UPDATE bookings SET work_status='quote_rejected',updated_at=now() WHERE id=$1 AND work_status IN ('quote_pending','diagnosing','assigned','confirmed','requested')",[b.id]);
    await c.query("INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,reason,details,ip) VALUES(NULL,$1,'booking',$2,NULL,$3::jsonb,$4)",[ 'customer.quote.'+action,b.booking_code,JSON.stringify({version:q.version}),x.ip]);
    return {ok:true,status:action};
  });
}, 'customer');
R('POST', '/customer/bookings/' + BC + '/complaints', async (x) => {
  const description=req(x.body.description,'Complaint details',1000), booking=(await Q("SELECT b.id,b.booking_code FROM bookings b JOIN users u ON u.customer_id=b.customer_id AND u.role='customer' WHERE u.id=$1 AND b.booking_code=$2", [x.customer.id,x.params[0]])).rows[0];
  if(!booking) throw new HttpError(404,'Booking not found');
  const row=(await Q('INSERT INTO complaints(booking_id,description) VALUES($1,$2) RETURNING id,status,created_at',[booking.id,description])).rows[0];
  await Q("INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,reason,details,ip) VALUES(NULL,'customer.complaint.created','complaint',$1,NULL,$2::jsonb,$3)",[String(row.id),JSON.stringify({booking_code:booking.booking_code}),x.ip]);
  return row;
}, 'customer');
R('POST', '/customer/bookings/' + BC + '/review', async (x) => {
  const rating=intOrNull(x.body.rating,'Rating',1,5), comment=opt(x.body.comment,1000);
  const booking=(await Q("SELECT b.id,b.booking_code,b.work_status,a.technician_id FROM bookings b JOIN users u ON u.customer_id=b.customer_id AND u.role='customer' LEFT JOIN booking_assignments a ON a.booking_id=b.id AND a.is_current WHERE u.id=$1 AND b.booking_code=$2",[x.customer.id,x.params[0]])).rows[0];
  if(!booking) throw new HttpError(404,'Booking not found');
  if(booking.work_status!=='completed') throw bad('You can review a booking after it is completed');
  if(!booking.technician_id) throw bad('This booking has no assigned technician to review');
  if((await Q('SELECT 1 FROM reviews WHERE booking_id=$1',[booking.id])).rowCount) throw new HttpError(409,'A review has already been submitted for this booking');
  const row=(await Q('INSERT INTO reviews(booking_id,technician_id,rating,comment) VALUES($1,$2,$3,$4) RETURNING rating,comment,created_at',[booking.id,booking.technician_id,rating,comment])).rows[0];
  await Q("INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,reason,details,ip) VALUES(NULL,'customer.review.created','booking',$1,NULL,$2::jsonb,$3)",[booking.booking_code,JSON.stringify({rating}),x.ip]);
  return row;
}, 'customer');
R('GET', '/customer/bookings', async (x) => ({ rows: (await Q(`SELECT b.booking_code,b.work_status,b.payment_status,b.address,b.locality,b.preferred_at,b.created_at,b.updated_at,b.problem,sc.name service,t.full_name technician,t.mobile technician_mobile,
  (SELECT q.status FROM quotes q WHERE q.booking_id=b.id ORDER BY q.version DESC LIMIT 1) quote_status,
  (SELECT q.version FROM quotes q WHERE q.booking_id=b.id ORDER BY q.version DESC LIMIT 1) quote_version
  FROM bookings b JOIN service_categories sc ON sc.id=b.category_id JOIN customers c ON c.id=b.customer_id JOIN users u ON u.customer_id=c.id AND u.role='customer' LEFT JOIN booking_assignments a ON a.booking_id=b.id AND a.is_current LEFT JOIN technicians t ON t.id=a.technician_id
  WHERE u.id=$1 ORDER BY b.created_at DESC LIMIT 100`, [x.customer.id])).rows }), 'customer');
R('GET', '/customer/bookings/' + BC, async (x) => {
  const b = (await Q(`SELECT b.booking_code,b.work_status,b.payment_status,b.address,b.locality,b.preferred_at,b.created_at,b.updated_at,b.problem,b.inspection_fee,sc.name service,
    t.full_name technician,t.mobile technician_mobile,(SELECT q.status FROM quotes q WHERE q.booking_id=b.id ORDER BY q.version DESC LIMIT 1) quote_status
    FROM bookings b JOIN service_categories sc ON sc.id=b.category_id JOIN customers c ON c.id=b.customer_id JOIN users u ON u.customer_id=c.id AND u.role='customer'
    LEFT JOIN booking_assignments a ON a.booking_id=b.id AND a.is_current LEFT JOIN technicians t ON t.id=a.technician_id
    WHERE u.id=$1 AND b.booking_code=$2`, [x.customer.id,x.params[0]])).rows[0];
  if (!b) throw new HttpError(404, 'Booking not found');
  return { booking:b, quotes:(await Q(`SELECT q.version,q.status,q.created_at,q.approved_at,COALESCE(json_agg(json_build_object('description',i.description,'quantity',i.quantity,'unit_price',i.unit_price,'amount',i.amount) ORDER BY i.pos) FILTER (WHERE i.id IS NOT NULL),'[]') items FROM quotes q LEFT JOIN quote_items i ON i.quote_id=q.id JOIN bookings b ON b.id=q.booking_id JOIN customers c ON c.id=b.customer_id JOIN users u ON u.customer_id=c.id AND u.role='customer' WHERE u.id=$1 AND b.booking_code=$2 GROUP BY q.id ORDER BY q.version DESC`, [x.customer.id,x.params[0]])).rows };
}, 'customer');
R('POST', '/customer/bookings', async (x) => {
  const b=x.body, category=parseInt(b.category_id,10)||0, address=req(b.address,'Service address',300), locality=req(b.locality,'Town / locality',100), preferred=when(b.preferred_at), problem=req(b.problem,'Job details',1000);
  const cat=(await Q('SELECT id,inspection_fee FROM service_categories WHERE id=$1 AND is_active',[category])).rows[0]; if(!cat) throw bad('Choose an available service');
  return await tx(async c => {
    const customer=(await c.query("SELECT c.id,c.name,c.mobile FROM users u JOIN customers c ON c.id=u.customer_id WHERE u.id=$1 AND u.role='customer' AND u.is_active FOR UPDATE OF c",[x.customer.id])).rows[0];
    if(!customer) throw new HttpError(401,'Customer account not found');
    const booking=(await c.query("INSERT INTO bookings(customer_id,category_id,address,locality,preferred_at,inspection_fee,problem,source) VALUES($1,$2,$3,$4,$5,$6,$7,'customer_web') RETURNING booking_code,work_status,created_at",[customer.id,category,address,locality,preferred,cat.inspection_fee||0,problem])).rows[0];
    await c.query('UPDATE customers SET address=$1,locality=$2 WHERE id=$3',[address,locality,customer.id]);
    await audit(c,{admin:null,ip:x.ip},'customer.booking.created','booking',booking.booking_code,null,{source:'customer_web',category_id:category});
    return { booking_code:booking.booking_code,work_status:booking.work_status,created_at:booking.created_at,message:'Your order has been submitted. QuickFix Barak will review it and confirm availability.' };
  });
}, 'customer');

// ---------- automatic database upgrade (existing installs) ----------
const SCHEMA_VERSION = 4;
let upgraded;
function ensureSchema() {
  if (upgraded) return upgraded;
  upgraded = (async () => {
    const c = await db().connect();
    try {
      await c.query('SELECT pg_advisory_lock(727272)');
      if (!(await c.query("SELECT to_regclass('public.admin_users') t")).rows[0].t) return; // fresh install: use /setup.html
      const has = (await c.query("SELECT to_regclass('public.app_meta') t")).rows[0].t;
      const cur = has ? Number(((await c.query("SELECT value FROM app_meta WHERE key='schema_version'")).rows[0] || {}).value || 0) : 0;
      if (cur < SCHEMA_VERSION) { await c.query(SCHEMA); await c.query("INSERT INTO app_meta(key,value) VALUES('schema_version',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [String(SCHEMA_VERSION)]); }
    } finally { await c.query('SELECT pg_advisory_unlock(727272)').catch(() => {}); c.release(); }
  })().catch((e) => { upgraded = null; throw e; });
  return upgraded;
}
// ---------- Stage 2: service categories ----------
const PQ = { query: (...a) => Q(...a) };
const fee = (v) => { if (v === '' || v == null) return null; const n = Number(v); if (!(n >= 0 && n <= 100000)) throw bad('Inspection fee must be 0 or more'); return n; };
R('POST', '/categories', async (x) => {
  const b = x.body, name = req(b.name, 'Service name', 120);
  try {
    const r = await Q('INSERT INTO service_categories(name,description,inspection_fee,sort_order) VALUES($1,$2,$3,$4) RETURNING id', [name, opt(b.description, 300), fee(b.inspection_fee), intOrNull(b.sort_order, 'Sort order', 0, 999) || 0]);
    await audit(PQ, x, 'category.created', 'category', String(r.rows[0].id), null, { name }); return { id: r.rows[0].id };
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'A service with this name already exists'); throw e; }
});
R('PATCH', '/categories/(\\d+)', async (x) => {
  const id = +x.params[0], b = x.body, cur = (await Q('SELECT * FROM service_categories WHERE id=$1', [id])).rows[0];
  if (!cur) throw new HttpError(404, 'Service not found');
  const active = !!b.is_active, reason = S(b.reason, 300);
  if (cur.is_active && !active && reason.length < 3) throw bad('A reason is required to deactivate a service');
  try {
    await Q('UPDATE service_categories SET name=$1,description=$2,inspection_fee=$3,sort_order=$4,is_active=$5 WHERE id=$6', [req(b.name, 'Service name', 120), opt(b.description, 300), fee(b.inspection_fee), intOrNull(b.sort_order, 'Sort order', 0, 999) || 0, active, id]);
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'A service with this name already exists'); throw e; }
  await audit(PQ, x, cur.is_active && !active ? 'category.deactivated' : 'category.edited', 'category', String(id), reason || null); return { ok: true };
});

// ---------- Stage 2: technician portal access (admin side) ----------
const genPw = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 8; i++) s += a[crypto.randomInt(a.length)]; return s; };
R('POST', '/technicians/' + TC + '/login-access', async (x) => {
  const t = await loadTech(x.params[0]), act = S(x.body.action, 10);
  if (act === 'revoke') {
    await Q('UPDATE technicians SET login_enabled=false, password_hash=NULL WHERE id=$1', [t.id]);
    await audit(PQ, x, 'technician.login.revoke', 'technician', t.tech_code); return { ok: true };
  }
  if (act !== 'create' && act !== 'reset') throw bad('Unknown action');
  if (t.verification_status !== 'verified') throw bad('Verify the technician before enabling portal login');
  const pw = genPw();
  await Q('UPDATE technicians SET password_hash=$1,login_enabled=true,must_change_password=true,failed_attempts=0,locked_until=NULL WHERE id=$2', [hashPw(pw), t.id]);
  await audit(PQ, x, 'technician.login.' + act, 'technician', t.tech_code);
  return { password: pw, mobile: t.mobile, tech_code: t.tech_code, name: t.full_name };
});

// ---------- Stage 2: customers and bookings ----------
const BC = '(QF-\\d{3,})';
const SOURCES = ['whatsapp', 'phone', 'website', 'customer_web', 'admin_manual', 'walk_in', 'other'];
const when = (v) => { v = S(v, 25); if (!v) return null; if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) throw bad('Invalid date and time'); return v + ':00+05:30'; };
async function loadBooking(code) {
  const b = (await Q(`SELECT b.*,sc.name service,cu.name customer_name,cu.mobile customer_mobile,cu.email customer_email
    FROM bookings b JOIN service_categories sc ON sc.id=b.category_id JOIN customers cu ON cu.id=b.customer_id WHERE b.booking_code=$1`, [code])).rows[0];
  if (!b) throw new HttpError(404, 'Booking not found'); return b;
}
R('GET', '/customers/lookup', async (x) => {
  const m = mob(x.query.mobile, 'Mobile number', true);
  return (await Q('SELECT name,mobile,email,address,locality FROM customers WHERE mobile=$1', [m])).rows[0] || null;
});

R('GET', '/bookings', async (x) => {
  const q = x.query, w = [], p = [], add = (sql, v) => { p.push(v); w.push(sql.replace('?', '$' + p.length)); };
  if (q.q) { p.push('%' + S(q.q, 60).toLowerCase() + '%'); w.push(`(lower(b.booking_code) LIKE $${p.length} OR lower(cu.name) LIKE $${p.length} OR cu.mobile LIKE $${p.length})`); }
  if (q.status) add('b.work_status=?', S(q.status, 20));
  if (q.source) add('b.source=?', S(q.source, 30));
  if (q.category) add('b.category_id=?', parseInt(q.category, 10) || 0);
  if (q.area) add('lower(b.locality) LIKE ?', '%' + S(q.area, 60).toLowerCase() + '%');
  if (q.assignment === 'unassigned') w.push("a.id IS NULL AND b.work_status NOT IN ('completed','cancelled')");
  if (q.assignment === 'assigned') w.push('a.id IS NOT NULL');
  const base = `FROM bookings b JOIN customers cu ON cu.id=b.customer_id JOIN service_categories sc ON sc.id=b.category_id
    LEFT JOIN booking_assignments a ON a.booking_id=b.id AND a.is_current LEFT JOIN technicians t ON t.id=a.technician_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''}`;
  const page = Math.max(1, parseInt(q.page, 10) || 1), size = 15, total = Number((await Q('SELECT count(*) ' + base, p)).rows[0].count);
  const rows = (await Q(`SELECT b.booking_code,b.work_status,b.source,b.locality,b.preferred_at,b.created_at,cu.name customer,cu.mobile,sc.name service,t.tech_code,t.full_name tech_name ${base} ORDER BY b.created_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, p)).rows;
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / size)) };
});

R('POST', '/bookings', async (x) => {
  const b = x.body, name = req(b.name, 'Customer name', 120), mobile = mob(b.mobile, 'Customer mobile number', true), address = req(b.address, 'Address', 300), locality = req(b.locality, 'Town / locality', 100);
  const source = SOURCES.includes(b.source) ? b.source : 'whatsapp', cat = parseInt(b.category_id, 10) || 0, preferred = when(b.preferred_at);
  const email = S(b.email, 120); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email address is not valid');
  const c = (await Q('SELECT id,inspection_fee FROM service_categories WHERE id=$1 AND is_active', [cat])).rows[0];
  if (!c) throw bad('Choose a service');
  return await tx(async (cl) => {
    const cu = (await cl.query(`INSERT INTO customers(name,mobile,email,address,locality) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT (mobile) DO UPDATE SET name=EXCLUDED.name, address=EXCLUDED.address, locality=EXCLUDED.locality, email=COALESCE(EXCLUDED.email, customers.email) RETURNING id`, [name, mobile, email || null, address, locality])).rows[0];
    const bk = (await cl.query('INSERT INTO bookings(customer_id,category_id,address,locality,preferred_at,inspection_fee,problem,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING booking_code', [cu.id, cat, address, locality, preferred, c.inspection_fee || 0, opt(b.problem, 1000), source])).rows[0];
    await audit(cl, x, 'booking.created', 'booking', bk.booking_code, null, { source }); return { booking_code: bk.booking_code };
  });
});

R('GET', '/bookings/' + BC, async (x) => {
  const b = await loadBooking(x.params[0]);
  const hist = (await Q(`SELECT a.is_current,a.assigned_at,a.ended_at,a.reason,t.tech_code,t.full_name,t.mobile,u.name assigned_by FROM booking_assignments a JOIN technicians t ON t.id=a.technician_id LEFT JOIN admin_users u ON u.id=a.assigned_by WHERE a.booking_id=$1 ORDER BY a.assigned_at DESC`, [b.id])).rows;
  const act = (await Q(`SELECT a.action,a.reason,a.created_at,a.details,u.name admin FROM audit_logs a LEFT JOIN admin_users u ON u.id=a.admin_id WHERE a.entity_type='booking' AND a.entity_id=$1 ORDER BY a.id DESC LIMIT 40`, [b.booking_code])).rows;
  const cur = hist.find((h) => h.is_current) || null;
  return Object.assign({ booking: b, current: cur, history: hist, activity: act }, await bookingExtras(b, cur));
});

R('GET', '/bookings/' + BC + '/candidates', async (x) => {
  const b = await loadBooking(x.params[0]), area = S(x.query.area, 80) || b.locality || '';
  const rows = (await Q(`SELECT t.tech_code,t.full_name,t.mobile,t.locality,t.service_localities,t.availability,t.own_transport,
    (SELECT count(*) FROM booking_assignments a JOIN bookings k ON k.id=a.booking_id WHERE a.technician_id=t.id AND a.is_current AND k.work_status NOT IN ('completed','cancelled')) open_jobs,
    (SELECT count(*) FROM booking_assignments a JOIN bookings k ON k.id=a.booking_id WHERE a.technician_id=t.id AND a.is_current AND k.work_status NOT IN ('completed','cancelled') AND $3::timestamptz IS NOT NULL AND (k.preferred_at AT TIME ZONE 'Asia/Kolkata')::date = ($3::timestamptz AT TIME ZONE 'Asia/Kolkata')::date) same_day_jobs,
    (SELECT round(avg(rating),1) FROM reviews WHERE technician_id=t.id) rating,
    ($2 <> '' AND (lower(t.locality)=lower($2) OR lower(coalesce(t.service_localities,'')) LIKE '%'||lower($2)||'%')) area_match,
    EXISTS (SELECT 1 FROM booking_assignments a WHERE a.booking_id=$4 AND a.is_current AND a.technician_id=t.id) is_current
    FROM technicians t WHERE t.status='active' AND t.verification_status='verified'
    AND EXISTS (SELECT 1 FROM technician_skills s WHERE s.technician_id=t.id AND s.approved AND s.category_id=$1)
    ORDER BY area_match DESC, open_jobs ASC, rating DESC NULLS LAST, t.full_name`, [b.category_id, area, b.preferred_at, b.id])).rows;
  return { service: b.service, area, rows };
});

R('POST', '/bookings/' + BC + '/assign', async (x) => {
  const b = await loadBooking(x.params[0]);
  if (['completed', 'cancelled'].includes(b.work_status)) throw bad('This booking is ' + b.work_status + ' and cannot be assigned');
  const t = await loadTech(S(x.body.technician_code, 30).toUpperCase());
  if (t.status !== 'active' || t.verification_status !== 'verified') throw bad('Only active, verified technicians can be assigned');
  if (!(await Q('SELECT 1 FROM technician_skills WHERE technician_id=$1 AND category_id=$2 AND approved', [t.id, b.category_id])).rowCount) throw bad('This technician is not approved for ' + b.service);
  const cur = (await Q('SELECT id,technician_id FROM booking_assignments WHERE booking_id=$1 AND is_current', [b.id])).rows[0], reason = S(x.body.reason, 500);
  if (cur && cur.technician_id === t.id) throw bad('This technician is already assigned');
  if (cur && reason.length < 3) throw bad('A reason is required to reassign');
  await tx(async (c) => {
    if (cur) await c.query('UPDATE booking_assignments SET is_current=false, ended_at=now() WHERE id=$1', [cur.id]);
    await c.query('INSERT INTO booking_assignments(booking_id,technician_id,assigned_by,reason) VALUES($1,$2,$3,$4)', [b.id, t.id, x.admin.id, reason || null]);
    await c.query("UPDATE bookings SET work_status='assigned', updated_at=now() WHERE id=$1", [b.id]);
    await audit(c, x, cur ? 'booking.reassigned' : 'booking.assigned', 'booking', b.booking_code, reason || null, { technician: t.tech_code });
  });
  return { ok: true };
});

R('POST', '/bookings/' + BC + '/status', async (x) => {
  const b = await loadBooking(x.params[0]), st = S(x.body.status, 20), reason = S(x.body.reason, 500);
  const OK = ['requested', 'confirmed', 'en_route', 'arrived', 'diagnosing', 'quote_pending', 'quote_accepted', 'quote_rejected', 'in_progress', 'completed', 'cancelled', 'disputed'];
  if (!OK.includes(st)) throw bad('Invalid status');
  if (b.work_status === 'cancelled') throw bad('Cancelled bookings cannot be changed');
  if (b.work_status === 'completed' && st !== 'disputed') throw bad('Completed bookings can only be marked disputed');
  if (st === b.work_status) throw bad('The booking already has this status');
  if (['cancelled', 'disputed', 'quote_rejected'].includes(st) && reason.length < 3) throw bad('A reason is required');
  const hasA = (await Q('SELECT 1 FROM booking_assignments WHERE booking_id=$1 AND is_current', [b.id])).rowCount;
  if (!['requested', 'confirmed', 'cancelled', 'disputed'].includes(st) && !hasA) throw bad('Assign a technician first');
  if (hasA && ['requested', 'confirmed'].includes(st)) throw bad('A technician is already assigned. Reassign or cancel instead.');
  await tx(async (c) => {
    await c.query("UPDATE bookings SET work_status=$1, cancel_reason=CASE WHEN $1='cancelled' THEN $3 ELSE cancel_reason END, completed_at=CASE WHEN $1='completed' THEN now() ELSE completed_at END, updated_at=now() WHERE id=$2", [st, b.id, reason || null]);
    await audit(c, x, 'booking.status.' + st, 'booking', b.booking_code, reason || null, { from: b.work_status });
  });
  return { ok: true };
});

R('POST', '/bookings/' + BC + '/reschedule', async (x) => {
  const b = await loadBooking(x.params[0]), at = when(x.body.preferred_at), reason = S(x.body.reason, 500);
  if (!at) throw bad('Choose a new date and time');
  if (['completed', 'cancelled'].includes(b.work_status)) throw bad('This booking is ' + b.work_status);
  if (reason.length < 3) throw bad('A reason is required to reschedule');
  await tx(async (c) => { await c.query('UPDATE bookings SET preferred_at=$1, updated_at=now() WHERE id=$2', [at, b.id]); await audit(c, x, 'booking.rescheduled', 'booking', b.booking_code, reason, { to: at }); });
  return { ok: true };
});

// ---------- Stage 2: technician portal ----------
R('POST', '/tech/login', async (x) => {
  const raw = S(x.body.id, 40).toUpperCase().replace(/\s/g, ''), pw = S(x.body.password, 200), fail = new HttpError(401, 'Incorrect ID / mobile number or password');
  let col, val;
  if (/^QFB-TECH-\d+$/.test(raw)) { col = 'tech_code'; val = raw; } else { const m = raw.replace(/^(\+91|91)(?=\d{10}$)/, ''); if (!/^[6-9]\d{9}$/.test(m)) throw fail; col = 'mobile'; val = m; }
  const t = (await Q(`SELECT * FROM technicians WHERE ${col}=$1`, [val])).rows[0];
  if (!t || !t.login_enabled || !t.password_hash) { crypto.scryptSync(pw, 'x', 64); throw fail; }
  if (t.locked_until && t.locked_until > new Date()) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  if (!checkPw(pw, t.password_hash)) { await Q("UPDATE technicians SET failed_attempts=failed_attempts+1, locked_until=CASE WHEN failed_attempts+1>=5 THEN now()+interval '15 minutes' END WHERE id=$1", [t.id]); throw fail; }
  if (t.status !== 'active' || t.verification_status !== 'verified') throw new HttpError(403, 'Your account is not active. Please contact QuickFix Barak.');
  await Q('UPDATE technicians SET failed_attempts=0, locked_until=NULL, last_login_at=now() WHERE id=$1', [t.id]);
  await audit(PQ, { admin: null, ip: x.ip }, 'technician.login', 'technician', t.tech_code, null, { actor: 'technician' });
  return { body: { name: t.full_name, tech_code: t.tech_code, must_change: t.must_change_password }, cookie: cookie('qfb_tech', mkToken(t.id, 't'), 28800) };
}, 'pub');
R('POST', '/tech/logout', async () => ({ body: { ok: true }, cookie: cookie('qfb_tech', '', 0) }), 'pub');
R('GET', '/tech/me', async (x) => ({ name: x.tech.full_name, tech_code: x.tech.tech_code, must_change: x.tech.must_change_password }), 'tech');
R('POST', '/tech/password', async (x) => {
  const t = (await Q('SELECT password_hash FROM technicians WHERE id=$1', [x.tech.id])).rows[0], cur = S(x.body.current, 200), np = S(x.body.password, 200);
  if (!checkPw(cur, t.password_hash)) throw bad('Current password is incorrect');
  if (np.length < 8) throw bad('New password must be at least 8 characters');
  if (np === cur) throw bad('Choose a different password');
  await Q('UPDATE technicians SET password_hash=$1, must_change_password=false WHERE id=$2', [hashPw(np), x.tech.id]);
  await audit(PQ, { admin: null, ip: x.ip }, 'technician.password.changed', 'technician', x.tech.tech_code, null, { actor: 'technician' });
  return { ok: true };
}, 'tech');
R('GET', '/tech/jobs', async (x) => {
  const done = x.query.scope === 'done';
  return (await Q(`SELECT b.booking_code,b.work_status,b.address,b.locality,b.preferred_at,b.problem,b.inspection_fee,sc.name service,cu.name customer_name,
    CASE WHEN b.work_status IN ('completed','cancelled') THEN NULL ELSE cu.mobile END customer_mobile,
    COALESCE((SELECT sum(amount_collected) FROM payments p WHERE p.booking_id=b.id),0) paid,
    (SELECT q.status FROM quotes q WHERE q.booking_id=b.id ORDER BY q.version DESC LIMIT 1) quote_status,
    (SELECT COALESCE(sum(qi.qty*qi.unit_price),0) FROM quotes q JOIN quote_items qi ON qi.quote_id=q.id WHERE q.id=(SELECT q2.id FROM quotes q2 WHERE q2.booking_id=b.id ORDER BY q2.version DESC LIMIT 1)) quote_total
    FROM booking_assignments a JOIN bookings b ON b.id=a.booking_id JOIN customers cu ON cu.id=b.customer_id JOIN service_categories sc ON sc.id=b.category_id
    WHERE a.technician_id=$1 AND a.is_current AND b.work_status ${done ? '' : 'NOT '}IN ('completed','cancelled')
    ORDER BY ${done ? 'b.updated_at DESC' : 'b.preferred_at NULLS LAST, b.created_at'} LIMIT 50`, [x.tech.id])).rows;
}, 'tech');
const TNEXT = { assigned: ['en_route'], en_route: ['arrived'], arrived: ['diagnosing', 'in_progress'], diagnosing: ['in_progress'], quote_accepted: ['in_progress'], in_progress: ['completed'] };
R('POST', '/tech/jobs/(QF-\\d+)/status', async (x) => {
  const code = x.params[0], st = S(x.body.status, 20), note = opt(x.body.note, 500);
  const b = (await Q('SELECT b.id,b.work_status FROM bookings b JOIN booking_assignments a ON a.booking_id=b.id AND a.is_current WHERE b.booking_code=$1 AND a.technician_id=$2', [code, x.tech.id])).rows[0];
  if (!b) throw new HttpError(404, 'Job not found');
  if (!(TNEXT[b.work_status] || []).includes(st)) throw bad('That step is not available right now');
  await tx(async (c) => {
    await c.query("UPDATE bookings SET work_status=$1, completed_at=CASE WHEN $1='completed' THEN now() ELSE completed_at END, updated_at=now() WHERE id=$2", [st, b.id]);
    await audit(c, { admin: null, ip: x.ip }, 'booking.status.' + st, 'booking', code, note, { actor: 'technician', tech_code: x.tech.tech_code, from: b.work_status });
  });
  return { ok: true, status: st };
}, 'tech');

// ---------- Stage 3: quotes, payments, commission, settlements ----------
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v, label, max = 1000000) => { if (v === '' || v == null) return 0; const n = Number(v); if (!(n >= 0 && n <= max)) throw bad(label + ' must be 0 or more'); return round2(n); };
const IST = "AT TIME ZONE 'Asia/Kolkata'";
const METHODS = ['cash', 'upi', 'bank', 'other'];
const dateParam = (v, d) => { v = S(v, 10); if (!v) return d; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad('Invalid date'); return v; };

async function bookingExtras(b, cur) {
  const qr = (await Q('SELECT * FROM quotes WHERE booking_id=$1 ORDER BY version DESC LIMIT 1', [b.id])).rows[0];
  let quote = null;
  if (qr) { const items = (await Q('SELECT kind,description,qty,unit_price FROM quote_items WHERE quote_id=$1 ORDER BY pos', [qr.id])).rows; quote = { id: qr.id, version: qr.version, status: qr.status, approved_at: qr.approved_at, items, total: round2(items.reduce((a, i) => a + Number(i.qty) * Number(i.unit_price), 0)) }; }
  const payments = (await Q(`SELECT p.receipt_no,p.paid_at,p.method,p.labour_amount,p.parts_amount,p.discount,p.amount_collected,t.tech_code,l.commission_amount commission,l.technician_share,
    COALESCE((SELECT sum(amount) FROM payment_adjustments ad WHERE ad.payment_id=p.id AND ad.kind='refund'),0) refunded
    FROM payments p JOIN technicians t ON t.id=p.technician_id LEFT JOIN technician_commission_ledger l ON l.payment_id=p.id AND l.entry_type='commission' WHERE p.booking_id=$1 ORDER BY p.paid_at DESC`, [b.id])).rows;
  const review = (await Q('SELECT rating,comment,created_at FROM reviews WHERE booking_id=$1 LIMIT 1', [b.id])).rows[0] || null;
  const complaints = (await Q('SELECT id,description,status,resolution,created_at FROM complaints WHERE booking_id=$1 ORDER BY created_at DESC', [b.id])).rows;
  const agreement = cur ? (await Q('SELECT a.commission_basis,a.commission_rate FROM technician_agreements a JOIN technicians t ON t.id=a.technician_id WHERE t.tech_code=$1 ORDER BY a.accepted_at DESC LIMIT 1', [cur.tech_code])).rows[0] || null : null;
  return { quote, payments, review, complaints, agreement };
}

const QKINDS = ['labour', 'parts', 'travel', 'other'];
R('POST', '/bookings/' + BC + '/quote', async (x) => {
  const b = await loadBooking(x.params[0]);
  if (['completed', 'cancelled'].includes(b.work_status)) throw bad('This booking is ' + b.work_status);
  const items = (Array.isArray(x.body.items) ? x.body.items : []).slice(0, 30).map((i) => ({ kind: S(i.kind, 10), description: S(i.description, 200), qty: Number(i.qty || 1), price: Number(i.unit_price) })).filter((i) => i.description);
  if (!items.length) throw bad('Add at least one line');
  items.forEach((i) => { if (!QKINDS.includes(i.kind)) throw bad('Invalid line type'); if (!(i.qty > 0 && i.qty <= 10000)) throw bad('Quantity must be more than 0'); if (!(i.price >= 0 && i.price <= 1000000)) throw bad('Price must be 0 or more'); });
  await tx(async (c) => {
    await c.query("UPDATE quotes SET status='superseded' WHERE booking_id=$1 AND status IN ('pending','accepted')", [b.id]);
    const v = Number((await c.query('SELECT COALESCE(max(version),0)+1 v FROM quotes WHERE booking_id=$1', [b.id])).rows[0].v);
    const q = (await c.query('INSERT INTO quotes(booking_id,version) VALUES($1,$2) RETURNING id', [b.id, v])).rows[0];
    for (let k = 0; k < items.length; k++) await c.query('INSERT INTO quote_items(quote_id,kind,description,qty,unit_price,pos) VALUES($1,$2,$3,$4,$5,$6)', [q.id, items[k].kind, items[k].description, items[k].qty, items[k].price, k]);
    await c.query("UPDATE bookings SET work_status='quote_pending', updated_at=now() WHERE id=$1 AND work_status IN ('arrived','diagnosing','quote_rejected','quote_pending')", [b.id]);
    await audit(c, x, 'booking.quote.created', 'booking', b.booking_code, null, { version: v });
  });
  return { ok: true };
});
R('POST', '/bookings/' + BC + '/quote/(accepted|rejected)', async (x) => {
  const b = await loadBooking(x.params[0]), st = x.params[1], reason = S(x.body.reason, 500);
  const q = (await Q('SELECT id,status FROM quotes WHERE booking_id=$1 ORDER BY version DESC LIMIT 1', [b.id])).rows[0];
  if (!q || q.status !== 'pending') throw bad('There is no pending quote');
  if (st === 'rejected' && reason.length < 3) throw bad('A reason is required');
  await tx(async (c) => {
    await c.query('UPDATE quotes SET status=$1, approved_at=CASE WHEN $1=\'accepted\' THEN now() END WHERE id=$2', [st, q.id]);
    await c.query("UPDATE bookings SET work_status=CASE WHEN work_status IN ('completed','cancelled','disputed','in_progress') THEN work_status ELSE $1 END, updated_at=now() WHERE id=$2", ['quote_' + st, b.id]);
    await audit(c, x, 'booking.quote.' + st, 'booking', b.booking_code, reason || null);
  });
  return { ok: true };
});

async function recordPayment(c, x, actor, b, tech, d) {
  const labour = num(d.labour, 'Labour'), parts = num(d.parts, 'Parts'), discount = num(d.discount, 'Discount'), collected = num(d.collected, 'Amount collected');
  if (!(collected > 0)) throw bad('Enter the amount collected');
  const method = S(d.method, 10); if (!METHODS.includes(method)) throw bad('Choose a payment method');
  const ag = (await c.query('SELECT * FROM technician_agreements WHERE technician_id=$1 ORDER BY accepted_at DESC LIMIT 1', [tech.id])).rows[0];
  if (!ag) throw bad('No accepted agreement on file for this technician. Record the agreement first.');
  const rate = Number(ag.commission_rate); let base = null, comm = null;
  if (ag.commission_basis === 'labour_only') { base = Math.max(labour - discount, 0); comm = round2(base * rate / 100); }
  else if (ag.commission_basis === 'labour_and_parts') { base = Math.max(labour + parts - discount, 0); comm = round2(base * rate / 100); }
  else if (ag.commission_basis === 'fixed_per_job') comm = rate;
  if (actor === 'admin' && d.commission_override !== '' && d.commission_override != null) comm = num(d.commission_override, 'Commission');
  if (comm == null) throw bad('This technician has a custom commission rule. The office must enter the commission amount.');
  comm = Math.min(comm, collected);
  const receipt = (await c.query("SELECT 'QFR-' || to_char(now() AT TIME ZONE 'Asia/Kolkata','YYMM') || '-' || lpad(nextval('receipt_seq')::text,5,'0') AS r")).rows[0].r;
  const pay = (await c.query('INSERT INTO payments(booking_id,technician_id,receipt_no,labour_amount,parts_amount,discount,amount_collected,method,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [b.id, tech.id, receipt, labour, parts, discount, collected, method, actor === 'admin' ? x.admin.id : null])).rows[0];
  await c.query('INSERT INTO technician_commission_ledger(technician_id,payment_id,booking_id,entry_type,basis_amount,rate,commission_amount,technician_share,parts_reimbursable) VALUES($1,$2,$3,\'commission\',$4,$5,$6,$7,$8)', [tech.id, pay.id, b.id, base, rate, comm, round2(collected - comm), ag.commission_basis === 'labour_only' ? parts : 0]);
  const tot = Number((await c.query('SELECT COALESCE(sum(amount_collected),0) t FROM payments WHERE booking_id=$1', [b.id])).rows[0].t);
  const qt = Number((await c.query("SELECT COALESCE(sum(qi.qty*qi.unit_price),0) t FROM quotes q JOIN quote_items qi ON qi.quote_id=q.id WHERE q.booking_id=$1 AND q.status='accepted'", [b.id])).rows[0].t);
  await c.query("UPDATE bookings SET payment_status=$1, settlement_status='due', updated_at=now() WHERE id=$2", [qt > 0 && tot < qt ? 'partial' : 'paid', b.id]);
  await audit(c, actor === 'admin' ? x : { admin: null, ip: x.ip }, 'payment.recorded', 'booking', b.booking_code, null, { receipt, collected, commission: comm, actor: actor === 'admin' ? 'admin' : 'technician', tech_code: tech.tech_code });
  return { receipt_no: receipt, commission: comm, technician_share: round2(collected - comm) };
}
R('POST', '/bookings/' + BC + '/payment', async (x) => {
  const b = await loadBooking(x.params[0]);
  if (['requested', 'confirmed', 'cancelled'].includes(b.work_status)) throw bad('Payment can be recorded once a technician is assigned and the job is under way');
  const tech = (await Q('SELECT t.* FROM booking_assignments a JOIN technicians t ON t.id=a.technician_id WHERE a.booking_id=$1 AND a.is_current', [b.id])).rows[0];
  if (!tech) throw bad('Assign a technician first');
  return await tx((c) => recordPayment(c, x, 'admin', b, tech, x.body));
});
R('POST', '/tech/jobs/(QF-\\d+)/payment', async (x) => {
  const b = (await Q('SELECT b.* FROM bookings b JOIN booking_assignments a ON a.booking_id=b.id AND a.is_current WHERE b.booking_code=$1 AND a.technician_id=$2', [x.params[0], x.tech.id])).rows[0];
  if (!b) throw new HttpError(404, 'Job not found');
  if (!['in_progress', 'completed'].includes(b.work_status)) throw bad('Record payment after the work has started');
  if ((await Q('SELECT 1 FROM payments WHERE booking_id=$1', [b.id])).rowCount) throw bad('A payment is already recorded for this job. Contact the office to change it.');
  const tech = (await Q('SELECT * FROM technicians WHERE id=$1', [x.tech.id])).rows[0];
  return await tx((c) => recordPayment(c, x, 'tech', b, tech, Object.assign({}, x.body, { commission_override: null })));
}, 'tech');

R('POST', '/payments/(QFR-\\d{4}-\\d+)/refund', async (x) => {
  const p = (await Q('SELECT p.*,b.booking_code FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE p.receipt_no=$1', [x.params[0]])).rows[0];
  if (!p) throw new HttpError(404, 'Payment not found');
  const amt = num(x.body.amount, 'Refund amount'), reason = S(x.body.reason, 500);
  if (!(amt > 0)) throw bad('Enter the refund amount'); if (reason.length < 3) throw bad('A reason is required');
  const done = Number((await Q("SELECT COALESCE(sum(amount),0) t FROM payment_adjustments WHERE payment_id=$1 AND kind='refund'", [p.id])).rows[0].t);
  if (amt > Number(p.amount_collected) - done + 0.001) throw bad('Refund is more than the amount still refundable (' + round2(Number(p.amount_collected) - done) + ')');
  await tx(async (c) => {
    await c.query("INSERT INTO payment_adjustments(payment_id,kind,amount,reason,created_by) VALUES($1,'refund',$2,$3,$4)", [p.id, amt, reason, x.admin.id]);
    const l = (await c.query("SELECT commission_amount FROM technician_commission_ledger WHERE payment_id=$1 AND entry_type='commission'", [p.id])).rows[0];
    const rev = l ? -round2(Number(l.commission_amount) * amt / Number(p.amount_collected)) : 0;
    await c.query("INSERT INTO technician_commission_ledger(technician_id,payment_id,booking_id,entry_type,commission_amount,technician_share,note) VALUES($1,$2,$3,'refund_reversal',$4,$5,$6)", [p.technician_id, p.id, p.booking_id, rev, -round2(amt + rev), 'Refund: ' + reason]);
    if (done + amt >= Number(p.amount_collected) - 0.001) await c.query("UPDATE bookings SET payment_status='refunded' WHERE id=$1", [p.booking_id]);
    await audit(c, x, 'payment.refunded', 'booking', p.booking_code, reason, { receipt: p.receipt_no, amount: amt });
  });
  return { ok: true };
});

R('GET', '/payments', async (x) => {
  const q = x.query, w = [], p = [], add = (s, v) => { p.push(v); w.push(s.replace('?', '$' + p.length)); };
  if (q.q) { p.push('%' + S(q.q, 60).toLowerCase() + '%'); w.push(`(lower(p.receipt_no) LIKE $${p.length} OR lower(b.booking_code) LIKE $${p.length} OR lower(t.tech_code) LIKE $${p.length} OR lower(t.full_name) LIKE $${p.length})`); }
  if (q.method) add('p.method=?', S(q.method, 10));
  if (q.from) add(`(p.paid_at ${IST})::date >= ?::date`, dateParam(q.from));
  if (q.to) add(`(p.paid_at ${IST})::date <= ?::date`, dateParam(q.to));
  const base = `FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN technicians t ON t.id=p.technician_id LEFT JOIN technician_commission_ledger l ON l.payment_id=p.id AND l.entry_type='commission' ${w.length ? 'WHERE ' + w.join(' AND ') : ''}`;
  const page = Math.max(1, parseInt(q.page, 10) || 1), size = 20, agg = (await Q('SELECT count(*) n, COALESCE(sum(p.amount_collected),0) collected, COALESCE(sum(l.commission_amount),0) commission ' + base, p)).rows[0];
  const rows = (await Q(`SELECT p.receipt_no,p.paid_at,p.method,p.amount_collected,b.booking_code,t.tech_code,t.full_name tech_name,l.commission_amount commission,l.technician_share,COALESCE((SELECT sum(amount) FROM payment_adjustments ad WHERE ad.payment_id=p.id AND ad.kind='refund'),0) refunded ${base} ORDER BY p.paid_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, p)).rows;
  const total = Number(agg.n); return { rows, total, page, pages: Math.max(1, Math.ceil(total / size)), collected: Number(agg.collected), commission: Number(agg.commission) };
});

R('POST', '/technicians/' + TC + '/adjustments', async (x) => {
  const t = await loadTech(x.params[0]), amt = Number(x.body.amount), reason = S(x.body.reason, 500);
  if (!(Math.abs(amt) > 0 && Math.abs(amt) <= 1000000)) throw bad('Enter an adjustment amount (use a minus sign to reduce what the technician owes)');
  if (reason.length < 3) throw bad('A reason is required');
  await tx(async (c) => { await c.query("INSERT INTO technician_commission_ledger(technician_id,entry_type,commission_amount,note) VALUES($1,'adjustment',$2,$3)", [t.id, round2(amt), reason]); await audit(c, x, 'technician.ledger.adjustment', 'technician', t.tech_code, reason, { amount: round2(amt) }); });
  return { ok: true };
});

const SETUUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
R('GET', '/settlements/unsettled', async () => (await Q(`SELECT t.tech_code,t.full_name,count(*) entries,sum(l.commission_amount) amount FROM technician_commission_ledger l JOIN technicians t ON t.id=l.technician_id
  WHERE NOT EXISTS (SELECT 1 FROM settlement_items si WHERE si.ledger_id=l.id) GROUP BY t.id HAVING sum(l.commission_amount) <> 0 ORDER BY amount DESC`)).rows);
R('GET', '/settlements', async (x) => {
  const q = x.query, w = [], p = [];
  if (q.status === 'overdue') w.push("s.status IN ('pending','submitted','rejected') AND s.due_date < (now() AT TIME ZONE 'Asia/Kolkata')::date"); else if (q.status) { p.push(S(q.status, 12)); w.push('s.status=$' + p.length); }
  if (q.q) { p.push('%' + S(q.q, 60).toLowerCase() + '%'); w.push(`(lower(t.tech_code) LIKE $${p.length} OR lower(t.full_name) LIKE $${p.length})`); }
  const base = `FROM technician_settlements s JOIN technicians t ON t.id=s.technician_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''}`;
  const page = Math.max(1, parseInt(q.page, 10) || 1), size = 20, total = Number((await Q('SELECT count(*) ' + base, p)).rows[0].count);
  const rows = (await Q(`SELECT s.id,s.status,s.due_date,s.commission_due,s.amount_settled,s.submitted_amount,s.created_at,t.tech_code,t.full_name, (s.commission_due+s.adjustments-s.amount_settled) balance ${base} ORDER BY s.created_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, p)).rows;
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / size)) };
});
R('POST', '/technicians/' + TC + '/settlements', async (x) => {
  const t = await loadTech(x.params[0]);
  const ag = (await Q('SELECT settlement_schedule FROM technician_agreements WHERE technician_id=$1 ORDER BY accepted_at DESC LIMIT 1', [t.id])).rows[0];
  const days = x.body.due_date ? null : ({ daily: 1, weekly: 7, fortnightly: 14 }[ag && ag.settlement_schedule] || 7);
  const due = x.body.due_date ? dateParam(x.body.due_date) : null;
  return await tx(async (c) => {
    const ent = (await c.query('SELECT l.id,l.commission_amount,l.payment_id,l.entry_type,l.created_at FROM technician_commission_ledger l WHERE l.technician_id=$1 AND NOT EXISTS (SELECT 1 FROM settlement_items si WHERE si.ledger_id=l.id) FOR UPDATE', [t.id])).rows;
    const sum = round2(ent.reduce((a, e) => a + Number(e.commission_amount), 0));
    if (!ent.length || !(sum > 0)) throw bad('Nothing to settle right now');
    const pids = ent.filter((e) => e.payment_id && e.entry_type === 'commission').map((e) => e.payment_id);
    const coll = pids.length ? Number((await c.query("SELECT COALESCE(sum(amount_collected),0) - COALESCE((SELECT sum(amount) FROM payment_adjustments WHERE kind='refund' AND payment_id = ANY($1)),0) t FROM payments WHERE id = ANY($1)", [pids])).rows[0].t) : 0;
    const dates = ent.map((e) => e.created_at), mn = new Date(Math.min.apply(null, dates)), mx = new Date(Math.max.apply(null, dates));
    const st = (await c.query(`INSERT INTO technician_settlements(technician_id,period_from,period_to,due_date,total_collected,commission_due) VALUES($1,$2,$3,${due ? '$5::date' : "((now() AT TIME ZONE 'Asia/Kolkata')::date + $5::int)"},$4,$6) RETURNING id`, [t.id, mn.toISOString().slice(0, 10), mx.toISOString().slice(0, 10), round2(coll), due || days, sum])).rows[0];
    for (const e of ent) await c.query('INSERT INTO settlement_items(settlement_id,ledger_id,amount) VALUES($1,$2,$3)', [st.id, e.id, e.commission_amount]);
    await audit(c, x, 'settlement.created', 'technician', t.tech_code, null, { settlement: st.id, commission_due: sum, entries: ent.length });
    return { id: st.id, commission_due: sum };
  });
});
R('GET', '/settlements/' + SETUUID, async (x) => {
  const s = (await Q(`SELECT s.*,(s.commission_due+s.adjustments-s.amount_settled) balance,t.tech_code,t.full_name,t.mobile,u.name verified_by_name FROM technician_settlements s JOIN technicians t ON t.id=s.technician_id LEFT JOIN admin_users u ON u.id=s.verified_by WHERE s.id=$1`, [x.params[0]])).rows[0];
  if (!s) throw new HttpError(404, 'Settlement not found');
  const items = (await Q(`SELECT l.entry_type,l.commission_amount,l.note,l.created_at,b.booking_code,p.receipt_no,p.amount_collected FROM settlement_items si JOIN technician_commission_ledger l ON l.id=si.ledger_id LEFT JOIN bookings b ON b.id=l.booking_id LEFT JOIN payments p ON p.id=l.payment_id WHERE si.settlement_id=$1 ORDER BY l.created_at`, [s.id])).rows;
  const act = (await Q(`SELECT a.action,a.reason,a.created_at,u.name admin FROM audit_logs a LEFT JOIN admin_users u ON u.id=a.admin_id WHERE a.entity_type='settlement' AND a.entity_id=$1 ORDER BY a.id DESC`, [s.id])).rows;
  return { settlement: s, items, activity: act };
});
R('POST', '/settlements/' + SETUUID + '/verify', async (x) => {
  const s = (await Q('SELECT * FROM technician_settlements WHERE id=$1', [x.params[0]])).rows[0];
  if (!s) throw new HttpError(404, 'Settlement not found'); if (s.status === 'verified') throw bad('This settlement is already verified');
  const amt = num(x.body.amount, 'Amount received'), method = S(x.body.method, 10), ref = S(x.body.reference, 100);
  if (!(amt > 0)) throw bad('Enter the amount you received'); if (!METHODS.includes(method)) throw bad('Choose how it was paid');
  if (method !== 'cash' && ref.length < 3) throw bad('Enter the transfer or UPI reference number');
  await tx(async (c) => {
    await c.query("UPDATE technician_settlements SET status='verified', amount_settled=$1, method=$2, reference=$3, verified_by=$4, verified_at=now(), reject_reason=NULL WHERE id=$5", [amt, method, ref || null, x.admin.id, s.id]);
    await audit(c, x, 'settlement.verified', 'settlement', s.id, null, { amount: amt, method, reference: ref });
  });
  return { ok: true };
});
R('POST', '/settlements/' + SETUUID + '/reject', async (x) => {
  const s = (await Q('SELECT * FROM technician_settlements WHERE id=$1', [x.params[0]])).rows[0], reason = S(x.body.reason, 500);
  if (!s) throw new HttpError(404, 'Settlement not found'); if (s.status !== 'submitted') throw bad('Only a submitted settlement can be rejected');
  if (reason.length < 3) throw bad('A reason is required');
  await tx(async (c) => { await c.query("UPDATE technician_settlements SET status='rejected', reject_reason=$1 WHERE id=$2", [reason, s.id]); await audit(c, x, 'settlement.rejected', 'settlement', s.id, reason); });
  return { ok: true };
});

// technician side of money
R('GET', '/tech/money', async (x) => {
  const t = x.tech.id;
  const tot = (await Q("SELECT COALESCE((SELECT sum(commission_amount) FROM technician_commission_ledger WHERE technician_id=$1),0) owed, COALESCE((SELECT sum(amount_settled) FROM technician_settlements WHERE technician_id=$1 AND status='verified'),0) settled, COALESCE((SELECT sum(l.commission_amount) FROM technician_commission_ledger l WHERE l.technician_id=$1 AND NOT EXISTS (SELECT 1 FROM settlement_items si WHERE si.ledger_id=l.id)),0) unsettled, COALESCE((SELECT sum(amount_collected) FROM payments WHERE technician_id=$1),0) collected", [t])).rows[0];
  const settlements = (await Q('SELECT id,status,due_date,commission_due,amount_settled,submitted_amount,reject_reason,(commission_due+adjustments-amount_settled) balance FROM technician_settlements WHERE technician_id=$1 ORDER BY created_at DESC LIMIT 15', [t])).rows;
  return { collected: Number(tot.collected), owed: Number(tot.owed), settled: Number(tot.settled), outstanding: Number(tot.owed) - Number(tot.settled), unsettled: Number(tot.unsettled), settlements };
}, 'tech');
R('POST', '/tech/settlements/' + SETUUID + '/submit', async (x) => {
  const s = (await Q('SELECT * FROM technician_settlements WHERE id=$1 AND technician_id=$2', [x.params[0], x.tech.id])).rows[0];
  if (!s) throw new HttpError(404, 'Settlement not found'); if (!['pending', 'rejected'].includes(s.status)) throw bad('This settlement cannot be submitted');
  const amt = num(x.body.amount, 'Amount'), method = S(x.body.method, 10), ref = S(x.body.reference, 100);
  if (!(amt > 0)) throw bad('Enter the amount you sent'); if (!METHODS.includes(method)) throw bad('Choose how you paid');
  if (method !== 'cash' && ref.length < 3) throw bad('Enter the UPI or transfer reference number');
  await tx(async (c) => { await c.query("UPDATE technician_settlements SET status='submitted', submitted_amount=$1, submitted_at=now(), method=$2, reference=$3, reject_reason=NULL WHERE id=$4", [amt, method, ref || null, s.id]); await audit(c, { admin: null, ip: x.ip }, 'settlement.submitted', 'settlement', s.id, null, { actor: 'technician', tech_code: x.tech.tech_code, amount: amt }); });
  return { ok: true };
}, 'tech');

// ---------- Stage 3: feedback and complaints ----------
R('POST', '/bookings/' + BC + '/review', async (x) => {
  const b = await loadBooking(x.params[0]), r = parseInt(x.body.rating, 10);
  if (!(r >= 1 && r <= 5)) throw bad('Rating must be 1 to 5');
  const cur = (await Q('SELECT technician_id FROM booking_assignments WHERE booking_id=$1 AND is_current', [b.id])).rows[0]; if (!cur) throw bad('No technician was assigned to this booking');
  if ((await Q('SELECT 1 FROM reviews WHERE booking_id=$1', [b.id])).rowCount) throw bad('This booking already has a rating');
  await tx(async (c) => { await c.query('INSERT INTO reviews(booking_id,technician_id,rating,comment) VALUES($1,$2,$3,$4)', [b.id, cur.technician_id, r, opt(x.body.comment, 500)]); await audit(c, x, 'booking.review', 'booking', b.booking_code, null, { rating: r }); });
  return { ok: true };
});
R('POST', '/bookings/' + BC + '/complaints', async (x) => {
  const b = await loadBooking(x.params[0]), d = req(x.body.description, 'Complaint', 1000);
  const cur = (await Q('SELECT technician_id FROM booking_assignments WHERE booking_id=$1 AND is_current', [b.id])).rows[0];
  await tx(async (c) => { await c.query('INSERT INTO complaints(booking_id,technician_id,description) VALUES($1,$2,$3)', [b.id, cur ? cur.technician_id : null, d]); await c.query("UPDATE bookings SET complaint_status='open' WHERE id=$1", [b.id]); await audit(c, x, 'booking.complaint', 'booking', b.booking_code); });
  return { ok: true };
});
R('PATCH', '/complaints/' + SETUUID, async (x) => {
  const k = (await Q('SELECT c.*,b.booking_code FROM complaints c LEFT JOIN bookings b ON b.id=c.booking_id WHERE c.id=$1', [x.params[0]])).rows[0], st = S(x.body.status, 15), res = S(x.body.resolution, 500);
  if (!k) throw new HttpError(404, 'Complaint not found'); if (!['investigating', 'resolved', 'dismissed'].includes(st)) throw bad('Invalid status');
  if (['resolved', 'dismissed'].includes(st) && res.length < 3) throw bad('Write the resolution');
  await tx(async (c) => {
    await c.query('UPDATE complaints SET status=$1, resolution=COALESCE($2,resolution), resolved_by=CASE WHEN $1 IN (\'resolved\',\'dismissed\') THEN $3::uuid END WHERE id=$4', [st, res || null, x.admin.id, k.id]);
    if (k.booking_id) await c.query("UPDATE bookings SET complaint_status=$1 WHERE id=$2", [st, k.booking_id]);
    await audit(c, x, 'complaint.' + st, 'booking', k.booking_code || '-', res || null);
  });
  return { ok: true };
});

// ---------- Stage 3: reports ----------
const REP = {
  onboarding: { title: 'Technician onboarding and verification', dates: true,
    cols: [['tech_code', 'Technician ID'], ['full_name', 'Name'], ['mobile', 'Mobile'], ['locality', 'Area'], ['skills', 'Approved services'], ['status', 'Account status'], ['verification_status', 'Verification'], ['onboarded', 'Onboarded', 'dt'], ['verified_at', 'Verified on', 'dt'], ['verified_by', 'Verified by'], ['agreement', 'Agreement'], ['commission', 'Commission rule']],
    sql: `SELECT t.tech_code,t.full_name,t.mobile,t.locality,(SELECT string_agg(c.name,', ' ORDER BY c.sort_order) FROM technician_skills s JOIN service_categories c ON c.id=s.category_id WHERE s.technician_id=t.id AND s.approved) skills,t.status,t.verification_status,t.created_at onboarded,v.verified_at,u.name verified_by,
      ag.version||' ('||to_char(ag.accepted_at ${IST},'YYYY-MM-DD')||')' agreement, replace(ag.commission_basis,'_',' ')||' '||ag.commission_rate commission
      FROM technicians t LEFT JOIN technician_verifications v ON v.technician_id=t.id LEFT JOIN admin_users u ON u.id=v.verified_by
      LEFT JOIN LATERAL (SELECT * FROM technician_agreements a WHERE a.technician_id=t.id ORDER BY a.accepted_at DESC LIMIT 1) ag ON true
      WHERE (t.created_at ${IST})::date BETWEEN $1::date AND $2::date ORDER BY t.tech_code` },
  performance: { title: 'Technician activity and performance (jobs completed)', dates: true,
    cols: [['tech_code', 'Technician ID'], ['full_name', 'Name'], ['status', 'Status'], ['assigned', 'Jobs assigned', 'num'], ['completed', 'Completed', 'num'], ['cancelled', 'Cancelled', 'num'], ['collected', 'Cash collected', 'money'], ['commission', 'Commission', 'money'], ['rating', 'Avg rating', 'num'], ['complaints', 'Complaints', 'num']],
    sql: `SELECT t.tech_code,t.full_name,t.status,count(b.id) assigned,count(b.id) FILTER (WHERE b.work_status='completed') completed,count(b.id) FILTER (WHERE b.work_status='cancelled') cancelled,
      COALESCE(sum(pay.collected),0) collected,COALESCE(sum(pay.commission),0) commission,
      (SELECT round(avg(r.rating),1) FROM reviews r WHERE r.technician_id=t.id) rating,(SELECT count(*) FROM complaints k WHERE k.technician_id=t.id) complaints
      FROM technicians t LEFT JOIN booking_assignments a ON a.technician_id=t.id AND a.is_current
      LEFT JOIN bookings b ON b.id=a.booking_id AND (b.created_at ${IST})::date BETWEEN $1::date AND $2::date
      LEFT JOIN LATERAL (SELECT (SELECT sum(amount_collected) FROM payments p WHERE p.booking_id=b.id AND p.technician_id=t.id) collected,(SELECT sum(commission_amount) FROM technician_commission_ledger l WHERE l.booking_id=b.id AND l.technician_id=t.id) commission) pay ON true
      GROUP BY t.id ORDER BY completed DESC,t.tech_code` },
  collections: { title: 'Cash collections', dates: true,
    cols: [['receipt_no', 'Receipt'], ['paid_at', 'Paid on', 'dt'], ['booking_code', 'Booking'], ['tech_code', 'Technician ID'], ['tech_name', 'Technician'], ['service', 'Service'], ['locality', 'Area'], ['labour', 'Labour', 'money'], ['parts', 'Parts', 'money'], ['discount', 'Discount', 'money'], ['collected', 'Collected', 'money'], ['method', 'Method'], ['refunded', 'Refunded', 'money']],
    sql: `SELECT p.receipt_no,p.paid_at,b.booking_code,t.tech_code,t.full_name tech_name,sc.name service,b.locality,p.labour_amount labour,p.parts_amount parts,p.discount,p.amount_collected collected,p.method,
      COALESCE((SELECT sum(amount) FROM payment_adjustments ad WHERE ad.payment_id=p.id AND ad.kind='refund'),0) refunded
      FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN technicians t ON t.id=p.technician_id JOIN service_categories sc ON sc.id=b.category_id
      WHERE (p.paid_at ${IST})::date BETWEEN $1::date AND $2::date ORDER BY p.paid_at DESC` },
  commission: { title: 'Commission earned (ledger)', dates: true,
    cols: [['created_at', 'Date', 'dt'], ['tech_code', 'Technician ID'], ['full_name', 'Technician'], ['booking_code', 'Booking'], ['receipt_no', 'Receipt'], ['entry_type', 'Entry'], ['basis_amount', 'Basis', 'money'], ['rate', 'Rate', 'num'], ['commission_amount', 'Commission', 'money'], ['technician_share', 'Technician share', 'money'], ['note', 'Note']],
    sql: `SELECT l.created_at,t.tech_code,t.full_name,b.booking_code,p.receipt_no,l.entry_type,l.basis_amount,l.rate,l.commission_amount,l.technician_share,l.note
      FROM technician_commission_ledger l JOIN technicians t ON t.id=l.technician_id LEFT JOIN bookings b ON b.id=l.booking_id LEFT JOIN payments p ON p.id=l.payment_id
      WHERE (l.created_at ${IST})::date BETWEEN $1::date AND $2::date ORDER BY l.created_at DESC` },
  outstanding: { title: 'Outstanding technician settlements (today)', dates: false,
    cols: [['tech_code', 'Technician ID'], ['full_name', 'Name'], ['owed', 'Commission owed', 'money'], ['settled', 'Settled (verified)', 'money'], ['outstanding', 'Outstanding', 'money'], ['unsettled', 'Not yet in a settlement', 'money'], ['unsettled_entries', 'Entries', 'num'], ['oldest', 'Oldest entry']],
    sql: `SELECT t.tech_code,t.full_name,COALESCE(l.owed,0) owed,COALESCE(s.settled,0) settled,COALESCE(l.owed,0)-COALESCE(s.settled,0) outstanding,COALESCE(u.amount,0) unsettled,COALESCE(u.entries,0) unsettled_entries,u.oldest
      FROM technicians t
      LEFT JOIN (SELECT technician_id,sum(commission_amount) owed FROM technician_commission_ledger GROUP BY 1) l ON l.technician_id=t.id
      LEFT JOIN (SELECT technician_id,sum(amount_settled) settled FROM technician_settlements WHERE status='verified' GROUP BY 1) s ON s.technician_id=t.id
      LEFT JOIN (SELECT technician_id,sum(commission_amount) amount,count(*) entries,to_char(min(created_at) ${IST},'YYYY-MM-DD') oldest FROM technician_commission_ledger lg WHERE NOT EXISTS (SELECT 1 FROM settlement_items si WHERE si.ledger_id=lg.id) GROUP BY 1) u ON u.technician_id=t.id
      WHERE COALESCE(l.owed,0)<>0 OR COALESCE(s.settled,0)<>0 ORDER BY outstanding DESC` },
  settlements: { title: 'Settlements received and pending', dates: true,
    cols: [['created_at', 'Created', 'dt'], ['tech_code', 'Technician ID'], ['full_name', 'Technician'], ['due_date', 'Due date'], ['status', 'Status'], ['commission_due', 'Commission due', 'money'], ['amount_settled', 'Received (verified)', 'money'], ['method', 'Method'], ['reference', 'Reference'], ['verified_by', 'Verified by'], ['verified_at', 'Verified on', 'dt']],
    sql: `SELECT s.created_at,t.tech_code,t.full_name,to_char(s.due_date,'YYYY-MM-DD') due_date,s.status,s.commission_due,s.amount_settled,s.method,s.reference,u.name verified_by,s.verified_at
      FROM technician_settlements s JOIN technicians t ON t.id=s.technician_id LEFT JOIN admin_users u ON u.id=s.verified_by
      WHERE (s.created_at ${IST})::date BETWEEN $1::date AND $2::date ORDER BY s.created_at DESC` },
  refunds: { title: 'Refunds and adjustments', dates: true,
    cols: [['created_at', 'Date', 'dt'], ['receipt_no', 'Receipt'], ['booking_code', 'Booking'], ['tech_code', 'Technician ID'], ['kind', 'Type'], ['amount', 'Amount', 'money'], ['reason', 'Reason'], ['recorded_by', 'Recorded by']],
    sql: `SELECT ad.created_at,p.receipt_no,b.booking_code,t.tech_code,ad.kind,ad.amount,ad.reason,u.name recorded_by FROM payment_adjustments ad JOIN payments p ON p.id=ad.payment_id JOIN bookings b ON b.id=p.booking_id JOIN technicians t ON t.id=p.technician_id LEFT JOIN admin_users u ON u.id=ad.created_by
      WHERE (ad.created_at ${IST})::date BETWEEN $1::date AND $2::date
      UNION ALL
      SELECT l.created_at,NULL,NULL,t.tech_code,'commission adjustment',l.commission_amount,l.note,NULL FROM technician_commission_ledger l JOIN technicians t ON t.id=l.technician_id WHERE l.entry_type='adjustment' AND (l.created_at ${IST})::date BETWEEN $1::date AND $2::date
      ORDER BY created_at DESC` },
  complaints: { title: 'Customer complaints', dates: true,
    cols: [['created_at', 'Date', 'dt'], ['booking_code', 'Booking'], ['tech_code', 'Technician ID'], ['full_name', 'Technician'], ['service', 'Service'], ['status', 'Status'], ['description', 'Complaint'], ['resolution', 'Resolution'], ['resolved_by', 'Resolved by']],
    sql: `SELECT k.created_at,b.booking_code,t.tech_code,t.full_name,sc.name service,k.status,k.description,k.resolution,u.name resolved_by FROM complaints k LEFT JOIN bookings b ON b.id=k.booking_id LEFT JOIN technicians t ON t.id=k.technician_id LEFT JOIN service_categories sc ON sc.id=b.category_id LEFT JOIN admin_users u ON u.id=k.resolved_by
      WHERE (k.created_at ${IST})::date BETWEEN $1::date AND $2::date ORDER BY k.created_at DESC` },
  services: { title: 'Service category performance', dates: true,
    cols: [['service', 'Service'], ['orders', 'Orders', 'num'], ['completed', 'Completed', 'num'], ['cancelled', 'Cancelled', 'num'], ['collected', 'Cash collected', 'money'], ['commission', 'Commission', 'money'], ['avg_order', 'Avg order value', 'money'], ['rating', 'Avg rating', 'num'], ['hours', 'Avg hours to complete', 'num']],
    sql: `SELECT sc.name service,count(b.id) orders,count(b.id) FILTER (WHERE b.work_status='completed') completed,count(b.id) FILTER (WHERE b.work_status='cancelled') cancelled,
      COALESCE(sum(pay.collected),0) collected,COALESCE(sum(pay.commission),0) commission,
      CASE WHEN count(pay.collected) FILTER (WHERE pay.collected>0)>0 THEN round(sum(pay.collected)/count(pay.collected) FILTER (WHERE pay.collected>0),2) ELSE 0 END avg_order,
      (SELECT round(avg(r.rating),1) FROM reviews r JOIN bookings rb ON rb.id=r.booking_id WHERE rb.category_id=sc.id) rating,
      round(avg(EXTRACT(epoch FROM (b.completed_at-b.created_at))/3600) FILTER (WHERE b.completed_at IS NOT NULL)::numeric,1) hours
      FROM service_categories sc LEFT JOIN bookings b ON b.category_id=sc.id AND (b.created_at ${IST})::date BETWEEN $1::date AND $2::date
      LEFT JOIN LATERAL (SELECT (SELECT sum(amount_collected) FROM payments p WHERE p.booking_id=b.id) collected,(SELECT sum(commission_amount) FROM technician_commission_ledger l WHERE l.booking_id=b.id) commission) pay ON true
      WHERE sc.is_active OR b.id IS NOT NULL GROUP BY sc.id ORDER BY orders DESC,sc.sort_order` },
};
const csvCell = (v, type) => {
  if (v == null) return '';
  if (v instanceof Date) v = type === 'dt' || !type ? new Date(v).toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 16) : v.toISOString().slice(0, 10);
  let s = String(v);
  if (type !== 'money' && type !== 'num' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
R('GET', '/reports/([a-z]+)', async (x) => {
  const key = x.params[0], def = REP[key]; if (!def) throw new HttpError(404, 'Unknown report');
  const from = dateParam(x.query.from, '2000-01-01'), to = dateParam(x.query.to, '2999-12-31');
  const rows = (await Q(def.sql, def.dates ? [from, to] : [])).rows;
  if (x.query.format === 'csv') {
    await audit(PQ, x, 'report.exported', 'report', key, null, { rows: rows.length, from, to });
    const csv = '\ufeff' + [def.cols.map((c) => csvCell(c[1])).join(',')].concat(rows.map((r) => def.cols.map((c) => csvCell(r[c[0]], c[2])).join(','))).join('\r\n');
    return { csv, filename: `quickfix-${key}-${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' })}.csv` };
  }
  return { key, title: def.title, dates: def.dates, cols: def.cols, rows };
});

// ---------- Stage 3: analytics ----------
R('GET', '/analytics', async (x) => {
  const to = dateParam(x.query.to, new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' }));
  let from = dateParam(x.query.from, to);
  const span = (new Date(to) - new Date(from)) / 864e5; if (span < 0) throw bad('The start date is after the end date'); if (span > 800) throw bad('Choose a range of up to about two years');
  const P = [from, to], bk = `(b.created_at ${IST})::date BETWEEN $1::date AND $2::date`, r = async (s, p) => (await Q(s, p || P)).rows;
  const [tot, money, series, status, services, areas, sources, weekdays, techs, snap, outTop, people, quality] = await Promise.all([
    r(`SELECT count(*) orders,count(*) FILTER (WHERE b.work_status='completed') completed,count(*) FILTER (WHERE b.work_status='cancelled') cancelled,count(*) FILTER (WHERE b.work_status NOT IN ('completed','cancelled')) open,
       count(*) FILTER (WHERE fa.first_assigned IS NOT NULL) assigned,count(*) FILTER (WHERE EXISTS (SELECT 1 FROM payments p WHERE p.booking_id=b.id)) paid,
       round(avg(EXTRACT(epoch FROM (fa.first_assigned-b.created_at))/3600) FILTER (WHERE fa.first_assigned IS NOT NULL)::numeric,1) hours_assign,
       round(avg(EXTRACT(epoch FROM (b.completed_at-b.created_at))/3600) FILTER (WHERE b.completed_at IS NOT NULL)::numeric,1) hours_complete
       FROM bookings b LEFT JOIN LATERAL (SELECT min(assigned_at) first_assigned FROM booking_assignments WHERE booking_id=b.id) fa ON true WHERE ${bk}`),
    r(`SELECT (SELECT COALESCE(sum(amount_collected),0) FROM payments WHERE (paid_at ${IST})::date BETWEEN $1::date AND $2::date) collected,
       (SELECT count(*) FROM payments WHERE (paid_at ${IST})::date BETWEEN $1::date AND $2::date) payments,
       (SELECT COALESCE(sum(amount),0) FROM payment_adjustments WHERE kind='refund' AND (created_at ${IST})::date BETWEEN $1::date AND $2::date) refunds,
       (SELECT COALESCE(sum(commission_amount),0) FROM technician_commission_ledger WHERE (created_at ${IST})::date BETWEEN $1::date AND $2::date) commission,
       (SELECT COALESCE(sum(amount_settled),0) FROM technician_settlements WHERE status='verified' AND (verified_at ${IST})::date BETWEEN $1::date AND $2::date) settled_in_range`),
    r(`SELECT to_char(d,'YYYY-MM-DD') AS day,COALESCE(o.n,0) orders,COALESCE(c.n,0) completed,COALESCE(p.t,0) collected,COALESCE(l.t,0) commission
       FROM generate_series($1::date,$2::date,interval '1 day') d
       LEFT JOIN (SELECT (created_at ${IST})::date dd,count(*) n FROM bookings GROUP BY 1) o ON o.dd=d::date
       LEFT JOIN (SELECT (completed_at ${IST})::date dd,count(*) n FROM bookings WHERE work_status='completed' GROUP BY 1) c ON c.dd=d::date
       LEFT JOIN (SELECT (paid_at ${IST})::date dd,sum(amount_collected) t FROM payments GROUP BY 1) p ON p.dd=d::date
       LEFT JOIN (SELECT (created_at ${IST})::date dd,sum(commission_amount) t FROM technician_commission_ledger GROUP BY 1) l ON l.dd=d::date ORDER BY d`),
    r(`SELECT b.work_status s,count(*) n FROM bookings b WHERE ${bk} GROUP BY 1 ORDER BY n DESC`),
    r(`SELECT sc.name,count(b.id) orders,count(b.id) FILTER (WHERE b.work_status='completed') completed,COALESCE(sum(pay.collected),0) collected,COALESCE(sum(pay.commission),0) commission
       FROM service_categories sc LEFT JOIN bookings b ON b.category_id=sc.id AND ${bk}
       LEFT JOIN LATERAL (SELECT (SELECT sum(amount_collected) FROM payments p WHERE p.booking_id=b.id) collected,(SELECT sum(commission_amount) FROM technician_commission_ledger l WHERE l.booking_id=b.id) commission) pay ON true
       WHERE sc.is_active OR b.id IS NOT NULL GROUP BY sc.id ORDER BY orders DESC,collected DESC`),
    r(`SELECT initcap(lower(trim(b.locality))) area,count(*) orders,COALESCE(sum(pay.collected),0) collected FROM bookings b LEFT JOIN LATERAL (SELECT sum(amount_collected) collected FROM payments p WHERE p.booking_id=b.id) pay ON true WHERE ${bk} GROUP BY 1 ORDER BY orders DESC LIMIT 8`),
    r(`SELECT b.source s,count(*) n FROM bookings b WHERE ${bk} GROUP BY 1 ORDER BY n DESC`),
    r(`SELECT EXTRACT(isodow FROM b.created_at ${IST})::int d,count(*) n FROM bookings b WHERE ${bk} GROUP BY 1 ORDER BY 1`),
    r(`SELECT t.tech_code,t.full_name,count(b.id) FILTER (WHERE b.work_status='completed') jobs,count(b.id) assigned,COALESCE(sum(pay.collected),0) collected,COALESCE(sum(pay.commission),0) commission,(SELECT round(avg(rating),1) FROM reviews rv WHERE rv.technician_id=t.id) rating
       FROM booking_assignments a JOIN bookings b ON b.id=a.booking_id AND ${bk} JOIN technicians t ON t.id=a.technician_id
       LEFT JOIN LATERAL (SELECT (SELECT sum(amount_collected) FROM payments p WHERE p.booking_id=b.id AND p.technician_id=t.id) collected,(SELECT sum(commission_amount) FROM technician_commission_ledger l WHERE l.booking_id=b.id AND l.technician_id=t.id) commission) pay ON true
       WHERE a.is_current GROUP BY t.id ORDER BY collected DESC,jobs DESC LIMIT 8`),
    r(`SELECT (SELECT COALESCE(sum(commission_amount),0) FROM technician_commission_ledger) owed,(SELECT COALESCE(sum(amount_settled),0) FROM technician_settlements WHERE status='verified') settled,
       (SELECT count(*) FROM technician_settlements WHERE status IN ('pending','submitted','rejected') AND due_date < (now() ${IST})::date) overdue,
       (SELECT count(*) FROM technician_settlements WHERE status='submitted') awaiting_verification,
       (SELECT count(*) FROM bookings b WHERE b.work_status NOT IN ('completed','cancelled') AND NOT EXISTS (SELECT 1 FROM booking_assignments a WHERE a.booking_id=b.id AND a.is_current)) unassigned,
       (SELECT count(*) FROM bookings WHERE work_status NOT IN ('completed','cancelled')) open_now`, []),
    r(`SELECT t.tech_code,t.full_name,COALESCE(l.owed,0)-COALESCE(s.settled,0) outstanding FROM technicians t LEFT JOIN (SELECT technician_id,sum(commission_amount) owed FROM technician_commission_ledger GROUP BY 1) l ON l.technician_id=t.id LEFT JOIN (SELECT technician_id,sum(amount_settled) settled FROM technician_settlements WHERE status='verified' GROUP BY 1) s ON s.technician_id=t.id WHERE COALESCE(l.owed,0)-COALESCE(s.settled,0) > 0 ORDER BY outstanding DESC LIMIT 5`, []),
    r(`SELECT (SELECT count(*) FROM technicians) techs,(SELECT count(*) FROM technicians WHERE status='active') active,(SELECT count(*) FROM technicians WHERE verification_status IN ('pending','under_review')) pending_verification,(SELECT count(*) FROM technicians WHERE status='suspended') suspended,
       (SELECT count(*) FROM technicians WHERE (created_at ${IST})::date BETWEEN $1::date AND $2::date) new_techs,(SELECT count(*) FROM customers WHERE (created_at ${IST})::date BETWEEN $1::date AND $2::date) new_customers,
       (SELECT count(*) FROM (SELECT customer_id FROM bookings b WHERE ${bk} GROUP BY 1 HAVING count(*)>1) z) repeat_customers`),
    r(`SELECT (SELECT round(avg(rating),1) FROM reviews WHERE (created_at ${IST})::date BETWEEN $1::date AND $2::date) rating,(SELECT count(*) FROM reviews WHERE (created_at ${IST})::date BETWEEN $1::date AND $2::date) reviews,
       (SELECT count(*) FROM complaints WHERE (created_at ${IST})::date BETWEEN $1::date AND $2::date) complaints,(SELECT count(*) FROM complaints WHERE status IN ('open','investigating')) open_complaints`),
  ]);
  const n = (o, k) => Number(o[k] || 0), T = tot[0], M = money[0], K = snap[0];
  return {
    range: { from, to },
    totals: { orders: n(T, 'orders'), completed: n(T, 'completed'), cancelled: n(T, 'cancelled'), open: n(T, 'open'), assigned: n(T, 'assigned'), paid: n(T, 'paid'), hours_assign: T.hours_assign == null ? null : Number(T.hours_assign), hours_complete: T.hours_complete == null ? null : Number(T.hours_complete),
      collected: n(M, 'collected'), payments: n(M, 'payments'), refunds: n(M, 'refunds'), commission: n(M, 'commission'), settled_in_range: n(M, 'settled_in_range') },
    series: series.map((s) => ({ day: s.day, orders: Number(s.orders), completed: Number(s.completed), collected: Number(s.collected), commission: Number(s.commission) })),
    status: status.map((s) => ({ s: s.s, n: Number(s.n) })), services: services.map((s) => ({ name: s.name, orders: Number(s.orders), completed: Number(s.completed), collected: Number(s.collected), commission: Number(s.commission) })),
    areas: areas.map((s) => ({ area: s.area, orders: Number(s.orders), collected: Number(s.collected) })), sources: sources.map((s) => ({ s: s.s, n: Number(s.n) })), weekdays: weekdays.map((s) => ({ d: s.d, n: Number(s.n) })),
    technicians: techs.map((t) => ({ tech_code: t.tech_code, full_name: t.full_name, jobs: Number(t.jobs), assigned: Number(t.assigned), collected: Number(t.collected), commission: Number(t.commission), rating: t.rating })),
    snapshot: { owed: n(K, 'owed'), settled: n(K, 'settled'), outstanding: n(K, 'owed') - n(K, 'settled'), overdue: n(K, 'overdue'), awaiting_verification: n(K, 'awaiting_verification'), unassigned: n(K, 'unassigned'), open_now: n(K, 'open_now') },
    outstanding_top: outTop.map((t) => ({ tech_code: t.tech_code, full_name: t.full_name, outstanding: Number(t.outstanding) })),
    people: { techs: n(people[0], 'techs'), active: n(people[0], 'active'), pending_verification: n(people[0], 'pending_verification'), suspended: n(people[0], 'suspended'), new_techs: n(people[0], 'new_techs'), new_customers: n(people[0], 'new_customers'), repeat_customers: n(people[0], 'repeat_customers') },
    quality: { rating: quality[0].rating == null ? null : Number(quality[0].rating), reviews: n(quality[0], 'reviews'), complaints: n(quality[0], 'complaints'), open_complaints: n(quality[0], 'open_complaints') },
  };
});

// ---------- entry ----------
const J = (code, body, extra) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extra || {}) }, body: JSON.stringify(body) });
exports.handler = async (event) => {
  try {
    if (!E.DATABASE_URL || !E.SESSION_SECRET || E.SESSION_SECRET.length < 32) throw new HttpError(500, 'Server is not configured. Set DATABASE_URL and SESSION_SECRET (32+ characters) in Netlify.');
    await ensureSchema();
    const path = event.path.replace(/^\/(\.netlify\/functions\/api|api)/, '') || '/', m = event.httpMethod;
    const h = {}; for (const k in event.headers) h[k.toLowerCase()] = event.headers[k];
    if (m !== 'GET' && (h['x-qfb'] !== '1' || !/json/.test(h['content-type'] || ''))) throw new HttpError(403, 'Request blocked');
    let body = {}; if (event.body) { try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body); } catch { throw bad('Invalid request'); } }
    const x = { body, query: event.queryStringParameters || {}, ip: (h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim(), admin: null };
    for (const [rm, re, fn, pub] of routes) {
      const mt = path.match(re); if (rm !== m || !mt) continue;
      x.params = mt.slice(1);
      if (pub !== 'pub') {
        const tech = pub === 'tech', customer = pub === 'customer', ck = tech ? 'qfb_tech' : customer ? 'qfb_customer' : 'qfb_session';
        const raw = (h.cookie || '').split(';').map((z) => z.trim()).find((z) => z.startsWith(ck + '='));
        const sid = readToken(raw ? raw.slice(ck.length + 1) : null, tech ? 't' : customer ? 'c' : 'a');
        if (tech) {
          const a = sid && (await Q("SELECT id,tech_code,full_name,mobile,must_change_password FROM technicians WHERE id=$1 AND status='active' AND verification_status='verified' AND login_enabled", [sid])).rows[0];
          if (!a) throw new HttpError(401, 'Please sign in'); x.tech = a;
        } else if (customer) {
          const a = sid && (await Q("SELECT id,mobile,customer_id FROM users WHERE id=$1 AND role='customer' AND is_active", [sid])).rows[0];
          if (!a) throw new HttpError(401, 'Please sign in'); x.customer = a;
        } else {
          const a = sid && (await Q('SELECT id,name,email,role FROM admin_users WHERE id=$1 AND is_active', [sid])).rows[0];
          if (!a) throw new HttpError(401, 'Please sign in'); x.admin = a;
        }
      }
      const out = await fn(x);
      if (out && out.csv !== undefined) return { statusCode: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${out.filename}"`, 'Cache-Control': 'no-store' }, body: out.csv };
      return out && out.cookie ? J(200, out.body, { 'Set-Cookie': out.cookie }) : J(200, out);
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (e instanceof HttpError) return J(e.code, { error: e.message });
    console.error(e);
    return J(500, { error: 'Something went wrong on the server' });
  }
};
