(() => {
  'use strict';
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const state = { services: [], user: null, enrollmentToken: null, resetToken: null, authMode: 'login', authStep: 'start', otpMobile: '', resetMobile: '', selectedService: null };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let toastTimer;
  function toast(message, error=false) { const el=$('#toast'); el.textContent=message; el.className='toast show'+(error?' error':''); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.className='toast',3800); }
  async function api(path, options={}) {
    const method=options.method||'GET';
    const headers={};
    if(method!=='GET'){headers['Content-Type']='application/json';headers['X-QFB']='1';}
    const res=await fetch('/api'+path,{method,headers,credentials:'same-origin',cache:'no-store',body:options.body?JSON.stringify(options.body):undefined});
    const data=await res.json().catch(()=>({error:'The server returned an unreadable response.'}));
    if(!res.ok) throw new Error(data.error||'Request failed. Please try again.');
    return data;
  }
  const statusLabel = v => String(v||'requested').replaceAll('_',' ');
  const statusClass = v => String(v||'requested').replace(/[^a-z0-9_-]/g,'');
  function showAccount() { $('#account').classList.remove('hidden'); $('#dashboard').classList.add('hidden'); $('#account').scrollIntoView({behavior:'smooth',block:'start'}); }
  function setTab(mode) { state.authMode=mode; state.authStep='start'; state.enrollmentToken=null; state.resetToken=null; $$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===mode)); renderAuth(); }
  function renderAuth() {
    const root=$('#authContent');
    if(state.authMode==='signup') {
      if(state.authStep==='otp') root.innerHTML=`<h3 class="form-title">Verify your mobile</h3><p class="form-subtitle">Enter the OTP sent to +91 ${esc(state.otpMobile)}.</p><form class="form-stack" id="signupOtpForm"><label>One-time password<input name="code" inputmode="numeric" autocomplete="one-time-code" minlength="4" maxlength="10" required></label><button class="button button-dark full-width" type="submit">Verify mobile</button><button class="text-button" type="button" id="resendOtp">Resend OTP</button><button class="text-button" type="button" id="changeMobile">Use a different number</button></form>`;
      else if(state.authStep==='profile') root.innerHTML=`<h3 class="form-title">Finish creating your account</h3><p class="form-subtitle">Your mobile number is verified. Set a password for future logins.</p><form class="form-stack" id="signupProfileForm"><label>Full name<input name="name" autocomplete="name" maxlength="120" required></label><label>Mobile number<input value="+91 ${esc(state.otpMobile)}" disabled></label><label>Address<input name="address" maxlength="300" autocomplete="street-address" required></label><label>Town / locality<input name="locality" maxlength="100" placeholder="Hailakandi" required></label><label>Create password<input name="password" type="password" minlength="10" autocomplete="new-password" required><span class="fine-print">Use at least 10 characters.</span></label><button class="button button-dark full-width" type="submit">Create account</button></form>`;
      else root.innerHTML=`<h3 class="form-title">Create your account</h3><p class="form-subtitle">Verify your mobile number first. You'll set a password after verification.</p><form class="form-stack" id="signupStartForm"><label>Indian mobile number<input name="mobile" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="10-digit mobile number" pattern="[6-9][0-9]{9}" maxlength="10" required></label><button class="button button-dark full-width" type="submit">Send OTP</button></form><p class="fine-print">OTP delivery requires the service's configured SMS provider.</p>`;
    } else if(state.authStep==='forgotStart') root.innerHTML=`<h3 class="form-title">Reset your password</h3><p class="form-subtitle">We'll verify the mobile number before allowing a password reset.</p><form class="form-stack" id="forgotStartForm"><label>Registered mobile number<input name="mobile" type="tel" inputmode="numeric" pattern="[6-9][0-9]{9}" maxlength="10" required placeholder="10-digit mobile number"></label><button class="button button-dark full-width" type="submit">Send reset OTP</button><button class="text-button" type="button" id="backToLogin">Back to login</button></form>`;
    else if(state.authStep==='forgotOtp') root.innerHTML=`<h3 class="form-title">Verify and reset</h3><p class="form-subtitle">Enter the OTP sent to +91 ${esc(state.resetMobile)}.</p><form class="form-stack" id="forgotOtpForm"><label>One-time password<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required></label><button class="button button-dark full-width" type="submit">Verify OTP</button></form><button class="text-button" id="resendResetOtp" type="button">Resend OTP</button>`;
    else if(state.authStep==='forgotPassword') root.innerHTML=`<h3 class="form-title">Set a new password</h3><p class="form-subtitle">Choose a strong password for your account.</p><form class="form-stack" id="forgotPasswordForm"><label>New password<input name="password" type="password" minlength="10" autocomplete="new-password" required></label><button class="button button-dark full-width" type="submit">Save new password</button></form>`;
    else root.innerHTML=`<h3 class="form-title">Welcome back</h3><p class="form-subtitle">Log in to manage your service requests.</p><form class="form-stack" id="loginForm"><label>Mobile number<input name="mobile" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="10-digit mobile number" pattern="[6-9][0-9]{9}" maxlength="10" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="button button-dark full-width" type="submit">Log in</button></form><div class="form-links"><button class="text-button" id="forgotBtn" type="button">Forgot password?</button><button class="text-button" id="toSignup" type="button">Create account</button></div>`;
    bindAuthForms();
  }
  function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
  function busy(form, busy, label='Please wait…') { const b=$('button[type="submit"]',form); if(!b)return; if(busy){b.dataset.label=b.textContent;b.disabled=true;b.textContent=label;}else{b.disabled=false;b.textContent=b.dataset.label||b.textContent;} }
  async function submit(form, fn) { form.addEventListener('submit',async e=>{e.preventDefault();busy(form,true);try{await fn(formData(form),form);}catch(err){toast(err.message,true);}finally{busy(form,false);}}); }
  function bindAuthForms() {
    $('#toSignup')?.addEventListener('click',()=>setTab('signup'));
    $('#forgotBtn')?.addEventListener('click',()=>{state.authStep='forgotStart';renderAuth();});
    $('#backToLogin')?.addEventListener('click',()=>{state.authStep='start';renderAuth();});
    $('#changeMobile')?.addEventListener('click',()=>{state.authStep='start';state.enrollmentToken=null;renderAuth();});
    $('#resendOtp')?.addEventListener('click',async()=>{try{await api('/customer/auth/otp/start',{method:'POST',body:{mobile:state.otpMobile}});toast('OTP request sent. Check your messages.');}catch(e){toast(e.message,true);}});
    $('#resendResetOtp')?.addEventListener('click',async()=>{try{await api('/customer/auth/otp/start',{method:'POST',body:{mobile:state.resetMobile}});toast('OTP request sent.');}catch(e){toast(e.message,true);}});
    submit($('#loginForm'),async d=>{const r=await api('/customer/auth/login',{method:'POST',body:{mobile:d.mobile,password:d.password}});state.user=r.customer;await enterDashboard();toast('Welcome back!');});
    submit($('#signupStartForm'),async d=>{state.otpMobile=d.mobile;await api('/customer/auth/otp/start',{method:'POST',body:{mobile:d.mobile}});state.authStep='otp';renderAuth();toast('OTP request accepted. Check your SMS.');});
    submit($('#signupOtpForm'),async d=>{const r=await api('/customer/auth/otp/verify',{method:'POST',body:{mobile:state.otpMobile,code:d.code}});if(r.existing_account){state.authMode='login';state.authStep='start';$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab==='login'));renderAuth();toast('This number already has an account. Log in or reset your password.');return;}state.enrollmentToken=r.enrollment_token;state.authStep='profile';renderAuth();});
    submit($('#signupProfileForm'),async d=>{const r=await api('/customer/register',{method:'POST',body:{...d,enrollment_token:state.enrollmentToken}});state.user=r.customer;state.enrollmentToken=null;await enterDashboard();toast('Your account is ready.');});
    submit($('#forgotStartForm'),async d=>{state.resetMobile=d.mobile;await api('/customer/auth/otp/start',{method:'POST',body:{mobile:d.mobile}});state.authStep='forgotOtp';renderAuth();toast('Reset OTP request sent.');});
    submit($('#forgotOtpForm'),async d=>{const r=await api('/customer/auth/forgot/verify',{method:'POST',body:{mobile:state.resetMobile,code:d.code}});state.resetToken=r.reset_token;state.authStep='forgotPassword';renderAuth();});
    submit($('#forgotPasswordForm'),async d=>{await api('/customer/auth/forgot/reset',{method:'POST',body:{reset_token:state.resetToken,password:d.password}});state.resetToken=null;state.authStep='start';state.authMode='login';$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab==='login'));renderAuth();toast('Password updated. Please log in.');});
  }
  const iconFor = name => { const n=String(name).toLowerCase(); if(n.includes('electric'))return 'ϟ';if(n.includes('plumb'))return '♧';if(n.includes('clean'))return '✧';if(n.includes('tank'))return '◉';if(n.includes('ac'))return '❄';if(n.includes('metal'))return '⚒';return '⌂'; };
  async function loadCatalog() {
    const data=await api('/customer/catalog'); state.services=data.services||[];
    const grid=$('#serviceGrid');
    if(!state.services.length){grid.innerHTML='<div class="loading-card">No services are currently available online. Please call 8822951734 for assistance.</div>';return;}
    grid.innerHTML=state.services.map(s=>`<article class="service-card"><span class="service-icon">${iconFor(s.name)}</span><h3>${esc(s.name)}</h3><p>${esc(s.description||'Request this service and our team will review the details.')}</p><button type="button" data-book-service="${s.id}">Request this service →</button></article>`).join('');
    grid.addEventListener('click',e=>{const b=e.target.closest('[data-book-service]');if(!b)return;openBooking(Number(b.dataset.bookService));});
    $('#bookingCategory').innerHTML=state.services.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
    $('#bookingCategory').addEventListener('change',renderDynamicFields);renderDynamicFields();
  }
  function renderDynamicFields() {
    const service=state.services.find(s=>s.id===Number($('#bookingCategory').value)); const n=(service?.name||'').toLowerCase();let fields=[];
    if(n.includes('electric'))fields=[['Points / fixtures','points','number'],['Rooms','rooms','number'],['Floors','floors','number'],['Wiring points (if relevant)','wiring','number']];
    else if(n.includes('plumb'))fields=[['Affected fixtures / points','fixtures','number'],['Number of leaks (if relevant)','leaks','number']];
    else if(n.includes('home cleaning'))fields=[['Rooms','rooms','number'],['Bathrooms','bathrooms','number'],['Approx. area (sq ft)','area','number']];
    else if(n.includes('tank'))fields=[['Number of tanks','tanks','number'],['Capacity per tank (litres)','capacity','number']];
    else if(n.includes('ac servicing'))fields=[['Number of AC units','units','number']];
    else if(n.includes('metal fabrication'))fields=[['Number of items','items','number'],['Approx. area (sq ft)','area','number'],['Dimensions / size','dimensions','text'],['Material','material','text']];
    $('#dynamicFields').innerHTML=fields.length?`<div class="dynamic-grid">${fields.map(([label,key,type])=>`<label>${label}<input data-detail="${key}" type="${type}" ${type==='number'?'min="1" max="10000" step="1"':''} placeholder="${type==='number'?'Enter quantity':'Enter details'}"></label>`).join('')}</div>`:'';
  }
  function openBooking(serviceId) {
    if(!state.user){setTab('login');showAccount();toast('Please log in or create an account to place an order.');return;}
    if(serviceId)$('#bookingCategory').value=String(serviceId);renderDynamicFields();
    $('#bookingAddress').value=state.user.address||'';$('#bookingLocality').value=state.user.locality||'Hailakandi';
    const d=new Date();d.setDate(d.getDate()+1);$('#bookingDate').min=d.toISOString().slice(0,10);$('#bookingDate').value=d.toISOString().slice(0,10);
    $('#bookingDialog').showModal();
  }
  async function enterDashboard() {
    const [profile,bookings]=await Promise.all([api('/customer/me'),api('/customer/bookings')]);state.user=profile;
    $('#account').classList.add('hidden');$('#dashboard').classList.remove('hidden');$('#welcomeTitle').textContent=`Hello, ${profile.name.split(' ')[0]}`;
    $('#profileCard').innerHTML=`<div class="profile-avatar">${esc(profile.name.slice(0,1).toUpperCase())}</div><h3>${esc(profile.name)}</h3><p>+91 ${esc(profile.mobile)}</p><div class="profile-meta"><p><strong>Service address</strong></p><p>${esc(profile.address||'Add an address when booking')}</p><p>${esc(profile.locality||'')}</p><p style="margin-top:14px">Member since ${new Date(profile.created_at).toLocaleDateString('en-IN',{month:'short',year:'numeric'})}</p><button class="button button-outline full-width" style="margin-top:14px" id="changePasswordBtn">Change password</button><button class="button button-outline full-width" style="margin-top:8px" id="paymentsBtn">Payment history</button><button class="button button-outline full-width" style="margin-top:8px" id="complaintsBtn">My complaints</button></div>`;
    renderBookings(bookings.rows||[]);$('#changePasswordBtn').onclick=showChangePassword;$('#paymentsBtn').onclick=showPayments;$('#complaintsBtn').onclick=showComplaints;$('#dashboard').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function simpleDialog(title, html, onSubmit) {
    const dlg=document.createElement('dialog');dlg.className='modal';dlg.innerHTML=`<form class="modal-form"><div class="modal-head"><div><p class="eyebrow">QUICKFIX ACCOUNT</p><h2>${esc(title)}</h2></div><button type="button" class="close-button" aria-label="Close">×</button></div>${html}<p class="muted" id="modalError"></p><button class="button button-dark full-width" type="submit">Submit</button></form>`;
    document.body.appendChild(dlg);const close=()=>{dlg.close();dlg.remove();};$('.close-button',dlg).onclick=close;dlg.addEventListener('click',e=>{if(e.target===dlg)close();});$('form',dlg).addEventListener('submit',async e=>{e.preventDefault();const b=$('button[type="submit"]',dlg);b.disabled=true;try{await onSubmit(formData($('form',dlg)),dlg);close();}catch(err){$('#modalError',dlg).textContent=err.message;}finally{b.disabled=false;}});dlg.showModal();return dlg;
  }
  function showChangePassword() {
    simpleDialog('Change password', '<label>Current password<input name="current_password" type="password" autocomplete="current-password" required></label><label>New password<input name="password" type="password" minlength="10" autocomplete="new-password" required></label><p class="fine-print">Use at least 10 characters.</p>', async d=>{await api('/customer/auth/change-password',{method:'POST',body:d});toast('Password updated successfully.');});
  }
  async function showPayments() {
    try{const data=await api('/customer/payments');const rows=data.rows||[];const html=rows.length?`<div class="booking-list">${rows.map(p=>`<article class="booking-item"><div><div class="booking-code">${esc(p.receipt_no)}</div><h4>${esc(p.service)} · ${esc(p.booking_code)}</h4><p>${new Date(p.paid_at).toLocaleString('en-IN')}</p><p>Method: ${esc(p.method)}${Number(p.refunded)?' · Refunded ₹'+Number(p.refunded).toFixed(2):''}</p></div><span class="status">₹${Number(p.amount_collected).toFixed(2)}</span></article>`).join('')}</div>`:'<div class="empty-state"><h4>No payment records yet</h4><p>Receipts appear here when a payment is recorded by QuickFix Barak.</p></div>';
      const dlg=document.createElement('dialog');dlg.className='modal';dlg.innerHTML=`<div class="modal-form"><div class="modal-head"><div><p class="eyebrow">YOUR ACCOUNT</p><h2>Payment history</h2></div><button class="close-button" aria-label="Close">×</button></div>${html}<button class="button button-dark full-width">Close</button></div>`;document.body.appendChild(dlg);const close=()=>{dlg.close();dlg.remove();};$('.close-button',dlg).onclick=close;$('.button',dlg).onclick=close;dlg.showModal();
    }catch(e){toast(e.message,true);}
  }
  async function showComplaints() {
    try{const data=await api('/customer/complaints');const rows=data.rows||[];const html=rows.length?`<div class="booking-list">${rows.map(c=>`<article class="booking-item"><div><div class="booking-code">${esc(c.booking_code||'Booking')}</div><h4>${esc(c.service||'Service complaint')}</h4><p>${esc(c.description)}</p>${c.resolution?`<p>Resolution: ${esc(c.resolution)}</p>`:''}<p>${new Date(c.created_at).toLocaleDateString('en-IN')}</p></div><span class="status">${esc(statusLabel(c.status))}</span></article>`).join('')}</div>`:'<div class="empty-state"><h4>No complaints yet</h4><p>If you need help with a booking, open its details and submit a complaint.</p></div>';
      const dlg=document.createElement('dialog');dlg.className='modal';dlg.innerHTML=`<div class="modal-form"><div class="modal-head"><div><p class="eyebrow">CUSTOMER SUPPORT</p><h2>My complaints</h2></div><button class="close-button" aria-label="Close">×</button></div>${html}<button class="button button-dark full-width">Close</button></div>`;document.body.appendChild(dlg);const close=()=>{dlg.close();dlg.remove();};$('.close-button',dlg).onclick=close;$('.button',dlg).onclick=close;dlg.showModal();
    }catch(e){toast(e.message,true);}
  }
  function renderBookings(rows) {
    const list=$('#bookingList');
    if(!rows.length){list.innerHTML='<div class="empty-state"><h4>No bookings yet</h4><p>Your service requests will appear here after you submit one.</p><button class="button button-dark" id="emptyBook">Book your first service</button></div>';$('#emptyBook')?.addEventListener('click',()=>openBooking());return;}
    list.innerHTML=rows.map(b=>`<article class="booking-item"><div><div class="booking-code">${esc(b.booking_code)}</div><h4>${esc(b.service)}</h4><p>${esc(b.address)}, ${esc(b.locality||'')}</p><p>Requested ${new Date(b.created_at).toLocaleDateString('en-IN')}${b.preferred_at?' · Preferred '+new Date(b.preferred_at).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):''}</p>${b.technician?`<p>Technician: ${esc(b.technician)}${b.technician_mobile?' · '+esc(b.technician_mobile):''}</p>`:''}${b.quote_status?`<p>Quotation: ${esc(statusLabel(b.quote_status))}</p>`:''}<button class="text-button" data-booking-detail="${esc(b.booking_code)}">View booking details →</button></div><span class="status ${statusClass(b.work_status)}">${esc(statusLabel(b.work_status))}</span></article>`).join('');
    list.addEventListener('click',async e=>{const b=e.target.closest('[data-booking-detail]');if(!b)return;try{const r=await api('/customer/bookings/'+encodeURIComponent(b.dataset.bookingDetail));showBookingDetails(r);}catch(err){toast(err.message,true);}});
  }
  function showBookingDetails(data) {
    const b=data.booking;const quotes=(data.quotes||[]).map(q=>`<div style="border-top:1px solid #e0e6df;padding:12px 0"><strong>Quotation v${q.version} — ${esc(statusLabel(q.status))}</strong><p class="muted">${new Date(q.created_at).toLocaleDateString('en-IN')}</p>${(q.items||[]).map(i=>`<p class="muted">${esc(i.description)} · ${esc(i.quantity)} × ₹${Number(i.unit_price||0).toFixed(2)} = ₹${Number(i.amount||0).toFixed(2)}</p>`).join('')}${q.status==='pending'?`<div class="form-row"><button class="button button-dark" type="button" data-quote-action="accepted" data-quote-code="${esc(b.booking_code)}">Accept quotation</button><button class="button button-outline" type="button" data-quote-action="rejected" data-quote-code="${esc(b.booking_code)}">Reject</button></div>`:''}</div>`).join('')||'<p class="muted">No official quotation has been issued yet.</p>';
    const dlg=document.createElement('dialog');dlg.className='modal';dlg.innerHTML=`<div class="modal-form"><div class="modal-head"><div><p class="eyebrow">BOOKING DETAILS</p><h2>${esc(b.booking_code)}</h2></div><button class="close-button" aria-label="Close">×</button></div><p><strong>${esc(b.service)}</strong> · <span class="status ${statusClass(b.work_status)}">${esc(statusLabel(b.work_status))}</span></p><p class="muted">${esc(b.address)}, ${esc(b.locality||'')}</p><p class="muted">Job details: ${esc(b.problem||'—')}</p><p class="muted">Preferred date: ${b.preferred_at?esc(new Date(b.preferred_at).toLocaleString('en-IN')):'Not specified'}</p><p class="muted">Technician: ${esc(b.technician||'Not assigned yet')}</p><h3>Quotations</h3>${quotes}<div class="form-row"><button class="button button-outline" type="button" id="reportIssue">Report a problem</button>${b.work_status==='completed'?'<button class="button button-outline" type="button" id="leaveReview">Leave a review</button>':''}</div><p class="fine-print">Any initial estimate is indicative. The official quotation and booking status are confirmed by QuickFix Barak.</p><button class="button button-dark full-width" type="button">Close</button></div>`;
    document.body.appendChild(dlg);const close=()=>{dlg.close();dlg.remove();};$('.close-button',dlg).onclick=close;$$('.button',dlg).filter(x=>x.id!=='reportIssue'&&x.id!=='leaveReview'&&!x.dataset.quoteAction).forEach(x=>x.onclick=close);$$('[data-quote-action]',dlg).forEach(btn=>btn.addEventListener('click',async()=>{if(btn.dataset.quoteAction==='rejected'&&!confirm('Reject this quotation?'))return;try{await api('/customer/bookings/'+encodeURIComponent(btn.dataset.quoteCode)+'/quote/'+btn.dataset.quoteAction,{method:'POST',body:{}});toast('Quotation response saved.');close();const r=await api('/customer/bookings/'+encodeURIComponent(btn.dataset.quoteCode));showBookingDetails(r);await enterDashboard();}catch(err){toast(err.message,true);}}));$('#reportIssue',dlg)?.addEventListener('click',()=>{close();simpleDialog('Report a problem',`<label>Complaint details<textarea name="description" required minlength="5" maxlength="1000"></textarea></label>`,async d=>{await api('/customer/bookings/'+encodeURIComponent(b.booking_code)+'/complaints',{method:'POST',body:d});toast('Your complaint was submitted.');});});$('#leaveReview',dlg)?.addEventListener('click',()=>{close();simpleDialog('Review your service',`<label>Rating<select name="rating" required><option value="5">5 — Excellent</option><option value="4">4 — Good</option><option value="3">3 — Okay</option><option value="2">2 — Poor</option><option value="1">1 — Very poor</option></select></label><label>Comment<textarea name="comment" maxlength="1000"></textarea></label>`,async d=>{await api('/customer/bookings/'+encodeURIComponent(b.booking_code)+'/review',{method:'POST',body:d});toast('Thank you for your review.');});});dlg.addEventListener('click',e=>{if(e.target===dlg)close();});dlg.showModal();
  }
  async function submitBooking(e) {
    e.preventDefault();const btn=$('#submitBooking');btn.disabled=true;btn.textContent='Submitting…';
    try {
      const date=$('#bookingDate').value,time=$('#bookingTime').value;if(!date||!time)throw new Error('Choose your preferred date and time.');
      const dt=new Date(`${date}T${time}:00`);if(Number.isNaN(dt.getTime()))throw new Error('The preferred date and time are invalid.');if(dt.getTime()<Date.now())throw new Error('Choose a future date and time.');
      const details=$$('[data-detail]').map(el=>el.value.trim()?`${el.parentElement.firstChild.textContent.trim()}: ${el.value.trim()}`:null).filter(Boolean);
      const base=$('#bookingProblem').value.trim();const problem=[base,...details].join('\n');
      const result=await api('/customer/bookings',{method:'POST',body:{category_id:Number($('#bookingCategory').value),address:$('#bookingAddress').value.trim(),locality:$('#bookingLocality').value.trim(),preferred_at:`${date}T${time}`,problem}});
      $('#bookingDialog').close();$('#bookingForm').reset();toast(`Request submitted. Reference: ${result.booking_code}`);await enterDashboard();
    } catch(err){toast(err.message,true);}finally{btn.disabled=false;btn.textContent='Submit service request';}
  }
  async function boot() {
    $('#navAccount').addEventListener('click',()=>state.user?$('#dashboard').scrollIntoView({behavior:'smooth'}):showAccount());$('#heroBook').addEventListener('click',()=>state.user?openBooking():showAccount());$('#newBookingBtn').addEventListener('click',()=>openBooking());$('#logoutBtn').addEventListener('click',async()=>{try{await api('/customer/logout',{method:'POST',body:{}});}catch{}state.user=null;setTab('login');$('#dashboard').classList.add('hidden');showAccount();toast('You have logged out.');});
    $$('.tab').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));$('#closeBooking').addEventListener('click',()=>$('#bookingDialog').close());$('#bookingForm').addEventListener('submit',submitBooking);
    renderAuth();
    try{await loadCatalog();}catch(e){$('#serviceGrid').innerHTML='<div class="loading-card">We could not load services right now. Please try again or call 8822951734.</div>';}
    try{await enterDashboard();}catch(e){/* not signed in */}
  }
  boot();
})();
