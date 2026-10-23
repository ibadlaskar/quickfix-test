(function () {
'use strict';
var $ = function (s, r) { return (r || document).querySelector(s); }, app = $('#app'), me = null, scope = 'open', timer = null;
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmt(d) { return d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : 'Time not fixed'; }
function label(s) { s = String(s || '').replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }
function toast(m) { var t = $('#toast'); t.textContent = m; t.className = 'show'; setTimeout(function () { t.className = ''; }, 2600); }
async function api(path, o) {
  o = o || {};
  var r = await fetch('/api' + path, { method: o.method || 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-QFB': '1' }, body: o.body ? JSON.stringify(o.body) : undefined });
  var d = {}; try { d = await r.json(); } catch (e) {}
  if (!r.ok) { var e = new Error(d.error || 'Something went wrong'); e.status = r.status; throw e; }
  return d;
}
function head(withButtons) {
  return '<div class="hd"><div class="in"><img src="logo.jpg" alt="QuickFix Barak"><div><b>QuickFix Barak</b><small>Technician portal</small></div><span class="sp"></span>' + (withButtons ? '<button id="pw">Password</button><button id="out">Sign out</button>' : '') + '</div></div>';
}
function loginView(msg) {
  clearInterval(timer);
  app.innerHTML = head(false) + '<div class="wrap"><div class="card" style="margin-top:20px"><h1>Sign in</h1><p style="color:var(--m)">Use your Technician ID (like QFB-TECH-0001) or your registered mobile number.</p><form id="lf" style="display:grid;gap:14px"><label class="fl">Technician ID or mobile number<input id="li" autocomplete="username" autocapitalize="characters" required></label><label class="fl">Password<input id="lp" type="password" autocomplete="current-password" required></label><p class="err" id="le" role="alert">' + esc(msg || '') + '</p><button class="btn o" style="justify-content:center;padding:13px">Sign in</button></form><p style="color:var(--m);font-size:13px;margin-bottom:0">Forgot your password? Ask QuickFix Barak to reset it.</p></div></div>';
  $('#lf').onsubmit = async function (e) {
    e.preventDefault(); $('#le').textContent = '';
    try { me = await api('/tech/login', { method: 'POST', body: { id: $('#li').value, password: $('#lp').value } }); me.must_change ? pwView(true) : jobsView(); } catch (er) { $('#le').textContent = er.message; }
  };
}
function pwView(forced) {
  clearInterval(timer);
  app.innerHTML = head(!forced) + '<div class="wrap"><div class="card" style="margin-top:20px"><h1>' + (forced ? 'Set your own password' : 'Change password') + '</h1>' + (forced ? '<div class="note">For your safety, choose a new password before you continue.</div>' : '') + '<form id="pf" style="display:grid;gap:14px"><label class="fl">Current ' + (forced ? 'temporary ' : '') + 'password<input id="p0" type="password" autocomplete="current-password" required></label><label class="fl">New password (8+ characters)<input id="p1" type="password" autocomplete="new-password" minlength="8" required></label><p class="err" id="pe" role="alert"></p><div class="row"><button class="btn o">Save password</button>' + (forced ? '' : '<button type="button" class="btn ghost" id="bk">Back</button>') + '</div></form></div></div>';
  if (!forced) { $('#bk').onclick = jobsView; bar(); }
  $('#pf').onsubmit = async function (e) {
    e.preventDefault();
    try { await api('/tech/password', { method: 'POST', body: { current: $('#p0').value, password: $('#p1').value } }); me.must_change = false; toast('Password saved'); jobsView(); } catch (er) { $('#pe').textContent = er.message; }
  };
}
function bar() {
  if ($('#out')) $('#out').onclick = async function () { try { await api('/tech/logout', { method: 'POST', body: {} }); } catch (e) {} me = null; loginView(); };
  if ($('#pw')) $('#pw').onclick = function () { pwView(false); };
}
var NEXT = { assigned: ['en_route', 'On my way'], en_route: ['arrived', 'I have arrived'], arrived: ['in_progress', 'Start work'], diagnosing: ['in_progress', 'Start work'], quote_accepted: ['in_progress', 'Start work'], in_progress: ['completed', 'Mark job completed'] };
function note(title, ok) {
  return new Promise(function (res) {
    var d = $('#dlg'); d.innerHTML = '<form method="dialog"><h2>' + esc(title) + '</h2><p><label class="fl">Note for the office (optional)<textarea id="nn" rows="2"></textarea></label></p><div class="row"><button class="btn o" value="ok">' + esc(ok) + '</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div></form>';
    d.showModal(); d.onclose = function () { res(d.returnValue === 'ok' ? $('#nn').value.trim() : null); };
  });
}
function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
function modal(title, body, ok, getVals) {
  return new Promise(function (res) {
    var d = $('#dlg'), out = null;
    d.innerHTML = '<form method="dialog"><h2>' + esc(title) + '</h2>' + body + '<p class="err" id="re"></p><div class="row"><button class="btn o" value="ok">' + esc(ok) + '</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div></form>';
    d.showModal();
    $('form', d).onsubmit = function (e) { if (e.submitter.value !== 'ok') return; var r = getVals(d); if (typeof r === 'string') { e.preventDefault(); $('#re').textContent = r; } else out = r; };
    d.onclose = function () { res(d.returnValue === 'ok' ? out : null); };
  });
}
var METH = '<option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank transfer</option><option value="other">Other</option>';
async function moneyView() {
  var m; try { m = await api('/tech/money'); } catch (e) { if (e.status === 401) { me = null; return loginView('Please sign in again.'); } toast(e.message); return; }
  app.innerHTML = head(true) + '<div class="wrap"><p style="margin:14px 0 0">Hello, <b>' + esc(me.name) + '</b> <span class="badge">' + esc(me.tech_code) + '</span></p>' + tabs('money') +
    '<div class="card"><h3>Money to send to QuickFix</h3><div class="idbox" style="margin:6px 0">' + inr(m.outstanding) + '</div><p class="m" style="color:var(--m);margin:0">Commission owed ' + inr(m.owed) + ' · already received by QuickFix ' + inr(m.settled) + '<br>Total cash you collected from customers: ' + inr(m.collected) + '</p></div>' +
    '<h3 style="margin:14px 0 8px">Settlements</h3>' + (m.settlements.length ? m.settlements.map(function (s) {
      var can = s.status === 'pending' || s.status === 'rejected';
      return '<div class="job"><div class="top2"><div><h3>' + inr(s.commission_due) + '</h3><div class="m">Due ' + esc(String(s.due_date).slice(0, 10)) + '</div></div><span class="badge b-' + esc(s.status) + '">' + esc(label(s.status)) + '</span></div><p class="m">Received so far ' + inr(s.amount_settled) + ' · Balance ' + inr(s.balance) + '</p>' + (s.status === 'rejected' && s.reject_reason ? '<p class="err">Office says: ' + esc(s.reject_reason) + '</p>' : '') + (s.status === 'submitted' ? '<p class="m">You reported ' + inr(s.submitted_amount) + '. Waiting for the office to confirm.</p>' : '') +
        (can ? '<button class="btn o next" data-sub="' + esc(s.id) + '" data-bal="' + esc(s.balance) + '">I have sent the money</button>' : '') + '</div>';
    }).join('') : '<div class="card"><p class="empty" style="margin:0">No settlements yet. The office creates one when commission is due.</p></div>') +
    '<p style="text-align:center"><button class="btn ghost" id="rf">Refresh</button></p></div>';
  bar(); wireTabs();
  document.querySelectorAll('[data-sub]').forEach(function (b) {
    b.onclick = async function () {
      var v = await modal('Report your payment', '<div class="note">The office checks their account and confirms. Your report does not close the settlement by itself.</div><label class="fl">Amount sent (₹)<input id="sa" type="number" min="1" step="0.01" value="' + esc(b.dataset.bal) + '"></label><p><label class="fl">How did you pay?<select id="sm">' + METH.replace('<option value="cash">', '<option value="upi">UPI</option><option value="cash">').replace('<option value="upi">UPI</option><option value="bank">', '<option value="bank">') + '</select></label></p><label class="fl">UPI / transfer reference number<input id="sr" autocomplete="off"></label>', 'Submit', function () { if (!(Number($('#sa').value) > 0)) return 'Enter the amount.'; if ($('#sm').value !== 'cash' && $('#sr').value.trim().length < 3) return 'Enter the reference number.'; return { amount: $('#sa').value, method: $('#sm').value, reference: $('#sr').value.trim() }; });
      if (!v) return; try { await api('/tech/settlements/' + b.dataset.sub + '/submit', { method: 'POST', body: v }); toast('Reported. Waiting for the office.'); moneyView(); } catch (er) { toast(er.message); }
    };
  });
  $('#rf').onclick = moneyView; clearInterval(timer);
}
function tabs(on) { return '<div class="tabs"><button id="t1" class="' + (on === 'open' ? 'on' : '') + '">Open jobs</button><button id="t2" class="' + (on === 'done' ? 'on' : '') + '">Completed</button><button id="t3" class="' + (on === 'money' ? 'on' : '') + '">Money</button></div>'; }
function wireTabs() { $('#t1').onclick = function () { scope = 'open'; jobsView(); }; $('#t2').onclick = function () { scope = 'done'; jobsView(); }; $('#t3').onclick = function () { scope = 'money'; jobsView(); }; }
async function jobsView(silent) {
  if (scope === 'money') return moneyView();
  if (!me) return loginView();
  var jobs; try { jobs = await api('/tech/jobs?scope=' + scope); } catch (e) { if (e.status === 401) { me = null; return loginView('Please sign in again.'); } toast(e.message); return; }
  var open = scope === 'open';
  app.innerHTML = head(true) + '<div class="wrap"><p style="margin:14px 0 0">Hello, <b>' + esc(me.name) + '</b> <span class="badge">' + esc(me.tech_code) + '</span></p>' + tabs(open ? 'open' : 'done') +
    (jobs.length ? jobs.map(function (j) {
      var n = NEXT[j.work_status], maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(j.address + ', ' + j.locality);
      return '<div class="job"><div class="top2"><div><h3>' + esc(j.service) + '</h3><div class="m">' + esc(j.booking_code) + '</div></div><span class="badge b-' + esc(j.work_status) + '">' + esc(label(j.work_status)) + '</span></div>' +
        '<p><b>' + esc(fmt(j.preferred_at)) + '</b></p><p>' + esc(j.customer_name) + '<br>' + esc(j.address) + ', ' + esc(j.locality) + '</p>' + (j.problem ? '<p class="m">Problem: ' + esc(j.problem) + '</p>' : '') + (Number(j.inspection_fee) > 0 ? '<p class="m">Inspection fee: ₹' + esc(j.inspection_fee) + '</p>' : '') +
        (j.customer_mobile ? '<div class="acts"><a class="btn ghost" href="tel:+91' + esc(j.customer_mobile) + '">Call</a><a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/91' + esc(j.customer_mobile) + '">WhatsApp</a><a class="btn ghost" target="_blank" rel="noopener" href="' + maps + '">Map</a></div>' : '') +
        (Number(j.quote_total) > 0 ? '<p class="m">Quote ' + inr(j.quote_total) + ' (' + esc(label(j.quote_status)) + ')</p>' : '') + (Number(j.paid) > 0 ? '<p class="m"><b>Payment recorded: ' + inr(j.paid) + '</b></p>' : '') +
        ((j.work_status === 'in_progress' || j.work_status === 'completed') && !(Number(j.paid) > 0) ? '<button class="btn g next" data-pay="' + esc(j.booking_code) + '" data-q="' + esc(j.quote_total || '') + '">Record payment collected</button>' : '') +
        (open && n ? '<button class="btn o next" data-c="' + esc(j.booking_code) + '" data-s="' + n[0] + '" data-l="' + n[1] + '">' + n[1] + '</button>' : '') + '</div>';
    }).join('') : '<div class="card"><p class="empty" style="margin:0">' + (open ? 'No open jobs right now. New jobs appear here when the office assigns them to you.' : 'No completed jobs yet.') + '</p></div>') +
    '<p style="text-align:center"><button class="btn ghost" id="rf">Refresh</button></p></div>';
  bar();
  wireTabs(); $('#rf').onclick = function () { jobsView(); };
  document.querySelectorAll('[data-pay]').forEach(function (b) {
    b.onclick = async function () {
      var v = await modal('Payment for ' + b.dataset.pay, '<div class="note">Enter what the customer actually paid you. QuickFix commission is worked out from your agreement.' + (b.dataset.q && Number(b.dataset.q) > 0 ? ' Quote: ' + inr(b.dataset.q) + '.' : '') + '</div><div class="grid2"><label class="fl">Labour (₹)<input id="pl" type="number" min="0" step="0.01"></label><label class="fl">Parts (₹)<input id="pa" type="number" min="0" step="0.01"></label><label class="fl">Discount (₹)<input id="pd" type="number" min="0" step="0.01"></label><label class="fl">Total collected (₹) *<input id="pc" type="number" min="1" step="0.01" value="' + esc(b.dataset.q || '') + '"></label></div><p><label class="fl">Paid by<select id="pm">' + METH + '</select></label></p>', 'Save payment', function () { if (!(Number($('#pc').value) > 0)) return 'Enter the total collected.'; return { labour: $('#pl').value, parts: $('#pa').value, discount: $('#pd').value, collected: $('#pc').value, method: $('#pm').value }; });
      if (!v) return; try { var r = await api('/tech/jobs/' + b.dataset.pay + '/payment', { method: 'POST', body: v }); toast('Saved. Receipt ' + r.receipt_no + '. Commission ' + inr(r.commission)); jobsView(); } catch (er) { toast(er.message); }
    };
  });
  document.querySelectorAll('[data-s]').forEach(function (b) {
    b.onclick = async function () {
      var r = await note(b.dataset.l + '? (' + b.dataset.c + ')', 'Confirm'); if (r === null) return;
      try { await api('/tech/jobs/' + b.dataset.c + '/status', { method: 'POST', body: { status: b.dataset.s, note: r } }); toast('Updated'); jobsView(); } catch (er) { toast(er.message); }
    };
  });
  clearInterval(timer); timer = setInterval(function () { if (!$('#dlg').open) jobsView(true); }, 60000);
}
(async function () {
  try { me = await api('/tech/me'); me.must_change ? pwView(true) : jobsView(); } catch (e) { loginView(); }
})();
})();
