(function () {
'use strict';
var $ = function (s, r) { return (r || document).querySelector(s); }, app = $('#app'), me = null, cats = null;
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmt(d) { return d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '-'; }
function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
function label(s) { s = String(s || '').replace(/[._]/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }
function badge(s) { return '<span class="badge b-' + esc(s) + '">' + esc(label(s)) + '</span>'; }
function toast(m) { var t = $('#toast'); t.textContent = m; t.className = 'show'; setTimeout(function () { t.className = ''; }, 2600); }
async function api(path, o) {
  o = o || {};
  var r = await fetch('/api' + path, { method: o.method || 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-QFB': '1' }, body: o.body ? JSON.stringify(o.body) : undefined });
  var d = {}; try { d = await r.json(); } catch (e) {}
  if (!r.ok) { var e = new Error(d.error || 'Something went wrong'); e.status = r.status; throw e; }
  return d;
}
function ask(title, required, lab, okText) {
  return new Promise(function (res) {
    var d = $('#dlg');
    d.innerHTML = '<form method="dialog"><h2>' + esc(title) + '</h2><p><label class="fl">' + esc(lab || 'Reason') + (required ? ' <b class="rq">*</b>' : '') + '<textarea id="rs" rows="3"></textarea></label></p><p class="err" id="re"></p><div class="row"><button class="btn o" value="ok">' + esc(okText || 'Confirm') + '</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div></form>';
    d.showModal();
    $('form', d).onsubmit = function (e) { if (e.submitter.value === 'ok' && required && $('#rs').value.trim().length < 3) { e.preventDefault(); $('#re').textContent = 'Please enter a reason (at least 3 characters).'; } };
    d.onclose = function () { res(d.returnValue === 'ok' ? $('#rs').value.trim() : null); };
  });
}
async function getCats() { if (!cats) cats = await api('/categories'); return cats; }

// ---------- layout ----------
function shell(html) {
  var h = location.hash || '#/dashboard';
  function a(href, text, cls, soon) { return '<a href="' + href + '" class="' + (cls || '') + (h === href ? ' on' : '') + '">' + text + (soon ? '<span class="soon">Stage 3</span>' : '') + '</a>'; }
  app.innerHTML = '<div class="shell"><nav class="side" id="side" aria-label="Main"><div class="brand"><img src="logo.jpg" alt="QuickFix Barak"><div><b>QuickFix Barak</b><small>Admin Panel</small></div></div>' +
    a('#/dashboard', 'Dashboard') + a('#/analytics', 'Analytics') + '<hr>' + a('#/bookings', 'Bookings') + a('#/bookings/new', 'New booking', 'sub') + a('#/bookings?assignment=unassigned', 'Needs a technician', 'sub') + '<hr>' + a('#/technicians', 'Technicians') + a('#/technicians/new', 'Add technician', 'sub') +
    a('#/technicians?verification=pending', 'Pending verification', 'sub') + a('#/technicians?status=active', 'Active', 'sub') + a('#/technicians?status=inactive', 'Inactive', 'sub') + a('#/technicians?status=suspended', 'Suspended', 'sub') + '<hr>' +
    a('#/payments', 'Payments') + a('#/settlements', 'Settlements') + a('#/reports', 'Reports') + a('#/categories', 'Service categories') + '</nav>' +
    '<div class="main"><div class="top"><button class="burger" id="bur" aria-label="Menu">☰</button><b style="color:var(--n)">Your Home Service Partner</b><span class="sp"></span><span>' + esc(me.name) + ' <span class="badge">' + esc(me.role) + '</span></span><button class="btn ghost" id="out">Sign out</button></div><main class="pad">' + html + '</main></div></div>';
  $('#bur').onclick = function () { $('#side').classList.toggle('open'); };
  $('#side').onclick = function () { $('#side').classList.remove('open'); };
  $('#out').onclick = async function () { try { await api('/logout', { method: 'POST' }); } catch (e) {} me = null; location.hash = '#/login'; route(); };
}
function loginView() {
  app.innerHTML = '<div class="login"><img src="logo.jpg" alt="QuickFix Barak"><h1 style="text-align:center">Admin sign in</h1><p style="text-align:center;color:var(--m)">Your Home Service Partner</p><form class="card" id="lf"><label class="fl">Email<input type="email" id="le" autocomplete="username" required></label><label class="fl">Password<input type="password" id="lp" autocomplete="current-password" required></label><p class="err" id="lerr" role="alert"></p><button class="btn o" style="justify-content:center">Sign in</button></form></div>';
  $('#lf').onsubmit = async function (e) {
    e.preventDefault(); $('#lerr').textContent = '';
    try { me = await api('/login', { method: 'POST', body: { email: $('#le').value, password: $('#lp').value } }); location.hash = '#/dashboard'; route(); }
    catch (er) { $('#lerr').textContent = er.message; }
  };
}

// ---------- dashboard ----------
async function dashboardView() {
  var d = await api('/dashboard'), c = d.cards;
  var S = function (v, l, cls) { return '<div class="stat ' + (cls || '') + '"><b>' + v + '</b><span>' + l + '</span></div>'; };
  var list = function (arr, fn, empty) { return arr.length ? '<ul class="list">' + arr.map(fn).join('') + '</ul>' : '<p class="empty">' + empty + '</p>'; };
  shell('<div class="row sb"><h1>Dashboard</h1><a class="btn o" href="#/analytics">Open analytics</a></div><p style="color:var(--m)">Live figures from the database.</p><div class="cards">' +
    S(c.tech_total, 'Total technicians') + S(c.tech_active, 'Active technicians', 'g') + S(c.tech_pending, 'Pending verifications', 'o') + S(c.tech_suspended, 'Suspended technicians', 'r') +
    S(c.customers, 'Total customers') + S(c.bookings, 'Total bookings') + S(c.bookings_unassigned, 'Awaiting a technician', 'r') + S(c.bookings_open, 'Pending and assigned bookings', 'o') + S(c.bookings_done, 'Completed bookings', 'g') +
    S(inr(c.cash), 'Cash collected by technicians') + S(inr(c.owed), 'Commission owed to QuickFix', 'o') + S(inr(c.outstanding), 'Outstanding settlements', 'r') + S(inr(c.settled), 'Settlements verified', 'g') + '</div>' +
    '<div class="grid2"><div class="card"><h2>Pending approvals</h2>' + list(d.approvals, function (t) { return '<li><a href="#/technicians/' + esc(t.tech_code) + '"><b>' + esc(t.tech_code) + '</b> ' + esc(t.full_name) + '</a> ' + badge(t.verification_status) + '<br><small>Added ' + fmt(t.created_at) + '</small></li>'; }, 'Nothing waiting for approval.') + '</div>' +
    '<div class="card"><h2>Overdue settlements</h2>' + list(d.overdue, function (s) { return '<li><b>' + esc(s.tech_code) + '</b> ' + esc(s.full_name) + ' owes ' + inr(s.balance) + '<br><small>Due ' + esc(String(s.due_date).slice(0, 10)) + '</small></li>'; }, 'No overdue settlements.') + '</div>' +
    '<div class="card"><h2>Recent bookings</h2>' + list(d.bookings, function (b) { return '<li><a href="#/bookings/' + esc(b.booking_code) + '"><b>' + esc(b.booking_code) + '</b></a> ' + esc(b.service) + ' for ' + esc(b.customer) + ' ' + badge(b.work_status) + '</li>'; }, 'No bookings yet.') + '</div>' +
    '<div class="card"><h2>Recent activity</h2>' + list(d.activity, function (a) { return '<li>' + esc(label(a.action)) + ' <b>' + esc(a.entity_id || '') + '</b><br><small>' + esc(a.admin || 'System') + ' · ' + fmt(a.created_at) + (a.reason ? ' · ' + esc(a.reason) : '') + '</small></li>'; }, 'No activity yet.') + '</div></div>');
}

// ---------- technician list ----------
async function listView(qp) {
  var cs = await getCats(), qs = new URLSearchParams(qp).toString(), r = await api('/technicians?' + qs);
  var title = qp.status ? label(qp.status) + ' technicians' : qp.verification === 'pending' ? 'Pending verification' : 'All technicians';
  var opt = function (arr, cur) { return arr.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(cur || '') === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); };
  function link(p) { var x = Object.assign({}, qp, { page: p }); return '#/technicians?' + new URLSearchParams(x).toString(); }
  shell('<div class="row sb"><h1>' + esc(title) + '</h1><a class="btn o" href="#/technicians/new">+ Add technician</a></div>' +
    '<form class="card" id="flt"><div class="grid2"><label class="fl">Search<input id="fq" placeholder="ID, name or mobile" value="' + esc(qp.q) + '"></label><label class="fl">Service area<input id="fa" placeholder="e.g. Hailakandi" value="' + esc(qp.area) + '"></label></div>' +
    '<div class="row" style="margin-top:12px"><label class="fl">Service<select id="fc"><option value="">All</option>' + opt(cs.filter(function (c) { return c.is_active; }).map(function (c) { return [c.id, c.name]; }), qp.category) + '</select></label>' +
    '<label class="fl">Status<select id="fs"><option value="">All</option>' + opt([['pending', 'Pending'], ['active', 'Active'], ['inactive', 'Inactive'], ['suspended', 'Suspended']], qp.status) + '</select></label>' +
    '<label class="fl">Verification<select id="fv"><option value="">All</option>' + opt([['pending', 'Pending'], ['under_review', 'Under review'], ['verified', 'Verified'], ['rejected', 'Rejected']], qp.verification) + '</select></label>' +
    '<label class="fl">Sort<select id="fo">' + opt([['created', 'Newest'], ['name', 'Name'], ['code', 'ID'], ['experience', 'Experience']], qp.sort) + '</select></label>' +
    '<label class="fl">Order<select id="fd">' + opt([['desc', 'Descending'], ['asc', 'Ascending']], qp.dir) + '</select></label>' +
    '<button class="btn" style="align-self:end">Apply</button></div></form>' +
    '<div class="card tw">' + (r.rows.length ? '<table><thead><tr><th>ID</th><th>Name</th><th>Mobile</th><th>Area</th><th>Skills</th><th>Verification</th><th>Status</th></tr></thead><tbody>' +
    r.rows.map(function (t) { return '<tr><td><a href="#/technicians/' + esc(t.tech_code) + '"><b>' + esc(t.tech_code) + '</b></a></td><td>' + esc(t.full_name) + '</td><td>' + esc(t.mobile) + '</td><td>' + esc(t.locality) + '</td><td>' + esc(t.skills || '-') + '</td><td>' + badge(t.verification_status) + '</td><td>' + badge(t.status) + '</td></tr>'; }).join('') + '</tbody></table>'
      : '<p class="empty">No technicians found. <a href="#/technicians/new">Add the first technician</a>.</p>') + '</div>' +
    '<div class="row sb"><span style="color:var(--m)">' + r.total + ' technician' + (r.total === 1 ? '' : 's') + ' · page ' + r.page + ' of ' + r.pages + '</span><span class="row">' +
    (r.page > 1 ? '<a class="btn ghost" href="' + link(r.page - 1) + '">Previous</a>' : '') + (r.page < r.pages ? '<a class="btn ghost" href="' + link(r.page + 1) + '">Next</a>' : '') + '</span></div>');
  $('#flt').onsubmit = function (e) {
    e.preventDefault(); var p = { q: $('#fq').value.trim(), area: $('#fa').value.trim(), category: $('#fc').value, status: $('#fs').value, verification: $('#fv').value, sort: $('#fo').value, dir: $('#fd').value }, o = {};
    Object.keys(p).forEach(function (k) { if (p[k]) o[k] = p[k]; }); location.hash = '#/technicians' + (Object.keys(o).length ? '?' + new URLSearchParams(o).toString() : '');
  };
}

// ---------- onboarding / edit form ----------
var BASIS = [['labour_only', 'Labour only'], ['labour_and_parts', 'Labour and parts'], ['fixed_per_job', 'Fixed amount per job'], ['custom', 'Custom rule']];
var SCHED = [['daily', 'Daily'], ['weekly', 'Weekly'], ['fortnightly', 'Every two weeks']];
var SECTIONS = {
  personal: { title: 'A. Personal information', fields: [['full_name', 'Full legal name', 'text', 1], ['mobile', 'Mobile number (must be unique)', 'tel', 1], ['alt_mobile', 'Alternate mobile number', 'tel'], ['email', 'Email address', 'email'], ['address', 'Current address', 'textarea', 1], ['locality', 'Town / locality', 'text', 1], ['pin_code', 'PIN code', 'text', 1], ['emergency_name', 'Emergency contact name', 'text'], ['emergency_mobile', 'Emergency contact number', 'tel']] },
  professional: { title: 'C. Professional information', fields: [['experience_years', 'Years of experience', 'number'], ['experience_notes', 'Experience description', 'textarea'], ['qualifications', 'Qualifications and training', 'textarea'], ['tools', 'Tools and equipment available', 'textarea'], ['own_transport', 'Has own transport', 'check'], ['working_hours', 'Preferred working hours', 'text'], ['availability', 'Availability', 'select', 0, [['', 'Select'], ['full_time', 'Full-time'], ['part_time', 'Part-time'], ['weekend', 'Weekend only']]], ['service_localities', 'Preferred service localities', 'text'], ['max_distance_km', 'Maximum service distance (km)', 'number'], ['assessment_notes', 'Admin assessment notes', 'textarea'], ['skills', 'Approved services', 'skills']] },
  verification: { title: 'D. Verification checks', fields: [['v_mobile_verified', 'Mobile number verified', 'check'], ['v_identity_checked', 'Identity checked', 'check'], ['v_address_checked', 'Address checked (if required)', 'check'], ['v_skills_assessed', 'Skills assessed', 'check'], ['v_qualifications_reviewed', 'Qualifications reviewed', 'check']] },
  agreement: { title: 'E. Business agreement', fields: [['ag_accepted', 'Technician has accepted the written agreement', 'check'], ['ag_version', 'Agreement version', 'text'], ['ag_commission_basis', 'Commission basis', 'select', 0, BASIS], ['ag_commission_rate', 'Commission rate (% of the base, or ₹ if fixed per job)', 'number'], ['ag_settlement_schedule', 'Settlement schedule', 'select', 0, SCHED]] }
};
var INFO = {
  personal: '<div class="note"><b>B. Technician ID.</b> A permanent ID such as <b>QFB-TECH-0001</b> is generated automatically by the server when you save. You never type it, and it is never reused.</div><div class="note">Profile photo upload arrives with private document storage in the next stage.</div>',
  verification: '<div class="note">Tick only what you have actually checked. The final verification decision (Verify or Reject) is made on the technician\'s profile.</div>',
  agreement: '<div class="note">The agreement should cover commission, cash settlement, customer privacy and conduct, quotation rules, cancellations and refunds, complaints, and suspension and termination.</div><div class="note"><b>F. Account status.</b> New technicians start as <b>Pending</b>. Activate them from the profile once verified.</div>'
};
function field(f, v, cs) {
  var n = f[0], l = esc(f[1]) + (f[3] ? ' <b class="rq">*</b>' : '');
  if (f[2] === 'check') return '<label class="ck"><input type="checkbox" name="' + n + '"' + (v ? ' checked' : '') + '> ' + esc(f[1]) + '</label>';
  if (f[2] === 'textarea') return '<label class="fl">' + l + '<textarea name="' + n + '" rows="2">' + esc(v) + '</textarea></label>';
  if (f[2] === 'select') return '<label class="fl">' + l + '<select name="' + n + '">' + f[4].map(function (o) { return '<option value="' + o[0] + '"' + (String(v || '') === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
  if (f[2] === 'skills') return '<div class="fl">' + esc(f[1]) + '<div class="sk">' + cs.filter(function (c) { return c.is_active || (v || []).indexOf(c.id) > -1; }).map(function (c) { return '<label class="ck"><input type="checkbox" name="skill" value="' + c.id + '"' + ((v || []).indexOf(c.id) > -1 ? ' checked' : '') + '> ' + esc(c.name) + '</label>'; }).join('') + '</div></div>';
  return '<label class="fl">' + l + '<input name="' + n + '" type="' + f[2] + '" value="' + esc(v) + '"' + (f[2] === 'tel' ? ' inputmode="numeric"' : '') + '></label>';
}
async function formView(code) {
  var cs = await getCats(), edit = !!code, data = { locality: 'Hailakandi', pin_code: '788151', ag_version: 'v1.0', ag_commission_basis: 'labour_only', ag_settlement_schedule: 'daily', skills: [] };
  if (edit) { var p = await api('/technicians/' + code); Object.assign(data, p.tech); data.skills = p.categories.filter(function (c) { return c.approved; }).map(function (c) { return c.id; }); }
  var keys = edit ? ['personal', 'professional'] : ['personal', 'professional', 'verification', 'agreement'], step = 0, total = keys.length + 1;
  function collect() {
    var root = $('#stepbox'); if (!root) return;
    root.querySelectorAll('[name]').forEach(function (el) {
      if (el.name === 'skill') return;
      data[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
    });
    if (root.querySelector('[name=skill]')) data.skills = Array.prototype.map.call(root.querySelectorAll('[name=skill]:checked'), function (e) { return Number(e.value); });
  }
  function validate() {
    if (step >= keys.length) return '';
    var s = SECTIONS[keys[step]];
    for (var i = 0; i < s.fields.length; i++) { var f = s.fields[i]; if (f[3] && !String(data[f[0]] || '').trim()) return f[1] + ' is required.'; }
    if (keys[step] === 'personal') {
      if (!/^\d{6}$/.test(data.pin_code)) return 'PIN code must be 6 digits.';
      var m = String(data.mobile).replace(/[\s-]/g, '').replace(/^(\+91|91)(?=\d{10}$)/, ''); if (!/^[6-9]\d{9}$/.test(m)) return 'Enter a valid 10-digit mobile number.';
    }
    if (keys[step] === 'agreement' && data.ag_accepted) { var r = Number(data.ag_commission_rate), lim = data.ag_commission_basis === 'fixed_per_job' ? 100000 : 100; if (data.ag_commission_rate === '' || data.ag_commission_rate == null || !(r >= 0 && r <= lim)) return lim === 100 ? 'Enter a commission rate between 0 and 100.' : 'Enter the fixed amount per job.'; }
    return '';
  }
  function review() {
    var rows = [['Full name', data.full_name], ['Mobile', data.mobile], ['Address', data.address + ', ' + data.locality + ' ' + data.pin_code], ['Experience', (data.experience_years || '-') + ' years'],
      ['Approved services', cs.filter(function (c) { return data.skills.indexOf(c.id) > -1; }).map(function (c) { return c.name; }).join(', ') || 'None selected']];
    if (!edit) rows.push(['Checks done', ['mobile_verified', 'identity_checked', 'address_checked', 'skills_assessed', 'qualifications_reviewed'].filter(function (k) { return data['v_' + k]; }).map(label).join(', ') || 'None'],
      ['Agreement', data.ag_accepted ? data.ag_version + ', ' + label(data.ag_commission_basis) + ' at ' + data.ag_commission_rate + '%, settled ' + data.ag_settlement_schedule : 'Not yet accepted (record it later on the profile)']);
    return '<h2>Review and ' + (edit ? 'save' : 'create') + '</h2><dl class="kv">' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>';
  }
  function draw() {
    var names = keys.map(function (k) { return SECTIONS[k].title.slice(3); }).concat(['Review']);
    var body = step < keys.length ? '<h2>' + esc(SECTIONS[keys[step]].title) + '</h2>' + (edit ? '' : INFO[keys[step]] || '') + '<div class="grid2" style="margin-top:12px">' + SECTIONS[keys[step]].fields.map(function (f) { return (f[2] === 'textarea' || f[2] === 'skills') ? '<div style="grid-column:1/-1">' + field(f, data[f[0]], cs) + '</div>' : field(f, data[f[0]], cs); }).join('') + '</div>' : review();
    shell('<h1>' + (edit ? 'Edit ' + esc(code) : 'Add technician') + '</h1><div class="steps">' + names.map(function (n, i) { return '<span class="' + (i === step ? 'on' : i < step ? 'done' : '') + '">' + (i + 1) + '. ' + esc(n) + '</span>'; }).join('') + '</div>' +
      '<div class="card" id="stepbox">' + body + '</div><p class="err" id="ferr" role="alert"></p><div class="row"><button class="btn ghost" id="bk">' + (step ? 'Back' : 'Cancel') + '</button><button class="btn o" id="nx">' + (step === total - 1 ? (edit ? 'Save changes' : 'Create technician') : 'Next') + '</button></div>');
    $('#bk').onclick = function () { collect(); if (step) { step--; draw(); } else location.hash = edit ? '#/technicians/' + code : '#/technicians'; };
    $('#nx').onclick = async function () {
      collect(); var er = validate(); if (er) { $('#ferr').textContent = er; return; }
      if (step < total - 1) { step++; draw(); window.scrollTo(0, 0); return; }
      var pl = Object.assign({}, data); this.disabled = true;
      if (!edit) {
        pl.verification = {}; ['mobile_verified', 'identity_checked', 'address_checked', 'skills_assessed', 'qualifications_reviewed'].forEach(function (k) { pl.verification[k] = !!data['v_' + k]; });
        pl.agreement = data.ag_accepted ? { accepted: true, version: data.ag_version, commission_basis: data.ag_commission_basis, commission_rate: Number(data.ag_commission_rate), settlement_schedule: data.ag_settlement_schedule } : null;
      }
      try { var r = await api(edit ? '/technicians/' + code : '/technicians', { method: edit ? 'PATCH' : 'POST', body: pl }); toast(edit ? 'Changes saved' : 'Technician created: ' + r.tech_code); location.hash = '#/technicians/' + (edit ? code : r.tech_code); }
      catch (e) { this.disabled = false; $('#ferr').textContent = e.message; }
    };
  }
  draw();
}

// ---------- technician profile ----------
async function profileView(code) {
  var p = await api('/technicians/' + code), t = p.tech, v = p.verification, s = p.stats, ag = p.agreement;
  var S = function (x, l) { return '<div class="stat"><b>' + x + '</b><span>' + l + '</span></div>'; };
  var kv = function (r) { return '<dl class="kv">' + r.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1] == null || x[1] === '' ? '-' : x[1]) + '</dd>'; }).join('') + '</dl>'; };
  var acts = [];
  if (t.status === 'pending' || t.status === 'inactive') acts.push('<button class="btn g" data-a="activate">Activate</button>');
  if (t.status === 'active') acts.push('<button class="btn ghost" data-a="deactivate">Deactivate</button>');
  if (t.status !== 'suspended') acts.push('<button class="btn r" data-a="suspend">Suspend</button>'); else acts.push('<button class="btn g" data-a="reinstate">Reinstate</button>');
  var chk = [['mobile_verified', 'Mobile number verified'], ['identity_checked', 'Identity checked'], ['address_checked', 'Address checked'], ['skills_assessed', 'Skills assessed'], ['qualifications_reviewed', 'Qualifications reviewed']];
  shell('<div class="card"><div class="row sb"><div><div class="idbox" id="tid">' + esc(t.tech_code) + '</div><h1 style="margin-top:6px">' + esc(t.full_name) + '</h1><div class="row" style="margin-top:6px">' + badge(t.status) + badge(t.verification_status) + '<span style="color:var(--m)">Onboarded ' + fmt(t.created_at) + '</span></div></div>' +
    '<div class="row noprint"><button class="btn ghost" id="cp">Copy ID</button><button class="btn ghost" id="pr">Print / save as PDF</button><a class="btn" href="#/technicians/' + esc(code) + '/edit">Edit profile</a></div></div><div class="row noprint" style="margin-top:14px">' + acts.join('') + '</div></div>' +
    '<div class="cards">' + S(s.assigned, 'Jobs assigned') + S(s.completed, 'Completed') + S(s.cancelled, 'Cancelled') + S(s.rating || '-', 'Average rating') + S(s.complaints, 'Complaints') + S(inr(s.cash), 'Cash collected') + S(inr(s.owed), 'Commission owed') + S(inr(s.settled), 'Commission settled') + S(inr(s.outstanding), 'Outstanding balance') + '</div>' +
    '<div class="grid2"><div class="card"><h2>Personal details</h2>' + kv([['Mobile', t.mobile], ['Alternate mobile', t.alt_mobile], ['Email', t.email], ['Address', t.address], ['Locality', t.locality + ' ' + t.pin_code], ['Emergency contact', (t.emergency_name || '') + ' ' + (t.emergency_mobile || '')]]) + '</div>' +
    '<div class="card"><h2>Professional details</h2>' + kv([['Experience', t.experience_years != null ? t.experience_years + ' years' : ''], ['Description', t.experience_notes], ['Qualifications', t.qualifications], ['Tools', t.tools], ['Own transport', t.own_transport ? 'Yes' : 'No'], ['Working hours', t.working_hours], ['Availability', label(t.availability)], ['Preferred localities', t.service_localities], ['Max distance', t.max_distance_km != null ? t.max_distance_km + ' km' : ''], ['Assessment notes', t.assessment_notes]]) + '</div></div>' +
    '<div class="card"><h2>Approved services</h2><div class="sk" style="margin-top:8px">' + p.categories.map(function (c) { return '<div>' + (c.approved ? '✅' : '▫️') + ' ' + esc(c.name) + '</div>'; }).join('') + '</div><p style="color:var(--m);margin:8px 0 0">Jobs are only offered for approved services. Change them with Edit profile.</p></div>' +
    '<div class="card"><h2>Verification</h2><div class="sk" style="margin:8px 0">' + chk.map(function (c) { return '<label class="ck"><input type="checkbox" data-c="' + c[0] + '"' + (v[c[0]] ? ' checked' : '') + '> ' + c[1] + '</label>'; }).join('') + '</div>' +
    '<label class="fl">Verification notes<textarea id="vn" rows="2">' + esc(v.notes) + '</textarea></label><p>Status: ' + badge(t.verification_status) + (v.verified_at ? ' <small>Verified by ' + esc(v.verified_by_name || 'admin') + ' on ' + fmt(v.verified_at) + '</small>' : '') + (v.rejection_reason ? ' <small>Reason: ' + esc(v.rejection_reason) + '</small>' : '') + '</p>' +
    '<div class="row noprint"><button class="btn ghost" data-v="under_review">Mark under review</button><button class="btn g" data-v="verified">Verify</button><button class="btn r" data-v="rejected">Reject</button></div><p class="err" id="verr"></p></div>' +
    '<div class="card"><h2>Business agreement</h2>' + (ag ? kv([['Version', ag.version], ['Accepted', fmt(ag.accepted_at)], ['Commission', label(ag.commission_basis) + ' at ' + ag.commission_rate + '%'], ['Settlement', label(ag.settlement_schedule)]]) :
      '<p>No accepted agreement recorded yet.</p><form id="agf" class="noprint"><div class="grid2"><label class="fl">Version<input id="agv" value="v1.0"></label><label class="fl">Rate (% or ₹ if fixed)<input id="agr" type="number" min="0" max="100" step="0.5"></label>' +
      '<label class="fl">Commission basis<select id="agb">' + BASIS.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select></label><label class="fl">Settlement schedule<select id="ags">' + SCHED.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select></label></div>' +
      '<label class="ck"><input type="checkbox" id="aga"> Technician has accepted the written agreement</label><p class="err" id="agerr"></p><button class="btn o">Record agreement</button></form>') + '</div>' +
    '<div class="card"><h2>Technician portal login</h2><p>Login is <b>' + (t.has_login ? 'enabled' : 'not enabled') + '</b>.' + (t.last_login_at ? ' Last sign-in ' + fmt(t.last_login_at) + '.' : '') + ' The technician signs in at <b>' + esc(location.origin) + '/tech.html</b> with their Technician ID or mobile number and a password, and sees only their own assigned jobs.</p><div class="row noprint">' + (t.verification_status === 'verified' ? '<button class="btn o" data-l="' + (t.has_login ? 'reset' : 'create') + '">' + (t.has_login ? 'Reset password' : 'Enable portal login') + '</button>' + (t.has_login ? '<button class="btn ghost" data-l="revoke">Revoke access</button>' : '') : '<span style="color:var(--m)">Verify the technician first.</span>') + '</div></div>' +
    '<div class="grid2"><div class="card"><h2>Internal notes</h2><form id="nf" class="noprint"><textarea id="nt" rows="2" placeholder="Add a private note"></textarea><p><button class="btn">Add note</button></p></form>' +
    (p.notes.length ? '<ul class="list">' + p.notes.map(function (n) { return '<li>' + esc(n.note) + '<br><small>' + esc(n.admin || '') + ' · ' + fmt(n.created_at) + '</small></li>'; }).join('') + '</ul>' : '<p class="empty">No notes yet.</p>') + '</div>' +
    '<div class="card"><h2>Activity log</h2>' + (p.activity.length ? '<ul class="list">' + p.activity.map(function (a) { return '<li>' + esc(label(a.action)) + (a.reason ? ': ' + esc(a.reason) : '') + '<br><small>' + esc(a.admin || 'System') + ' · ' + fmt(a.created_at) + '</small></li>'; }).join('') + '</ul>' : '<p class="empty">No activity yet.</p>') + '</div></div>' +
    techMoneyCard(p));
  var reload = function () { cats = null; route(); };
  bindTechMoney(code, t, reload);
  document.querySelectorAll('[data-l]').forEach(function (b) {
    b.onclick = async function () {
      var a = b.dataset.l;
      if (a === 'revoke') { var r = await ask('Revoke portal access for ' + t.full_name + '?', true, 'Reason', 'Revoke'); if (r === null) return; try { await api('/technicians/' + code + '/login-access', { method: 'POST', body: { action: 'revoke' } }); toast('Access revoked'); reload(); } catch (e) { toast(e.message); } return; }
      try {
        var d = await api('/technicians/' + code + '/login-access', { method: 'POST', body: { action: a } });
        var msg = 'Hello ' + d.name + ', your QuickFix Barak technician portal is ready.\nLink: ' + location.origin + '/tech.html\nLogin: ' + d.tech_code + ' (or your mobile number)\nTemporary password: ' + d.password + '\nPlease change the password after your first login.';
        var p = modal('Portal login ready', '<div class="note">Shown only once. Send it to the technician now.</div><div class="idbox" style="margin:10px 0">' + esc(d.password) + '</div><pre style="white-space:pre-wrap;background:#f2f4f8;padding:10px;border-radius:8px;font:13px system-ui">' + esc(msg) + '</pre><p class="row"><button type="button" class="btn ghost" id="cpm">Copy message</button><a class="btn g" target="_blank" rel="noopener" href="https://wa.me/91' + esc(d.mobile) + '?text=' + encodeURIComponent(msg) + '">Send on WhatsApp</a></p>', 'Done');
        $('#cpm').onclick = function () { navigator.clipboard.writeText(msg).then(function () { toast('Message copied'); }); };
        await p; reload();
      } catch (e) { toast(e.message); }
    };
  });
  $('#cp').onclick = function () { navigator.clipboard.writeText(t.tech_code).then(function () { toast('Copied ' + t.tech_code); }); };
  $('#pr').onclick = function () { window.print(); };
  document.querySelectorAll('[data-a]').forEach(function (b) {
    b.onclick = async function () {
      var a = b.dataset.a, needs = a !== 'activate', r = await ask(label(a) + ' ' + t.full_name + '?', needs, needs ? 'Reason (saved in the audit log)' : 'Note (optional)', label(a)); if (r === null) return;
      try { await api('/technicians/' + code + '/status', { method: 'POST', body: { action: a, reason: r } }); toast('Status updated'); reload(); } catch (e) { toast(e.message); }
    };
  });
  document.querySelectorAll('[data-v]').forEach(function (b) {
    b.onclick = async function () {
      var st = b.dataset.v, reason = '', checks = {}; $('#verr').textContent = '';
      document.querySelectorAll('[data-c]').forEach(function (c) { checks[c.dataset.c] = c.checked; });
      if (st === 'rejected') { reason = await ask('Reject ' + t.full_name + '?', true, 'Reason for rejection'); if (reason === null) return; }
      try { await api('/technicians/' + code + '/verification', { method: 'POST', body: { status: st, checks: checks, notes: $('#vn').value, reason: reason } }); toast('Verification updated'); reload(); } catch (e) { $('#verr').textContent = e.message; }
    };
  });
  if ($('#agf')) $('#agf').onsubmit = async function (e) {
    e.preventDefault();
    try { await api('/technicians/' + code + '/agreement', { method: 'POST', body: { accepted: $('#aga').checked, version: $('#agv').value, commission_basis: $('#agb').value, commission_rate: $('#agr').value, settlement_schedule: $('#ags').value } }); toast('Agreement recorded'); reload(); } catch (er) { $('#agerr').textContent = er.message; }
  };
  $('#nf').onsubmit = async function (e) { e.preventDefault(); try { await api('/technicians/' + code + '/notes', { method: 'POST', body: { note: $('#nt').value } }); toast('Note added'); reload(); } catch (er) { toast(er.message); } };
}

// ---------- Stage 2: bookings ----------
function istInput(d) {
  if (!d) return '';
  var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(d)).reduce(function (a, x) { a[x.type] = x.value; return a; }, {});
  return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
}
function modal(title, body, okText, getVals) {
  return new Promise(function (res) {
    var d = $('#dlg'), out = null;
    d.innerHTML = '<form method="dialog"><h2>' + esc(title) + '</h2>' + body + '<p class="err" id="re"></p><div class="row"><button class="btn o" value="ok">' + esc(okText || 'Confirm') + '</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div></form>';
    d.showModal();
    $('form', d).onsubmit = function (e) { if (e.submitter.value !== 'ok') return; var r = getVals ? getVals(d) : {}; if (typeof r === 'string') { e.preventDefault(); $('#re').textContent = r; } else out = r; };
    d.onclose = function () { res(d.returnValue === 'ok' ? out : null); };
  });
}
var SRC = [['whatsapp', 'WhatsApp'], ['phone', 'Phone call'], ['website', 'Website'], ['customer_web', 'Customer web app'], ['admin_manual', 'Admin manual entry'], ['walk_in', 'Walk-in'], ['other', 'Other']];
function opts(arr, cur) { return arr.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(cur || '') === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
function pager(r, mk) { return '<div class="row sb"><span style="color:var(--m)">' + r.total + ' result' + (r.total === 1 ? '' : 's') + ' · page ' + r.page + ' of ' + r.pages + '</span><span class="row">' + (r.page > 1 ? '<a class="btn ghost" href="' + mk(r.page - 1) + '">Previous</a>' : '') + (r.page < r.pages ? '<a class="btn ghost" href="' + mk(r.page + 1) + '">Next</a>' : '') + '</span></div>'; }

async function bookingListView(qp) {
  var cs = (await getCats()).filter(function (c) { return c.is_active; }), r = await api('/bookings?' + new URLSearchParams(qp).toString());
  var ST = ['requested', 'confirmed', 'assigned', 'en_route', 'arrived', 'diagnosing', 'quote_pending', 'quote_accepted', 'quote_rejected', 'in_progress', 'completed', 'cancelled', 'disputed'].map(function (s) { return [s, label(s)]; });
  shell('<div class="row sb"><h1>Bookings</h1><a class="btn o" href="#/bookings/new">+ New booking</a></div>' +
    '<form class="card" id="flt"><div class="grid2"><label class="fl">Search<input id="fq" placeholder="Booking no., customer name or mobile" value="' + esc(qp.q) + '"></label><label class="fl">Area<input id="fa" placeholder="e.g. Hailakandi" value="' + esc(qp.area) + '"></label></div>' +
    '<div class="row" style="margin-top:12px"><label class="fl">Service<select id="fc"><option value="">All</option>' + opts(cs.map(function (c) { return [c.id, c.name]; }), qp.category) + '</select></label>' +
    '<label class="fl">Status<select id="fs"><option value="">All</option>' + opts(ST, qp.status) + '</select></label>' +
    '<label class="fl">Order source<select id="fsource"><option value="">All sources</option>' + opts(SRC, qp.source) + '</select></label>' +
    '<label class="fl">Technician<select id="fg"><option value="">Any</option>' + opts([['unassigned', 'Not assigned yet'], ['assigned', 'Assigned']], qp.assignment) + '</select></label><button class="btn" style="align-self:end">Apply</button></div></form>' +
    '<div class="card tw">' + (r.rows.length ? '<table><thead><tr><th>Booking</th><th>Customer</th><th>Service</th><th>Area</th><th>Preferred time</th><th>Technician</th><th>Status</th></tr></thead><tbody>' +
    r.rows.map(function (b) { return '<tr><td><a href="#/bookings/' + esc(b.booking_code) + '"><b>' + esc(b.booking_code) + '</b></a></td><td>' + esc(b.customer) + '<br><small style="color:var(--m)">' + esc(b.mobile) + '</small></td><td>' + esc(b.service) + '</td><td>' + esc(b.locality) + '</td><td>' + (b.preferred_at ? fmt(b.preferred_at) : '-') + '</td><td>' + (b.tech_code ? '<a href="#/technicians/' + esc(b.tech_code) + '">' + esc(b.tech_name) + '</a>' : '<span class="badge b-pending">Not assigned</span>') + '</td><td>' + badge(b.work_status) + '</td></tr>'; }).join('') + '</tbody></table>'
      : '<p class="empty">No bookings found. <a href="#/bookings/new">Add the first booking</a>.</p>') + '</div>' + pager(r, function (p) { return '#/bookings?' + new URLSearchParams(Object.assign({}, qp, { page: p })).toString(); }));
  $('#flt').onsubmit = function (e) {
    e.preventDefault(); var p = { q: $('#fq').value.trim(), area: $('#fa').value.trim(), category: $('#fc').value, status: $('#fs').value, source: $('#fsource').value, assignment: $('#fg').value }, o = {};
    Object.keys(p).forEach(function (k) { if (p[k]) o[k] = p[k]; }); location.hash = '#/bookings' + (Object.keys(o).length ? '?' + new URLSearchParams(o).toString() : '');
  };
}

async function bookingFormView() {
  var cs = (await getCats()).filter(function (c) { return c.is_active; });
  shell('<h1>New booking</h1><p style="color:var(--m)">Enter an order received on WhatsApp, phone or in person.</p><form class="card" id="bf" novalidate>' +
    '<div class="grid2"><label class="fl">Customer mobile <b class="rq">*</b><input name="mobile" type="tel" inputmode="numeric" autocomplete="off"></label><label class="fl">Customer name <b class="rq">*</b><input name="name"></label>' +
    '<label class="fl">Email (optional)<input name="email" type="email"></label><label class="fl">Town / locality <b class="rq">*</b><input name="locality" value="Hailakandi"></label></div>' +
    '<label class="fl" style="margin-top:12px">Service address <b class="rq">*</b><textarea name="address" rows="2"></textarea></label>' +
    '<div class="grid2" style="margin-top:12px"><label class="fl">Service <b class="rq">*</b><select name="category_id"><option value="">Choose a service</option>' + opts(cs.map(function (c) { return [c.id, c.name]; })) + '</select></label>' +
    '<label class="fl">Preferred date and time<input name="preferred_at" type="datetime-local"></label>' +
    '<label class="fl">Order came from<select name="source">' + opts(SRC) + '</select></label></div>' +
    '<label class="fl" style="margin-top:12px">Problem / notes<textarea name="problem" rows="3"></textarea></label><p class="err" id="ferr" role="alert"></p>' +
    '<div class="row"><a class="btn ghost" href="#/bookings">Cancel</a><button class="btn o">Create booking</button></div></form>');
  var f = $('#bf');
  f.elements.mobile.onblur = async function () {
    var m = this.value.trim(); if (!/\d{10}/.test(m.replace(/\D/g, ''))) return;
    try { var c = await api('/customers/lookup?mobile=' + encodeURIComponent(m)); if (c) { if (!f.elements.name.value) f.elements.name.value = c.name; if (!f.elements.address.value) f.elements.address.value = c.address || ''; if (c.locality) f.elements.locality.value = c.locality; if (!f.elements.email.value) f.elements.email.value = c.email || ''; toast('Existing customer found'); } } catch (e) {}
  };
  f.onsubmit = async function (e) {
    e.preventDefault(); var b = {}; Array.prototype.forEach.call(f.elements, function (el) { if (el.name) b[el.name] = el.value.trim(); });
    if (!b.mobile || !b.name || !b.address || !b.locality || !b.category_id) { $('#ferr').textContent = 'Please fill the customer mobile, name, address, locality and service.'; return; }
    try { var r = await api('/bookings', { method: 'POST', body: b }); toast('Booking ' + r.booking_code + ' created'); location.hash = '#/bookings/' + r.booking_code; } catch (er) { $('#ferr').textContent = er.message; }
  };
}

async function bookingDetailView(code) {
  var d = await api('/bookings/' + code), b = d.booking, cur = d.current, open = ['completed', 'cancelled'].indexOf(b.work_status) < 0;
  var kv = function (r) { return '<dl class="kv">' + r.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + (x[2] ? x[1] : esc(x[1] == null || x[1] === '' ? '-' : x[1])) + '</dd>'; }).join('') + '</dl>'; };
  var wa = 'https://wa.me/91' + esc(b.customer_mobile);
  shell('<div class="card"><div class="row sb"><div><div class="idbox">' + esc(b.booking_code) + '</div><h1 style="margin-top:6px">' + esc(b.service) + '</h1><div class="row" style="margin-top:6px">' + badge(b.work_status) + '<span style="color:var(--m)">Received ' + fmt(b.created_at) + ' via ' + esc((SRC.filter(function (o) { return o[0] === b.source; })[0] || [0, b.source])[1]) + '</span></div></div>' +
    '<div class="row noprint">' + (open ? '<button class="btn ghost" id="rs">Reschedule</button><button class="btn ghost" id="st">Change status</button><button class="btn r" id="cn">Cancel booking</button>' : '') + '</div></div></div>' +
    '<div class="grid2"><div class="card"><h2>Customer</h2>' + kv([['Name', b.customer_name], ['Mobile', '<a href="tel:+91' + esc(b.customer_mobile) + '">' + esc(b.customer_mobile) + '</a> · <a href="' + wa + '" target="_blank" rel="noopener">WhatsApp</a>', 1], ['Address', b.address], ['Locality', b.locality]]) + '</div>' +
    '<div class="card"><h2>Job details</h2>' + kv([['Preferred time', b.preferred_at ? fmt(b.preferred_at) : '-'], ['Problem', b.problem], ['Inspection fee', b.inspection_fee > 0 ? inr(b.inspection_fee) : '-'], ['Cancel reason', b.cancel_reason]]) + '</div></div>' +
    '<div class="card"><h2>Technician</h2>' + (cur ? '<p><b><a href="#/technicians/' + esc(cur.tech_code) + '">' + esc(cur.tech_code) + ' · ' + esc(cur.full_name) + '</a></b> · ' + esc(cur.mobile) + '<br><small style="color:var(--m)">Assigned ' + fmt(cur.assigned_at) + ' by ' + esc(cur.assigned_by || 'admin') + '</small></p>' : '<p class="err">No technician assigned yet.</p>') +
    (open ? '<div class="row noprint">' + (cur ? '<button class="btn ghost" id="fnd">Reassign to someone else</button>' : '<button class="btn o" id="fnd">Find technician</button>') + '</div><div id="cand"></div>' : '') + '</div>' +
    bookingMoneyCards(d, open) +
    '<div class="grid2"><div class="card"><h2>Assignment history</h2>' + (d.history.length ? '<ul class="list">' + d.history.map(function (h) { return '<li><b>' + esc(h.tech_code) + '</b> ' + esc(h.full_name) + (h.is_current ? ' ' + badge('active') : '') + '<br><small>' + fmt(h.assigned_at) + (h.ended_at ? ' to ' + fmt(h.ended_at) : '') + (h.reason ? ' · ' + esc(h.reason) : '') + '</small></li>'; }).join('') + '</ul>' : '<p class="empty">Nobody assigned yet.</p>') + '</div>' +
    '<div class="card"><h2>Activity</h2><ul class="list">' + d.activity.map(function (a) { var who = a.details && a.details.actor === 'technician' ? 'Technician ' + a.details.tech_code : (a.admin || 'System'); return '<li>' + esc(label(a.action.replace('booking.', '').replace('status.', 'status: '))) + (a.reason ? ': ' + esc(a.reason) : '') + '<br><small>' + esc(who) + ' · ' + fmt(a.created_at) + '</small></li>'; }).join('') + '</ul></div></div>');
  var reload = function () { route(); };
  bindBookingMoney(d, code, reload);
  if ($('#fnd')) $('#fnd').onclick = async function () {
    var box = $('#cand'); box.innerHTML = '<p>Finding technicians...</p>';
    async function load(area) {
      try {
        var c = await api('/bookings/' + code + '/candidates' + (area != null ? '?area=' + encodeURIComponent(area) : '')), only = $('#oa') ? $('#oa').checked : false;
        var rows = c.rows.filter(function (t) { return !t.is_current && (!only || t.area_match); });
        box.innerHTML = '<div class="note">Showing active, verified technicians approved for <b>' + esc(c.service) + '</b>. Best matches first: same area, then fewest open jobs, then rating.</div>' +
          '<div class="row noprint"><label class="fl">Area<input id="ar" value="' + esc(c.area) + '"></label><label class="ck" style="align-self:end"><input type="checkbox" id="oa"' + (only ? ' checked' : '') + '> Only this area</label><button class="btn" id="sr" style="align-self:end">Search</button></div>' +
          (rows.length ? '<div class="tw"><table><thead><tr><th>Technician</th><th>Base area</th><th>Open jobs</th><th>Same day</th><th>Rating</th><th></th></tr></thead><tbody>' + rows.map(function (t) { return '<tr><td><b>' + esc(t.tech_code) + '</b> ' + esc(t.full_name) + '<br><small style="color:var(--m)">' + esc(t.mobile) + (t.own_transport ? ' · own transport' : '') + '</small></td><td>' + esc(t.locality) + (t.area_match ? ' <span class="badge b-verified">Area match</span>' : '') + '</td><td>' + t.open_jobs + '</td><td>' + t.same_day_jobs + '</td><td>' + (t.rating || '-') + '</td><td><button class="btn o" data-as="' + esc(t.tech_code) + '" data-nm="' + esc(t.full_name) + '">Assign</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="empty">No matching technicians. Try another area, or approve more technicians for this service.</p>');
        $('#sr').onclick = function (e) { e.preventDefault(); load($('#ar').value.trim()); };
        $('#oa').onchange = function () { load($('#ar').value.trim()); };
        box.querySelectorAll('[data-as]').forEach(function (bt) {
          bt.onclick = async function () {
            var r = await ask('Assign ' + bt.dataset.nm + ' to ' + code + '?', !!cur, cur ? 'Reason for reassigning (required)' : 'Note for the technician (optional)', 'Assign'); if (r === null) return;
            try { await api('/bookings/' + code + '/assign', { method: 'POST', body: { technician_code: bt.dataset.as, reason: r } }); toast('Technician assigned'); reload(); } catch (er) { toast(er.message); }
          };
        });
      } catch (er) { box.innerHTML = '<p class="err">' + esc(er.message) + '</p>'; }
    }
    load();
  };
  if ($('#rs')) $('#rs').onclick = async function () {
    var v = await modal('Reschedule ' + code, '<label class="fl">New date and time <b class="rq">*</b><input type="datetime-local" id="nd" value="' + istInput(b.preferred_at) + '"></label><p><label class="fl">Reason <b class="rq">*</b><textarea id="rr" rows="2"></textarea></label></p>', 'Reschedule', function () { if (!$('#nd').value) return 'Choose a date and time.'; if ($('#rr').value.trim().length < 3) return 'Please enter a reason.'; return { at: $('#nd').value, reason: $('#rr').value.trim() }; });
    if (!v) return; try { await api('/bookings/' + code + '/reschedule', { method: 'POST', body: { preferred_at: v.at, reason: v.reason } }); toast('Rescheduled'); reload(); } catch (er) { toast(er.message); }
  };
  async function setStatus(st, reason) { try { await api('/bookings/' + code + '/status', { method: 'POST', body: { status: st, reason: reason } }); toast('Status updated'); reload(); } catch (er) { toast(er.message); } }
  if ($('#cn')) $('#cn').onclick = async function () { var r = await ask('Cancel booking ' + code + '?', true, 'Reason for cancelling', 'Cancel booking'); if (r !== null) setStatus('cancelled', r); };
  if ($('#st')) $('#st').onclick = async function () {
    var all = ['requested', 'confirmed', 'en_route', 'arrived', 'diagnosing', 'quote_pending', 'quote_accepted', 'quote_rejected', 'in_progress', 'completed', 'disputed'].filter(function (s) { return s !== b.work_status; }).map(function (s) { return [s, label(s)]; });
    var v = await modal('Change status of ' + code, '<label class="fl">New status<select id="ns">' + opts(all) + '</select></label><p><label class="fl">Reason (required for disputed and quote rejected)<textarea id="rr" rows="2"></textarea></label></p>', 'Update', function () { var s = $('#ns').value, r = $('#rr').value.trim(); if (['disputed', 'quote_rejected'].indexOf(s) > -1 && r.length < 3) return 'Please enter a reason.'; return { s: s, r: r }; });
    if (v) setStatus(v.s, v.r);
  };
}

// ---------- Stage 2: service categories ----------
async function categoriesView() {
  cats = null; var cs = await getCats();
  shell('<div class="row sb"><h1>Service categories</h1><button class="btn o" id="addc">+ Add service</button></div><p style="color:var(--m)">Technicians are approved per service, and bookings are matched to technicians by service. Retired services stay in history.</p>' +
    '<div class="card tw"><table><thead><tr><th>Order</th><th>Service</th><th>Inspection fee</th><th>Status</th><th></th></tr></thead><tbody>' + cs.map(function (c) { return '<tr><td>' + c.sort_order + '</td><td><b>' + esc(c.name) + '</b><br><small style="color:var(--m)">' + esc(c.description || '') + '</small></td><td>' + (c.inspection_fee != null ? inr(c.inspection_fee) : '-') + '</td><td>' + badge(c.is_active ? 'active' : 'inactive') + '</td><td><button class="btn ghost" data-e="' + c.id + '">Edit</button></td></tr>'; }).join('') + '</tbody></table></div>');
  async function edit(c) {
    c = c || { name: '', description: '', inspection_fee: '', sort_order: 50, is_active: true };
    var v = await modal(c.id ? 'Edit service' : 'Add service', '<label class="fl">Service name <b class="rq">*</b><input id="cn" value="' + esc(c.name) + '"></label><p><label class="fl">Description<input id="cd" value="' + esc(c.description) + '"></label></p><div class="grid2"><label class="fl">Inspection fee (₹)<input id="cf" type="number" min="0" value="' + esc(c.inspection_fee) + '"></label><label class="fl">Display order<input id="co" type="number" min="0" value="' + esc(c.sort_order) + '"></label></div>' + (c.id ? '<label class="ck"><input type="checkbox" id="ca"' + (c.is_active ? ' checked' : '') + '> Active</label><p><label class="fl">Reason (required to deactivate)<input id="cr"></label></p>' : ''), 'Save', function () { if (!$('#cn').value.trim()) return 'Service name is required.'; if (c.id && c.is_active && !$('#ca').checked && $('#cr').value.trim().length < 3) return 'Please give a reason for deactivating.'; return { name: $('#cn').value.trim(), description: $('#cd').value.trim(), inspection_fee: $('#cf').value, sort_order: $('#co').value, is_active: c.id ? $('#ca').checked : true, reason: c.id ? $('#cr').value.trim() : '' }; });
    if (!v) return; try { await api(c.id ? '/categories/' + c.id : '/categories', { method: c.id ? 'PATCH' : 'POST', body: v }); cats = null; toast('Saved'); route(); } catch (er) { toast(er.message); }
  }
  $('#addc').onclick = function () { edit(); };
  document.querySelectorAll('[data-e]').forEach(function (b) { b.onclick = function () { edit(cs.filter(function (c) { return String(c.id) === b.dataset.e; })[0]); }; });
}

// ---------- Stage 3: helpers ----------
function todayIST() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()); }
function addDays(s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dshort(s) { return new Date(s + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
function dpart(v) { return v ? String(v).slice(0, 10) : '-'; }
function short(v) { v = Number(v); var a = Math.abs(v); return a >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' : a >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : a >= 1e3 ? (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' : String(Math.round(v)); }
function nice(m) { if (m <= 4) return 4; var p = Math.pow(10, Math.floor(Math.log10(m))), f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
var PAL = ['#0f3a7d', '#f26b1d', '#1f9d55', '#7b5cd6', '#e0a800', '#d93025', '#2aa5b5', '#8892a6'];
function timeChart(days, keys, kind, money) {
  var rows = days;
  if (days.length > 45) { var size = days.length > 180 ? 30 : 7; rows = []; for (var i = 0; i < days.length; i += size) { var ch = days.slice(i, i + size), o = { day: ch[0].day }; keys.forEach(function (k) { o[k.k] = ch.reduce(function (a, x) { return a + x[k.k]; }, 0); }); rows.push(o); } }
  var W = 640, H = 220, pl = 48, pr = 10, pt = 12, pb = 28, n = rows.length, mx = 0;
  rows.forEach(function (r) { keys.forEach(function (k) { mx = Math.max(mx, r[k.k]); }); }); mx = nice(mx);
  var y = function (v) { return pt + (H - pt - pb) * (1 - v / mx); }, x = function (i) { return pl + (W - pl - pr) * (n === 1 ? .5 : i / (n - 1)); };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Chart">';
  for (var g = 0; g <= 4; g++) { var gv = mx * g / 4, gy = y(gv); s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy + '" y2="' + gy + '" stroke="#e3e8f2"/><text x="' + (pl - 6) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="11" fill="#64718a">' + (money ? short(gv) : Math.round(gv)) + '</text>'; }
  if (kind === 'bar') {
    var gw = (W - pl - pr) / n, bw = Math.max(2, Math.min(22, gw * .8 / keys.length));
    rows.forEach(function (r, i) { keys.forEach(function (k, j) { var h = (H - pt - pb) * r[k.k] / mx, bx = pl + gw * i + gw / 2 - bw * keys.length / 2 + bw * j; s += '<rect x="' + bx + '" y="' + (H - pb - h) + '" width="' + bw + '" height="' + h + '" rx="2" fill="' + k.c + '"><title>' + dshort(r.day) + ': ' + k.l + ' ' + (money ? inr(r[k.k]) : r[k.k]) + '</title></rect>'; }); });
  } else {
    keys.forEach(function (k, j) {
      var pts = rows.map(function (r, i) { return x(i) + ',' + y(r[k.k]); });
      if (j === 0 && n > 1) s += '<polygon points="' + x(0) + ',' + (H - pb) + ' ' + pts.join(' ') + ' ' + x(n - 1) + ',' + (H - pb) + '" fill="' + k.c + '" opacity=".12"/>';
      s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + k.c + '" stroke-width="2.5" stroke-linejoin="round"/>';
      rows.forEach(function (r, i) { s += '<circle cx="' + x(i) + '" cy="' + y(r[k.k]) + '" r="' + (n > 40 ? 0 : 3.5) + '" fill="' + k.c + '"><title>' + dshort(r.day) + ': ' + k.l + ' ' + (money ? inr(r[k.k]) : r[k.k]) + '</title></circle>'; });
    });
  }
  [0, Math.floor((n - 1) / 2), n - 1].filter(function (v, i, a) { return a.indexOf(v) === i; }).forEach(function (i) { s += '<text x="' + (kind === 'bar' ? pl + (W - pl - pr) / n * (i + .5) : x(i)) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#64718a">' + dshort(rows[i].day) + '</text>'; });
  return s + '</svg><div class="legend">' + keys.map(function (k) { return '<span><i style="background:' + k.c + '"></i>' + esc(k.l) + '</span>'; }).join('') + '</div>';
}
function donut(items, labelFn) {
  var tot = items.reduce(function (a, i) { return a + i.n; }, 0); if (!tot) return '<p class="empty">No data in this period.</p>';
  var acc = 0, stops = items.map(function (it, i) { var a = acc / tot * 100; acc += it.n; return PAL[i % PAL.length] + ' ' + a + '% ' + (acc / tot * 100) + '%'; });
  return '<div class="row" style="gap:18px"><div class="donut" style="background:conic-gradient(' + stops.join(',') + ')"><b>' + tot + '</b></div><div class="legend col">' + items.map(function (it, i) { return '<span><i style="background:' + PAL[i % PAL.length] + '"></i>' + esc(labelFn(it)) + ' · <b>' + it.n + '</b> (' + Math.round(it.n / tot * 100) + '%)</span>'; }).join('') + '</div></div>';
}
function hbars(rows, color, valFn, subFn) {
  var mx = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
  return rows.length ? rows.map(function (r) { return '<div class="hb"><div class="hl"><span>' + esc(r.l) + '</span><b>' + valFn(r) + '</b></div><div class="ht"><div style="width:' + Math.max(r.v > 0 ? 2 : 0, r.v / mx * 100) + '%;background:' + color + '"></div></div>' + (subFn ? '<small>' + subFn(r) + '</small>' : '') + '</div>'; }).join('') : '<p class="empty">No data in this period.</p>';
}
var STNAME = { requested: 'Requested', confirmed: 'Confirmed', assigned: 'Assigned', en_route: 'En route', arrived: 'Arrived', diagnosing: 'Diagnosing', quote_pending: 'Quote pending', quote_accepted: 'Quote accepted', quote_rejected: 'Quote rejected', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', disputed: 'Disputed' };

async function analyticsView(qp) {
  var t = todayIST(), p = qp.p || '30', from, to = t;
  if (p === 'today') from = t; else if (p === '7') from = addDays(t, -6); else if (p === '90') from = addDays(t, -89); else if (p === 'month') from = t.slice(0, 8) + '01';
  else if (p === 'lastmonth') { var f = new Date(t.slice(0, 8) + '01T00:00:00Z'); f.setUTCMonth(f.getUTCMonth() - 1); from = f.toISOString().slice(0, 10); to = addDays(t.slice(0, 8) + '01', -1); }
  else if (p === 'year') from = t.slice(0, 4) + '-01-01'; else if (p === 'custom' && qp.from && qp.to) { from = qp.from; to = qp.to; } else { p = '30'; from = addDays(t, -29); }
  var d = await api('/analytics?from=' + from + '&to=' + to), T = d.totals, S = d.snapshot, Pp = d.people, Q = d.quality;
  var net = T.collected - T.refunds, earn = net - T.commission, rate = T.orders ? Math.round(T.completed / T.orders * 100) : 0;
  var K = function (v, l, c, sub) { return '<div class="stat ' + (c || '') + '"><b>' + v + '</b><span>' + l + '</span>' + (sub ? '<small class="ks">' + sub + '</small>' : '') + '</div>'; };
  var chips = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year']];
  var fun = [['Orders received', T.orders], ['Technician assigned', T.assigned], ['Completed', T.completed], ['Payment recorded', T.paid]];
  shell('<div class="row sb"><h1>Analytics</h1><span style="color:var(--m)">' + dshort(from) + ' to ' + dshort(to) + '</span></div>' +
    '<div class="chips noprint">' + chips.map(function (c) { return '<a class="chip' + (p === c[0] ? ' on' : '') + '" href="#/analytics?p=' + c[0] + '">' + c[1] + '</a>'; }).join('') + '<form class="chip cu" id="cf"><input type="date" id="cfr" value="' + from + '" max="' + t + '" aria-label="From"> to <input type="date" id="cto" value="' + to + '" max="' + t + '" aria-label="To"><button class="btn" style="padding:6px 12px">Go</button></form></div>' +
    '<div class="cards">' + K(T.orders, 'Orders received', '', rate + '% completed') + K(T.completed, 'Completed', 'g') + K(T.cancelled, 'Cancelled', 'r') + K(S.open_now, 'Open orders now', 'o', S.unassigned + ' waiting for a technician') +
    K(inr(net), 'Cash collected (net of refunds)', 'o', T.payments + ' payments') + K(inr(T.commission), 'QuickFix commission (net)', 'g') + K(inr(earn), 'Technician earnings', '') + K(T.payments ? inr(Math.round(T.collected / T.payments)) : '-', 'Average order value', '') +
    K(inr(S.outstanding), 'Owed by technicians now', 'r', S.overdue + ' overdue · ' + S.awaiting_verification + ' to verify') + K(Q.rating != null ? Q.rating + ' ★' : '-', 'Average rating', '', Q.reviews + ' ratings') + K(Q.complaints, 'Complaints', Q.open_complaints ? 'r' : '', Q.open_complaints + ' open') +
    K(Pp.new_customers, 'New customers', '', Pp.repeat_customers + ' repeat') + K(Pp.new_techs, 'New technicians', '', Pp.active + ' active of ' + Pp.techs) + K(T.hours_assign != null ? T.hours_assign + ' h' : '-', 'Avg time to assign', '') + K(T.hours_complete != null ? T.hours_complete + ' h' : '-', 'Avg time to complete', '') + K(inr(T.refunds), 'Refunds', T.refunds ? 'r' : '') + '</div>' +
    '<div class="grid2"><div class="card"><h2>Orders over time</h2>' + timeChart(d.series, [{ k: 'orders', l: 'Received', c: '#0f3a7d' }, { k: 'completed', l: 'Completed', c: '#1f9d55' }], 'bar', false) + '</div>' +
    '<div class="card"><h2>Money over time</h2>' + timeChart(d.series, [{ k: 'collected', l: 'Cash collected', c: '#f26b1d' }, { k: 'commission', l: 'Commission', c: '#0f3a7d' }], 'line', true) + '</div></div>' +
    '<div class="grid2"><div class="card"><h2>Orders by status</h2>' + donut(d.status, function (i) { return STNAME[i.s] || i.s; }) + '</div>' +
    '<div class="card"><h2>Order funnel</h2>' + hbars(fun.map(function (f) { return { l: f[0], v: f[1] }; }), '#0f3a7d', function (r) { return r.v + (T.orders ? ' (' + Math.round(r.v / T.orders * 100) + '%)' : ''); }) + '</div></div>' +
    '<div class="card"><h2>Services: orders and money</h2>' + hbars(d.services.map(function (s) { return { l: s.name, v: s.orders, s: s }; }), '#f26b1d', function (r) { return r.v + ' orders'; }, function (r) { return r.s.completed + ' completed · collected ' + inr(r.s.collected) + ' · commission ' + inr(r.s.commission); }) + '</div>' +
    '<div class="grid2"><div class="card"><h2>Top areas</h2>' + hbars(d.areas.map(function (a) { return { l: a.area, v: a.orders, a: a }; }), '#0f3a7d', function (r) { return r.v + ' orders'; }, function (r) { return 'Collected ' + inr(r.a.collected); }) + '</div>' +
    '<div class="card"><h2>Where orders come from</h2>' + donut(d.sources, function (i) { return (SRC.filter(function (o) { return o[0] === i.s; })[0] || [0, label(i.s)])[1]; }) + '<h3 style="margin:16px 0 6px">Busiest days</h3>' + (function () { var nm = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], mp = {}; d.weekdays.forEach(function (w) { mp[w.d] = w.n; }); return hbars(nm.map(function (n, i) { return { l: n, v: mp[i + 1] || 0 }; }), '#7b5cd6', function (r) { return r.v; }); })() + '</div></div>' +
    '<div class="card tw"><h2>Technician leaderboard</h2>' + (d.technicians.length ? '<table><thead><tr><th>Technician</th><th>Jobs done</th><th>Assigned</th><th>Cash collected</th><th>Commission</th><th>Rating</th></tr></thead><tbody>' + d.technicians.map(function (x) { return '<tr><td><a href="#/technicians/' + esc(x.tech_code) + '"><b>' + esc(x.tech_code) + '</b></a> ' + esc(x.full_name) + '</td><td>' + x.jobs + '</td><td>' + x.assigned + '</td><td>' + inr(x.collected) + '</td><td>' + inr(x.commission) + '</td><td>' + (x.rating || '-') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="empty">No technician activity in this period.</p>') + '</div>' +
    '<div class="grid2"><div class="card"><h2>Technician cash health (today)</h2><dl class="kv"><dt>Commission owed</dt><dd>' + inr(S.owed) + '</dd><dt>Verified received</dt><dd>' + inr(S.settled) + '</dd><dt>Outstanding</dt><dd><b>' + inr(S.outstanding) + '</b></dd><dt>Overdue settlements</dt><dd>' + S.overdue + '</dd><dt>Awaiting your check</dt><dd>' + S.awaiting_verification + '</dd></dl><a class="btn ghost" href="#/settlements">Open settlements</a></div>' +
    '<div class="card"><h2>Biggest balances to collect</h2>' + (d.outstanding_top.length ? '<ul class="list">' + d.outstanding_top.map(function (o) { return '<li><a href="#/technicians/' + esc(o.tech_code) + '"><b>' + esc(o.tech_code) + '</b> ' + esc(o.full_name) + '</a> owes <b>' + inr(o.outstanding) + '</b></li>'; }).join('') + '</ul>' : '<p class="empty">Nothing outstanding.</p>') + '<h3 style="margin:14px 0 6px">Technician team</h3><div class="row"><span class="badge b-active">' + Pp.active + ' active</span><span class="badge b-pending">' + Pp.pending_verification + ' pending verification</span><span class="badge b-suspended">' + Pp.suspended + ' suspended</span></div></div></div>' +
    '<p class="noprint"><a class="btn ghost" href="#/reports">Download detailed reports</a> <button class="btn ghost" onclick="window.print()">Print / save as PDF</button></p>');
  $('#cf').onsubmit = function (e) { e.preventDefault(); var a = $('#cfr').value, b = $('#cto').value; if (!a || !b || a > b) { toast('Choose a valid date range'); return; } location.hash = '#/analytics?p=custom&from=' + a + '&to=' + b; };
}

// ---------- Stage 3: payments, settlements, reports ----------
async function paymentsView(qp) {
  var r = await api('/payments?' + new URLSearchParams(qp).toString());
  shell('<h1>Payments</h1><form class="card" id="flt"><div class="grid2"><label class="fl">Search<input id="fq" placeholder="Receipt, booking or technician" value="' + esc(qp.q) + '"></label><label class="fl">Method<select id="fm"><option value="">All</option>' + opts([['cash', 'Cash'], ['upi', 'UPI'], ['bank', 'Bank'], ['other', 'Other']], qp.method) + '</select></label>' +
    '<label class="fl">From<input type="date" id="ff" value="' + esc(qp.from) + '"></label><label class="fl">To<input type="date" id="ft" value="' + esc(qp.to) + '"></label></div><p><button class="btn">Apply</button></p></form>' +
    '<div class="cards"><div class="stat g"><b>' + inr(r.collected) + '</b><span>Collected (gross, filtered)</span></div><div class="stat o"><b>' + inr(r.commission) + '</b><span>Commission (net of refunds)</span></div><div class="stat"><b>' + r.total + '</b><span>Payments</span></div></div>' +
    '<div class="card tw">' + (r.rows.length ? '<table><thead><tr><th>Receipt</th><th>Date</th><th>Booking</th><th>Technician</th><th>Method</th><th>Collected</th><th>Commission</th><th>Refunded</th><th></th></tr></thead><tbody>' + r.rows.map(function (p) { return '<tr><td><b>' + esc(p.receipt_no) + '</b></td><td>' + fmt(p.paid_at) + '</td><td><a href="#/bookings/' + esc(p.booking_code) + '">' + esc(p.booking_code) + '</a></td><td><a href="#/technicians/' + esc(p.tech_code) + '">' + esc(p.tech_name) + '</a></td><td>' + esc(label(p.method)) + '</td><td>' + inr(p.amount_collected) + '</td><td>' + inr(p.commission) + '</td><td>' + (Number(p.refunded) ? inr(p.refunded) : '-') + '</td><td><a href="#/bookings/' + esc(p.booking_code) + '">Open</a></td></tr>'; }).join('') + '</tbody></table>' : '<p class="empty">No payments found.</p>') + '</div>' +
    pager(r, function (pg) { return '#/payments?' + new URLSearchParams(Object.assign({}, qp, { page: pg })).toString(); }));
  $('#flt').onsubmit = function (e) { e.preventDefault(); var p = { q: $('#fq').value.trim(), method: $('#fm').value, from: $('#ff').value, to: $('#ft').value }, o = {}; Object.keys(p).forEach(function (k) { if (p[k]) o[k] = p[k]; }); location.hash = '#/payments' + (Object.keys(o).length ? '?' + new URLSearchParams(o).toString() : ''); };
}
async function settlementsView(qp) {
  var r = await api('/settlements?' + new URLSearchParams(qp).toString()), un = await api('/settlements/unsettled');
  var tabs = [['', 'All'], ['pending', 'Pending'], ['submitted', 'Submitted'], ['verified', 'Verified'], ['rejected', 'Rejected'], ['overdue', 'Overdue']];
  shell('<h1>Settlements</h1><p style="color:var(--m)">Technicians collect cash from customers and owe QuickFix the commission. Create a settlement, the technician sends the money and reports it, then you confirm it arrived in your account.</p>' +
    '<div class="card"><h2>Ready to settle</h2>' + (un.length ? '<ul class="list">' + un.map(function (u) { return '<li class="row sb"><span><a href="#/technicians/' + esc(u.tech_code) + '"><b>' + esc(u.tech_code) + '</b> ' + esc(u.full_name) + '</a><br><small>' + u.entries + ' entries not yet in a settlement</small></span><span class="row"><b>' + inr(u.amount) + '</b>' + (Number(u.amount) > 0 ? '<button class="btn o" data-cs="' + esc(u.tech_code) + '" data-n="' + esc(u.full_name) + '" data-a="' + esc(u.amount) + '">Create settlement</button>' : '') + '</span></li>'; }).join('') + '</ul>' : '<p class="empty">Everything collected so far is already in a settlement.</p>') + '</div>' +
    '<div class="chips">' + tabs.map(function (t) { return '<a class="chip' + ((qp.status || '') === t[0] ? ' on' : '') + '" href="#/settlements' + (t[0] ? '?status=' + t[0] : '') + '">' + t[1] + '</a>'; }).join('') + '</div>' +
    '<div class="card tw">' + (r.rows.length ? '<table><thead><tr><th>Technician</th><th>Created</th><th>Due</th><th>Commission due</th><th>Verified received</th><th>Balance</th><th>Status</th></tr></thead><tbody>' + r.rows.map(function (s) { return '<tr><td><a href="#/settlements/' + esc(s.id) + '"><b>' + esc(s.tech_code) + '</b> ' + esc(s.full_name) + '</a></td><td>' + fmt(s.created_at) + '</td><td>' + dpart(s.due_date) + '</td><td>' + inr(s.commission_due) + '</td><td>' + inr(s.amount_settled) + '</td><td>' + inr(s.balance) + '</td><td>' + badge(s.status) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="empty">No settlements here yet.</p>') + '</div>' +
    pager(r, function (pg) { return '#/settlements?' + new URLSearchParams(Object.assign({}, qp, { page: pg })).toString(); }));
  document.querySelectorAll('[data-cs]').forEach(function (b) {
    b.onclick = async function () {
      var ok = await modal('Create settlement for ' + b.dataset.n + '?', '<p>This puts all their unsettled commission (<b>' + inr(b.dataset.a) + '</b>) into one settlement for them to pay.</p>', 'Create settlement'); if (!ok) return;
      try { var s = await api('/technicians/' + b.dataset.cs + '/settlements', { method: 'POST', body: {} }); toast('Settlement created'); location.hash = '#/settlements/' + s.id; } catch (e) { toast(e.message); }
    };
  });
}
async function settlementDetailView(id) {
  var d = await api('/settlements/' + id), s = d.settlement, open = s.status !== 'verified';
  var kv = function (r) { return '<dl class="kv">' + r.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1] == null || x[1] === '' ? '-' : x[1]) + '</dd>'; }).join('') + '</dl>'; };
  shell('<div class="card"><div class="row sb"><div><h1><a href="#/technicians/' + esc(s.tech_code) + '">' + esc(s.tech_code) + '</a> · ' + esc(s.full_name) + '</h1><div class="row" style="margin-top:6px">' + badge(s.status) + '<span style="color:var(--m)">Due ' + dpart(s.due_date) + '</span></div></div><div class="row noprint">' + (open ? '<button class="btn g" id="vf">Confirm money received</button>' : '') + (s.status === 'submitted' ? '<button class="btn r" id="rj">Reject</button>' : '') + '</div></div></div>' +
    '<div class="grid2"><div class="card"><h2>Amounts</h2>' + kv([['Cash collected (net)', inr(s.total_collected)], ['Commission due', inr(s.commission_due)], ['Verified received', inr(s.amount_settled)], ['Balance', inr(s.balance)]]) + '</div>' +
    '<div class="card"><h2>Payment details</h2>' + kv([['Technician says sent', s.submitted_amount != null ? inr(s.submitted_amount) + ' on ' + fmt(s.submitted_at) : 'Not reported yet'], ['Method', s.method ? label(s.method) : ''], ['Reference', s.reference], ['Verified by', s.verified_by_name ? s.verified_by_name + ' on ' + fmt(s.verified_at) : ''], ['Rejected because', s.reject_reason]]) + '</div></div>' +
    '<div class="card tw"><h2>Included entries</h2><table><thead><tr><th>Date</th><th>Entry</th><th>Booking</th><th>Receipt</th><th>Collected</th><th>Commission</th></tr></thead><tbody>' + d.items.map(function (i) { return '<tr><td>' + fmt(i.created_at) + '</td><td>' + esc(label(i.entry_type)) + (i.note ? '<br><small>' + esc(i.note) + '</small>' : '') + '</td><td>' + (i.booking_code ? '<a href="#/bookings/' + esc(i.booking_code) + '">' + esc(i.booking_code) + '</a>' : '-') + '</td><td>' + esc(i.receipt_no || '-') + '</td><td>' + (i.amount_collected ? inr(i.amount_collected) : '-') + '</td><td>' + inr(i.commission_amount) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
    '<div class="card"><h2>Activity</h2>' + (d.activity.length ? '<ul class="list">' + d.activity.map(function (a) { return '<li>' + esc(label(a.action)) + (a.reason ? ': ' + esc(a.reason) : '') + '<br><small>' + esc(a.admin || 'Technician or system') + ' · ' + fmt(a.created_at) + '</small></li>'; }).join('') + '</ul>' : '<p class="empty">No activity yet.</p>') + '</div>');
  if ($('#vf')) $('#vf').onclick = async function () {
    var v = await modal('Confirm money received', '<div class="note">Only confirm after you see the money in your bank or UPI account, or hold the cash.</div><label class="fl">Amount received (₹) <b class="rq">*</b><input id="va" type="number" min="1" step="0.01" value="' + esc(s.submitted_amount != null ? s.submitted_amount : s.commission_due) + '"></label><p><label class="fl">How was it paid?<select id="vm">' + opts([['upi', 'UPI'], ['bank', 'Bank transfer'], ['cash', 'Cash'], ['other', 'Other']], s.method || 'upi') + '</select></label></p><label class="fl">UPI / transfer reference<input id="vr" value="' + esc(s.reference) + '"></label>', 'Confirm received', function () { if (!(Number($('#va').value) > 0)) return 'Enter the amount received.'; if ($('#vm').value !== 'cash' && $('#vr').value.trim().length < 3) return 'Enter the reference number.'; return { amount: $('#va').value, method: $('#vm').value, reference: $('#vr').value.trim() }; });
    if (!v) return; try { await api('/settlements/' + id + '/verify', { method: 'POST', body: v }); toast('Settlement verified'); route(); } catch (e) { toast(e.message); }
  };
  if ($('#rj')) $('#rj').onclick = async function () { var r = await ask('Reject this settlement?', true, 'Reason (the technician will see it)', 'Reject'); if (r === null) return; try { await api('/settlements/' + id + '/reject', { method: 'POST', body: { reason: r } }); toast('Rejected'); route(); } catch (e) { toast(e.message); } };
}
var REPORTS = [['collections', 'Cash collections'], ['commission', 'Commission earned'], ['outstanding', 'Outstanding technician settlements'], ['settlements', 'Settlements received'], ['refunds', 'Refunds and adjustments'], ['performance', 'Technician performance and jobs completed'], ['onboarding', 'Technician onboarding and verification'], ['complaints', 'Customer complaints'], ['services', 'Service category performance']];
function cell(v, t) { if (v == null || v === '') return '-'; if (t === 'money') return inr(v); if (t === 'dt') return fmt(v); return esc(v); }
async function reportsView(qp) {
  var key = qp.r || 'collections', from = qp.from || addDays(todayIST(), -29), to = qp.to || todayIST();
  var r = await api('/reports/' + key + '?from=' + from + '&to=' + to);
  var csv = '/api/reports/' + key + '?format=csv&from=' + from + '&to=' + to;
  shell('<h1>Reports</h1><form class="card" id="rf"><div class="grid2"><label class="fl">Report<select id="rk">' + opts(REPORTS, key) + '</select></label>' + (r.dates ? '<div class="row"><label class="fl">From<input type="date" id="rfr" value="' + from + '"></label><label class="fl">To<input type="date" id="rto" value="' + to + '"></label></div>' : '<p style="color:var(--m);align-self:end">This report shows the position as of today.</p>') + '</div><div class="row" style="margin-top:12px"><button class="btn">Show report</button><a class="btn ghost" href="' + esc(csv) + '" download>Download CSV</a></div></form>' +
    '<div class="note">CSV files can contain personal details of technicians. Keep them private. Every download is recorded in the activity log.</div>' +
    '<div class="card tw"><h2>' + esc(r.title) + ' <small style="color:var(--m);font-weight:400">(' + r.rows.length + ' rows)</small></h2>' + (r.rows.length ? '<table><thead><tr>' + r.cols.map(function (c) { return '<th>' + esc(c[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' + r.rows.slice(0, 300).map(function (row) { return '<tr>' + r.cols.map(function (c) { return '<td>' + cell(row[c[0]], c[2]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>' + (r.rows.length > 300 ? '<p style="color:var(--m)">Showing the first 300 rows. Download the CSV for everything.</p>' : '') : '<p class="empty">No data for this period.</p>') + '</div>');
  $('#rf').onsubmit = function (e) { e.preventDefault(); var o = { r: $('#rk').value }; if ($('#rfr')) { o.from = $('#rfr').value; o.to = $('#rto').value; } location.hash = '#/reports?' + new URLSearchParams(o).toString(); };
}

// ---------- Stage 3: booking money cards ----------
function bookingMoneyCards(d, open) {
  var b = d.booking, cur = d.current, q = d.quote, ag = d.agreement;
  var canPay = cur && ['requested', 'confirmed', 'cancelled'].indexOf(b.work_status) < 0;
  var rule = ag ? ({ labour_only: 'Labour only', labour_and_parts: 'Labour and parts', fixed_per_job: 'Fixed per job', custom: 'Custom rule' }[ag.commission_basis] + (ag.commission_basis === 'fixed_per_job' ? ' ₹' + Number(ag.commission_rate) : ' ' + Number(ag.commission_rate) + '%')) : 'No agreement recorded';
  var qc = '<div class="card"><div class="row sb"><h2>Quotation</h2>' + (open ? '<button class="btn ghost noprint" id="qn">' + (q ? 'Revise quote' : 'Create quote') + '</button>' : '') + '</div>' + (q ? '<p>Version ' + q.version + ' ' + badge(q.status) + (q.approved_at ? ' <small>approved ' + fmt(q.approved_at) + '</small>' : '') + '</p><div class="tw"><table><thead><tr><th>Item</th><th>Type</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>' + q.items.map(function (i) { return '<tr><td>' + esc(i.description) + '</td><td>' + esc(label(i.kind)) + '</td><td>' + Number(i.qty) + '</td><td>' + inr(i.unit_price) + '</td><td>' + inr(Number(i.qty) * Number(i.unit_price)) + '</td></tr>'; }).join('') + '</tbody><tfoot><tr><td colspan="4"><b>Total</b></td><td><b>' + inr(q.total) + '</b></td></tr></tfoot></table></div>' +
    (open && q.status === 'pending' ? '<div class="row noprint" style="margin-top:10px"><button class="btn g" id="qa">Customer accepted</button><button class="btn r" id="qj">Customer rejected</button></div>' : '') : '<p class="empty">No quote yet. Create one after the technician has diagnosed the problem, and get the customer to approve it before repair starts.</p>') + '</div>';
  var pc = '<div class="card"><div class="row sb"><h2>Payments</h2>' + (canPay ? '<button class="btn o noprint" id="pp">Record payment</button>' : '') + '</div><p style="color:var(--m);margin:0 0 8px">Technician commission rule: <b>' + esc(rule) + '</b>' + (q && q.status === 'accepted' ? ' · Accepted quote ' + inr(q.total) : '') + '</p>' +
    (d.payments.length ? '<div class="tw"><table><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Collected</th><th>Commission</th><th>Technician share</th><th>Refunded</th><th></th></tr></thead><tbody>' + d.payments.map(function (p) { return '<tr><td><b>' + esc(p.receipt_no) + '</b></td><td>' + fmt(p.paid_at) + '</td><td>' + esc(label(p.method)) + '</td><td>' + inr(p.amount_collected) + '</td><td>' + inr(p.commission) + '</td><td>' + inr(p.technician_share) + '</td><td>' + (Number(p.refunded) ? inr(p.refunded) : '-') + '</td><td>' + (Number(p.refunded) < Number(p.amount_collected) ? '<button class="btn ghost noprint" data-rf="' + esc(p.receipt_no) + '" data-max="' + (Number(p.amount_collected) - Number(p.refunded)) + '">Refund</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="empty">No payment recorded yet. The technician can record it in their portal, or you can record it here.</p>') + '</div>';
  var stars = function (n) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); };
  var fc = '<div class="grid2"><div class="card"><div class="row sb"><h2>Customer rating</h2>' + (!d.review && cur ? '<button class="btn ghost noprint" id="rv">Add rating</button>' : '') + '</div>' + (d.review ? '<p style="font-size:22px;color:var(--o);margin:4px 0">' + stars(d.review.rating) + '</p><p>' + esc(d.review.comment || '') + '</p>' : '<p class="empty">No rating yet.</p>') + '</div>' +
    '<div class="card"><div class="row sb"><h2>Complaints</h2><button class="btn ghost noprint" id="cm">Add complaint</button></div>' + (d.complaints.length ? '<ul class="list">' + d.complaints.map(function (c) { return '<li>' + badge(c.status) + ' ' + esc(c.description) + (c.resolution ? '<br><small>Resolution: ' + esc(c.resolution) + '</small>' : '') + '<br><small>' + fmt(c.created_at) + '</small>' + (['open', 'investigating'].indexOf(c.status) > -1 ? ' <button class="btn ghost noprint" data-cr="' + esc(c.id) + '" style="padding:4px 10px">Update</button>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="empty">No complaints.</p>') + '</div></div>';
  return qc + pc + fc;
}
function bindBookingMoney(d, code, reload) {
  var b = d.booking, q = d.quote, ag = d.agreement;
  var go = async function (path, body, ok) { try { var r = await api(path, { method: 'POST', body: body }); toast(ok); reload(); return r; } catch (e) { toast(e.message); } };
  if ($('#qn')) $('#qn').onclick = async function () {
    var rows = ''; for (var i = 0; i < 6; i++) { var it = q && q.items[i]; rows += '<tr><td><select data-q="kind">' + opts([['labour', 'Labour'], ['parts', 'Parts'], ['travel', 'Travel'], ['other', 'Other']], it && it.kind) + '</select></td><td><input data-q="description" placeholder="Description" value="' + esc(it && it.description) + '"></td><td><input data-q="qty" type="number" min="0" step="0.5" value="' + esc(it ? Number(it.qty) : 1) + '" style="width:64px"></td><td><input data-q="unit_price" type="number" min="0" placeholder="₹" value="' + esc(it ? Number(it.unit_price) : '') + '" style="width:90px"></td></tr>'; }
    var v = await modal(q ? 'Revise quote' : 'Create quote', '<div class="tw"><table><thead><tr><th>Type</th><th>Item</th><th>Qty</th><th>Price</th></tr></thead><tbody>' + rows + '</tbody></table></div><p style="color:var(--m)">Leave unused rows blank. A revised quote replaces the old one and needs fresh customer approval.</p>', 'Save quote', function (dlg) {
      var items = []; dlg.querySelectorAll('tbody tr').forEach(function (tr) { var g = function (k) { return tr.querySelector('[data-q=' + k + ']').value; }; if (g('description').trim()) items.push({ kind: g('kind'), description: g('description').trim(), qty: g('qty'), unit_price: g('unit_price') }); });
      return items.length ? { items: items } : 'Add at least one line.';
    }); if (v) go('/bookings/' + code + '/quote', v, 'Quote saved');
  };
  if ($('#qa')) $('#qa').onclick = function () { go('/bookings/' + code + '/quote/accepted', {}, 'Quote accepted'); };
  if ($('#qj')) $('#qj').onclick = async function () { var r = await ask('Customer rejected the quote?', true, 'Reason', 'Mark rejected'); if (r !== null) go('/bookings/' + code + '/quote/rejected', { reason: r }, 'Quote rejected'); };
  if ($('#pp')) $('#pp').onclick = async function () {
    var hint = ag ? (ag.commission_basis === 'custom' ? 'This technician has a custom rule. Enter the commission amount below.' : 'Commission is worked out automatically from the technician\'s agreement. You can override it below.') : 'No agreement recorded for this technician.';
    var v = await modal('Record payment for ' + code, '<div class="note">' + esc(hint) + (q && q.status === 'accepted' ? ' Accepted quote: ' + inr(q.total) + '.' : '') + '</div><div class="grid2"><label class="fl">Labour (₹)<input id="pl" type="number" min="0" step="0.01" value="' + (q ? q.items.filter(function (i) { return i.kind === 'labour'; }).reduce(function (a, i) { return a + Number(i.qty) * Number(i.unit_price); }, 0) : '') + '"></label><label class="fl">Parts (₹)<input id="pa" type="number" min="0" step="0.01" value="' + (q ? q.items.filter(function (i) { return i.kind === 'parts'; }).reduce(function (a, i) { return a + Number(i.qty) * Number(i.unit_price); }, 0) : '') + '"></label><label class="fl">Discount (₹)<input id="pd" type="number" min="0" step="0.01"></label><label class="fl">Amount collected (₹) <b class="rq">*</b><input id="pc" type="number" min="1" step="0.01" value="' + (q && q.status === 'accepted' ? q.total : '') + '"></label></div><p><label class="fl">Paid by<select id="pm">' + opts([['cash', 'Cash'], ['upi', 'UPI'], ['bank', 'Bank'], ['other', 'Other']]) + '</select></label></p><label class="fl">Commission override (₹, optional' + (ag && ag.commission_basis === 'custom' ? ', required' : '') + ')<input id="po" type="number" min="0" step="0.01"></label>', 'Record payment', function () { if (!(Number($('#pc').value) > 0)) return 'Enter the amount collected.'; if (ag && ag.commission_basis === 'custom' && $('#po').value === '') return 'Enter the commission amount.'; return { labour: $('#pl').value, parts: $('#pa').value, discount: $('#pd').value, collected: $('#pc').value, method: $('#pm').value, commission_override: $('#po').value }; });
    if (v) { var r = await go('/bookings/' + code + '/payment', v, 'Recorded'); }
  };
  document.querySelectorAll('[data-rf]').forEach(function (bt) {
    bt.onclick = async function () {
      var v = await modal('Refund on ' + bt.dataset.rf, '<label class="fl">Refund amount (₹) <b class="rq">*</b><input id="ra" type="number" min="1" max="' + bt.dataset.max + '" step="0.01" value="' + bt.dataset.max + '"></label><p><label class="fl">Reason <b class="rq">*</b><textarea id="rr" rows="2"></textarea></label></p><div class="note">The technician\'s commission is reduced in the same proportion.</div>', 'Refund', function () { if (!(Number($('#ra').value) > 0)) return 'Enter the refund amount.'; if ($('#rr').value.trim().length < 3) return 'Enter a reason.'; return { amount: $('#ra').value, reason: $('#rr').value.trim() }; });
      if (v) go('/payments/' + bt.dataset.rf + '/refund', v, 'Refund recorded');
    };
  });
  if ($('#rv')) $('#rv').onclick = async function () { var v = await modal('Customer rating', '<label class="fl">Rating (1 to 5)<select id="rt">' + opts([[5, '5 - Excellent'], [4, '4 - Good'], [3, '3 - Okay'], [2, '2 - Poor'], [1, '1 - Very poor']], 5) + '</select></label><p><label class="fl">Comment<textarea id="rc" rows="2"></textarea></label></p>', 'Save', function () { return { rating: $('#rt').value, comment: $('#rc').value.trim() }; }); if (v) go('/bookings/' + code + '/review', v, 'Rating saved'); };
  if ($('#cm')) $('#cm').onclick = async function () { var r = await ask('Record a complaint', true, 'What happened?', 'Save complaint'); if (r !== null) go('/bookings/' + code + '/complaints', { description: r }, 'Complaint recorded'); };
  document.querySelectorAll('[data-cr]').forEach(function (bt) {
    bt.onclick = async function () {
      var v = await modal('Update complaint', '<label class="fl">Status<select id="cs">' + opts([['investigating', 'Investigating'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed']], 'resolved') + '</select></label><p><label class="fl">Resolution / notes<textarea id="cn" rows="2"></textarea></label></p>', 'Save', function () { if (['resolved', 'dismissed'].indexOf($('#cs').value) > -1 && $('#cn').value.trim().length < 3) return 'Write the resolution.'; return { status: $('#cs').value, resolution: $('#cn').value.trim() }; });
      if (v) try { await api('/complaints/' + bt.dataset.cr, { method: 'PATCH', body: v }); toast('Updated'); reload(); } catch (e) { toast(e.message); }
    };
  });
}

// ---------- Stage 3: technician money card ----------
function techMoneyCard(p) {
  var s = p.stats;
  return '<div class="card"><div class="row sb"><h2>Cash and commission</h2><span class="row noprint"><button class="btn o" id="cs">Create settlement</button><button class="btn ghost" id="ad">Add adjustment</button></span></div>' +
    '<p style="color:var(--m)">Cash collected ' + inr(s.cash) + ' · Commission owed ' + inr(s.owed) + ' · Settled (verified) ' + inr(s.settled) + ' · <b>Outstanding ' + inr(s.outstanding) + '</b></p>' +
    '<h3>Settlements</h3>' + (p.settlements.length ? '<ul class="list">' + p.settlements.map(function (x) { return '<li><a href="#/settlements/' + esc(x.id) + '">' + inr(x.commission_due) + ' due ' + dpart(x.due_date) + '</a> ' + badge(x.status) + ' <small>received ' + inr(x.amount_settled) + ' · balance ' + inr(x.balance) + '</small></li>'; }).join('') + '</ul>' : '<p class="empty">No settlements yet.</p>') +
    '<h3 style="margin-top:12px">Ledger (latest 25)</h3>' + (p.ledger.length ? '<div class="tw"><table><thead><tr><th>Date</th><th>Entry</th><th>Booking</th><th>Receipt</th><th>Collected</th><th>Commission</th><th>In settlement</th></tr></thead><tbody>' + p.ledger.map(function (l) { return '<tr><td>' + fmt(l.created_at) + '</td><td>' + esc(label(l.entry_type)) + (l.note ? '<br><small>' + esc(l.note) + '</small>' : '') + '</td><td>' + (l.booking_code ? '<a href="#/bookings/' + esc(l.booking_code) + '">' + esc(l.booking_code) + '</a>' : '-') + '</td><td>' + esc(l.receipt_no || '-') + '</td><td>' + (l.amount_collected ? inr(l.amount_collected) : '-') + '</td><td>' + inr(l.commission_amount) + '</td><td>' + (l.settled ? 'Yes' : 'No') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="empty">No cash or commission entries yet.</p>') + '</div>';
}
function bindTechMoney(code, t, reload) {
  if ($('#cs')) $('#cs').onclick = async function () { var ok = await modal('Create settlement for ' + t.full_name + '?', '<p>All unsettled commission goes into one settlement for them to pay.</p>', 'Create settlement'); if (!ok) return; try { var s = await api('/technicians/' + code + '/settlements', { method: 'POST', body: {} }); toast('Settlement created'); location.hash = '#/settlements/' + s.id; } catch (e) { toast(e.message); } };
  if ($('#ad')) $('#ad').onclick = async function () { var v = await modal('Commission adjustment', '<label class="fl">Amount (₹) <b class="rq">*</b><input id="aa" type="number" step="0.01" placeholder="e.g. -50 to reduce, 50 to add"></label><p><label class="fl">Reason <b class="rq">*</b><textarea id="ar" rows="2"></textarea></label></p>', 'Save adjustment', function () { if (!Number($('#aa').value)) return 'Enter an amount (not zero).'; if ($('#ar').value.trim().length < 3) return 'Enter a reason.'; return { amount: $('#aa').value, reason: $('#ar').value.trim() }; }); if (v) try { await api('/technicians/' + code + '/adjustments', { method: 'POST', body: v }); toast('Adjustment saved'); reload(); } catch (e) { toast(e.message); } };
}

// ---------- router ----------
async function route() {
  var h = (location.hash || '#/dashboard').slice(2).split('?'), path = h[0], qp = Object.fromEntries(new URLSearchParams(h[1] || ''));
  try {
    if (!me) { try { me = await api('/me'); } catch (e) { me = null; } }
    if (!me) return loginView();
    var m;
    if (path === 'login' || path === '') { location.hash = '#/dashboard'; return; }
    if (path === 'dashboard') return await dashboardView();
    if (path === 'technicians') return await listView(qp);
    if (path === 'technicians/new') return await formView();
    if ((m = path.match(/^technicians\/(QFB-TECH-\d+)\/edit$/))) return await formView(m[1]);
    if ((m = path.match(/^technicians\/(QFB-TECH-\d+)$/))) return await profileView(m[1]);
    if (path === 'bookings') return await bookingListView(qp);
    if (path === 'bookings/new') return await bookingFormView();
    if ((m = path.match(/^bookings\/(QF-\d+)$/))) return await bookingDetailView(m[1]);
    if (path === 'categories') return await categoriesView();
    if (path === 'analytics') return await analyticsView(qp);
    if (path === 'payments') return await paymentsView(qp);
    if (path === 'settlements') return await settlementsView(qp);
    if ((m = path.match(/^settlements\/([0-9a-f-]{36})$/))) return await settlementDetailView(m[1]);
    if (path === 'reports') return await reportsView(qp);
    if (path === 'soon') return shell('<h1>Coming in Stage 3</h1><div class="card"><p>Cash collection and the commission ledger, settlement verification, and reports with CSV export are the next stage. The database tables for them already exist.</p><a class="btn" href="#/dashboard">Back to dashboard</a></div>');
    shell('<h1>Page not found</h1><a class="btn" href="#/dashboard">Back to dashboard</a>');
  } catch (e) {
    if (e.status === 401) { me = null; return loginView(); }
    if (me) shell('<div class="card"><h2>Something went wrong</h2><p class="err">' + esc(e.message) + '</p><a class="btn" href="#/dashboard">Back to dashboard</a></div>'); else loginView();
  }
}
window.addEventListener('hashchange', route);
route();
})();
