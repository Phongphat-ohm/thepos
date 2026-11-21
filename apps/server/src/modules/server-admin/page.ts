export function renderHtml(authed: boolean, nonce: string): string {
  return `<!doctype html>
<html lang="th" data-type="software">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="page-type" content="software" />
  <meta name="site-kind" content="software" />
  <meta name="description" content="สถานะเซิร์ฟเวอร์ ThePOS การเชื่อมต่อ และการจัดการข้อมูลสำหรับผู้ดูแลเซิร์ฟเวอร์" />
  <title>ThePOS — ผู้ดูแลเซิร์ฟเวอร์</title>
  <style nonce="${nonce}">
    :root { color-scheme: light; --bg:#f8fafc; --surface:#fff; --ink:#0f172a; --muted:#52627a; --brand:#1e3a8a; --border:#dce4ef; --ok:#0f766e; --err:#b91c1c; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:"Segoe UI",Tahoma,sans-serif; background:var(--bg); color:var(--ink); line-height:1.65; }
    button,input { font:inherit; } button,a,input { -webkit-tap-highlight-color:transparent; }
    button { min-height:44px; border:1px solid transparent; border-radius:8px; padding:10px 16px; background:var(--brand); color:white; cursor:pointer; font-weight:600; transition:background .16s,transform .16s; }
    button:hover:not(:disabled) { background:#172e70; transform:translateY(-1px); }
    button:active:not(:disabled) { transform:translateY(1px); }
    button:disabled { opacity:.5; cursor:not-allowed; }
    button.outline { background:white; border-color:var(--border); color:var(--ink); }
    button.outline:hover:not(:disabled) { background:#edf3ff; }
    button.danger { background:var(--err); } button.danger:hover:not(:disabled) { background:#991b1b; }
    :focus-visible { outline:3px solid #2563eb; outline-offset:4px; }
    a { color:inherit; text-decoration:none; }
    .skip { position:fixed; top:8px; left:8px; transform:translateY(-150%); background:white; padding:12px; z-index:10; } .skip:focus { transform:none; }
    .topbar { background:white; border-bottom:1px solid var(--border); }
    .topbar-inner,.wrap { max-width:1280px; margin:auto; padding-left:40px; padding-right:40px; }
    .topbar-inner { min-height:80px; display:flex; align-items:center; justify-content:space-between; gap:24px; }
    .brand { display:flex; align-items:center; gap:12px; font-weight:650; font-size:20px; letter-spacing:-.5px; }
    .brand img { width:36px; height:36px; object-fit:contain; }
    .brand small { margin-left:12px; padding-left:24px; border-left:1px solid var(--border); font-size:13px; color:var(--muted); font-weight:400; letter-spacing:0; }
    .actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
    .wrap { padding-top:44px; padding-bottom:48px; }
    h1,h2,h3,p { margin:0; } h1 { font-size:32px; line-height:1.3; font-weight:650; letter-spacing:-.7px; } h2 { font-size:19px; font-weight:600; } h3 { font-size:16px; }
    p { color:var(--muted); font-size:14px; } .eyebrow { color:var(--muted); font-size:12px; letter-spacing:1.8px; margin-bottom:8px; }
    .page-head { display:flex; justify-content:space-between; gap:24px; align-items:flex-end; margin-bottom:28px; }
    .page-head p { margin-top:10px; } .sync { font-size:12px; color:var(--muted); white-space:nowrap; }
    .stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); background:white; border:1px solid var(--border); border-radius:12px; margin-bottom:24px; }
    .stat { padding:22px 24px; min-width:0; } .stat + .stat { border-left:1px solid var(--border); }
    .stat-label { color:var(--muted); font-size:13px; margin-bottom:10px; } .stat-value { font-size:20px; font-weight:600; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
    .workspace { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(280px,1fr); gap:24px; align-items:start; }
    .stack { display:grid; gap:24px; min-width:0; }
    .panel { background:white; border:1px solid var(--border); border-radius:12px; overflow:hidden; min-width:0; }
    .panel-head { padding:22px 24px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; gap:12px; }
    .panel-head p { margin-top:4px; } .panel-body { padding:24px; }
    .connection { background:#0f172a; color:#fff; border-color:#0f172a; }
    .connection .panel-head { border-color:#30415a; } .connection p,.connection .field-label { color:#becbdd; }
    .connection :focus-visible { outline-color:#7dd3fc; }
    .field-label { font-size:12px; color:var(--muted); display:block; margin-bottom:8px; }
    .address { font-family:Consolas,monospace; font-size:15px; overflow-wrap:anywhere; padding-bottom:22px; }
    .secret-box { display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:16px; border:1px solid #3a4960; border-radius:8px; background:#19263b; }
    .secret-box code { font-size:20px; letter-spacing:.8px; overflow-wrap:anywhere; flex:1; min-width:120px; }
    .key-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:18px; } .key-actions .outline { background:transparent; color:white; border-color:#58677e; }
    .key-actions .outline:hover:not(:disabled) { background:#30415a; } #keyHint { font-size:12px; margin-top:16px; }
    .badge { display:inline-flex; align-items:center; gap:7px; border-radius:6px; padding:3px 9px; font-size:12px; font-weight:600; white-space:nowrap; background:#edf3ff; color:var(--brand); }
    .badge.ok { background:#e8f5f1; color:var(--ok); } .badge.warn { background:#fff4dc; color:#92400e; } .badge.off { background:#fef2f2; color:var(--err); }
    .badge.ok::before { content:""; width:6px; height:6px; background:currentColor; border-radius:50%; }
    dl { margin:0; } .detail { display:flex; justify-content:space-between; gap:16px; padding:13px 0; border-bottom:1px solid var(--border); font-size:13px; } .detail:first-child { padding-top:0; } .detail:last-child { border:0; padding-bottom:0; } dt { color:var(--muted); } dd { margin:0; text-align:right; overflow-wrap:anywhere; }
    .table-scroll { overflow-x:auto; } table { width:100%; border-collapse:collapse; font-size:13px; text-align:left; } th { color:var(--muted); font-weight:500; background:#f8fafc; } th,td { padding:15px 24px; border-bottom:1px solid var(--border); } tbody tr:last-child td { border-bottom:0; } .empty { padding:44px 24px; text-align:center; color:var(--muted); } .device-name { min-width:130px; }
    .danger-panel { margin-top:32px; border-color:#eccaca; } .danger-panel .panel-body { display:flex; justify-content:space-between; align-items:center; gap:24px; } .danger-panel h2 { color:var(--err); margin-bottom:8px; } .danger-panel p { max-width:740px; }
    .notice { margin-bottom:20px; padding:14px 18px; border:1px solid #eccaca; border-radius:8px; background:#fef2f2; color:var(--err); font-size:14px; } .notice.success { background:#e8f5f1; border-color:#a9d6c7; color:var(--ok); }
    .error { color:var(--err); font-size:14px; margin:12px 0; } [hidden] { display:none!important; }
    label { display:block; font-size:14px; font-weight:600; margin:18px 0 8px; } input { width:100%; min-height:46px; border:1px solid #aebdd0; background:white; color:var(--ink); border-radius:8px; padding:10px 12px; }
    .login-box { max-width:460px; margin:8vh auto; } .login-box h1 { font-size:26px; } .login-box p { margin-top:14px; } .login-box button { width:100%; margin-top:16px; }
    dialog { width:calc(100% - 32px); max-width:560px; max-height:90dvh; padding:28px; border:1px solid var(--border); border-radius:16px; color:var(--ink); overflow:auto; box-shadow:0 24px 80px #0f172a33; } dialog::backdrop { background:#0f172a99; } dialog h2 { color:var(--err); font-size:23px; } dialog p { margin-top:12px; } dialog ul { color:var(--muted); font-size:14px; padding-left:22px; } dialog .actions { justify-content:flex-end; margin-top:24px; } .confirm-word { color:var(--ink); font-weight:600; }
    footer { margin-top:28px; font-size:12px; color:var(--muted); display:flex; justify-content:space-between; gap:16px; }
    .entrance { animation:enter .35s ease-out both; } @keyframes enter { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
    @media(min-width:1600px) { .wrap { padding-top:56px; } }
    @media(max-width:1023px) { .topbar-inner,.wrap { padding-left:24px; padding-right:24px; } .workspace { grid-template-columns:minmax(0,1fr); } .stats { grid-template-columns:repeat(2,minmax(0,1fr)); } .stat:nth-child(3) { border-left:0; } .stat:nth-child(n+3) { border-top:1px solid var(--border); } .brand small { display:none; } }
    @media(max-width:599px) { .topbar-inner,.wrap { padding-left:16px; padding-right:16px; } .topbar-inner { padding-top:12px; padding-bottom:12px; flex-wrap:wrap; gap:12px; } .topbar-inner>.actions { width:100%; } .topbar-inner button { flex:1; } .wrap { padding-top:28px; } h1 { font-size:27px; } .page-head { display:block; } .sync { display:block; margin-top:14px; } .stat { padding:18px 14px; } .stat-value { font-size:17px; } .panel-head,.panel-body { padding:20px; } .secret-box { display:block; } .secret-box code { display:block; margin-bottom:14px; font-size:18px; } .secret-box button,.key-actions button { width:100%; } .key-actions { display:grid; } .danger-panel .panel-body { display:block; } .danger-panel button { width:100%; margin-top:20px; } footer { flex-direction:column; } dialog { padding:22px; } dialog .actions { display:grid; grid-template-columns:1fr; } dialog button { width:100%; } th,td { padding:14px 18px; } }
    @media(prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; } }
    @media(max-width:599px) {
      .table-scroll thead { display:none; }
      .table-scroll table,.table-scroll tbody,.table-scroll tr { display:block; }
      .table-scroll tr { padding:16px 20px; border-bottom:1px solid var(--border); }
      .table-scroll tr:last-child { border-bottom:0; }
      .table-scroll td { display:flex; align-items:baseline; justify-content:space-between; gap:16px; padding:8px 0; border:0; overflow-wrap:anywhere; }
      .table-scroll td::before { content:attr(data-label); color:var(--muted); flex-shrink:0; }
      .table-scroll td.empty { display:block; padding:20px 0; }
    }
  </style>
</head>
<body>
  <a class="skip" href="#main">ข้ามไปเนื้อหา</a>
  <header class="topbar"><div class="topbar-inner">
    <div class="brand"><img src="/brand-logo" width="36" height="36" alt="" />ThePOS <small>SERVER ADMIN</small></div>
    ${authed ? '<div class="actions"><button class="outline" id="refreshBtn">รีเฟรชข้อมูล</button><button class="outline" id="logoutBtn">ออกจากระบบ</button></div>' : '<span class="badge">สำหรับผู้ดูแลเซิร์ฟเวอร์</span>'}
  </div></header>
  <main class="wrap entrance" id="main" data-enter>
    ${authed ? `
    <div class="page-head"><div><div class="eyebrow">SERVER OVERVIEW</div><h1>ข้อมูลเซิร์ฟเวอร์</h1><p>ตรวจสอบระบบและเครื่อง POS ที่เชื่อมต่อจากหน้านี้</p></div><span class="sync" id="updatedAt" aria-live="polite">กำลังโหลดข้อมูล…</span></div>
    <div class="notice" id="pageNotice" role="status" hidden></div>
    <div class="notice" id="dbAlert" role="alert" hidden></div>
    <section class="stats" id="statsGrid" aria-label="สถานะระบบ" aria-busy="true"><div class="stat">กำลังโหลดสถานะระบบ…</div></section>
    <div class="workspace">
      <div class="stack">
        <section class="panel connection" aria-labelledby="connectHeading">
          <div class="panel-head"><div><h2 id="connectHeading">เชื่อมต่อเครื่อง POS</h2><p>ใช้ URL และรหัสนี้ในหน้าเชื่อมต่อของ Desktop App</p></div></div>
          <div class="panel-body"><span class="field-label">URL ที่เปิดหน้านี้</span><div class="address" id="serverUrl">—</div><span class="field-label">รหัสเชื่อมต่อเซิร์ฟเวอร์</span>
            <div class="secret-box"><code id="connectKeyText">—</code><button class="outline" id="copyKeyBtn" disabled>คัดลอกรหัส</button></div>
            <div class="key-actions"><button class="outline" id="copyUrlBtn">คัดลอก URL</button><button class="outline" id="rotateKeyBtn" disabled>สร้างรหัสเชื่อมต่อใหม่</button></div><p id="keyHint"></p>
          </div>
        </section>
        <section class="panel" aria-labelledby="devicesHeading"><div class="panel-head"><div><h2 id="devicesHeading">เครื่อง POS ที่ลงทะเบียน</h2><p>ผู้ใช้ล่าสุดและสถานะของแต่ละเครื่อง</p></div><span class="badge" id="deviceCount">— เครื่อง</span></div>
          <div class="table-scroll"><table><thead><tr><th scope="col">ชื่อเครื่อง</th><th scope="col">PIN เครื่อง</th><th scope="col">ผู้ใช้งาน</th><th scope="col">สถานะ</th></tr></thead><tbody id="devicesBody"><tr><td colspan="4" class="empty">กำลังโหลดเครื่อง POS…</td></tr></tbody></table></div>
        </section>
      </div>
      <aside class="stack" aria-label="รายละเอียดเซิร์ฟเวอร์">
        <section class="panel"><div class="panel-head"><h2>รายละเอียดระบบ</h2></div><div class="panel-body"><dl id="serverDetails"><div class="detail"><dt>เซิร์ฟเวอร์</dt><dd>กำลังโหลด…</dd></div></dl></div></section>
        <section class="panel" id="bootstrapCard" hidden><div class="panel-head"><h2>ตั้งค่าร้านครั้งแรก</h2></div><div class="panel-body"><p>ใช้รหัสนี้สร้างร้านและบัญชีผู้ดูแลคนแรก</p><label for="bootstrapText">รหัสตั้งค่าร้าน</label><input id="bootstrapText" type="password" readonly autocomplete="off" /><div class="actions" style="margin-top:16px"><button class="outline" id="toggleBootstrapBtn" aria-pressed="false">แสดงรหัส</button><button class="outline" id="copyBootstrapBtn">คัดลอกรหัสตั้งค่า</button></div></div></section>
      </aside>
    </div>
    <section class="panel danger-panel" aria-labelledby="resetHeading"><div class="panel-body"><div><h2 id="resetHeading">ล้างข้อมูลเซิร์ฟเวอร์</h2><p>ลบข้อมูลร้าน บัญชีผู้ใช้ เครื่อง POS และธุรกรรมทั้งหมดอย่างถาวร เพื่อเริ่มตั้งค่าร้านใหม่ ควรสำรองฐานข้อมูลก่อนดำเนินการ</p><p id="resetHint">ต้องยืนยันด้วยรหัสผู้ดูแลจาก Terminal</p></div><button class="danger" id="openResetBtn" disabled>ล้างข้อมูลทั้งหมด</button></div></section>
    <dialog id="resetDialog" aria-labelledby="resetTitle" aria-describedby="resetDescription"><form id="resetForm"><h2 id="resetTitle">ยืนยันล้างข้อมูลทั้งหมด</h2><p id="resetDescription">ข้อมูลที่ลบจะกู้คืนจากหน้านี้ไม่ได้ เครื่อง POS ทุกเครื่องจะต้องลงทะเบียนใหม่</p><ul><li>ลบข้อมูลร้าน ผู้ใช้ เครื่อง POS และประวัติการใช้งาน</li><li>ลบสินค้า สต็อก สมาชิก หุ้น ยอดขาย และข้อมูลการเงินทั้งหมด</li><li>คงโครงสร้างฐานข้อมูล บทบาทระบบ และรหัสเชื่อมต่อเซิร์ฟเวอร์</li></ul><label for="resetCode">รหัสผู้ดูแลเซิร์ฟเวอร์จาก Terminal</label><input id="resetCode" type="password" autocomplete="off" required maxlength="128" /><label for="resetConfirmation">พิมพ์ <span class="confirm-word">ล้างข้อมูลทั้งหมด</span> เพื่อยืนยัน</label><input id="resetConfirmation" type="text" autocomplete="off" required /><div id="resetError" class="error" role="alert"></div><div class="actions"><button class="outline" type="button" id="cancelResetBtn">ยกเลิก</button><button class="danger" type="submit" id="confirmResetBtn" disabled>ยืนยันล้างข้อมูลถาวร</button></div></form></dialog>
    <footer><span>ThePOS · การจัดการเซิร์ฟเวอร์</span><span>การล้างข้อมูลใช้ได้เฉพาะหน้า server-admin</span></footer>
    ` : `
    <section class="panel login-box"><div class="panel-body"><div class="eyebrow">SERVER ADMIN</div><h1>เข้าสู่ระบบผู้ดูแลเซิร์ฟเวอร์</h1><p>กรอกรหัสเข้าสู่หน้าเว็บเซิร์ฟเวอร์ที่แสดงใน Terminal หรือ CMD ของเครื่องเซิร์ฟเวอร์</p><form id="loginForm"><label for="code">รหัสผู้ดูแลเซิร์ฟเวอร์</label><input id="code" name="code" type="password" autocomplete="off" required autofocus maxlength="128" /><div class="error" id="loginErr" role="alert"></div><button type="submit">เข้าสู่ระบบ</button></form></div></section>
    `}
  </main>
  <script nonce="${nonce}">
    const el = id => document.getElementById(id);
    async function request(url, body) {
      const res = await fetch(url, body === undefined ? {} : { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body) });
      if (res.status === 401 && !url.endsWith('/login')) { location.reload(); throw new Error('กรุณาเข้าสู่ระบบใหม่'); }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง');
      return data;
    }
    ${authed ? `
    let currentConnectKey = '', loading = false, resetting = false;
    function notice(message, success = false) { el('pageNotice').textContent = message; el('pageNotice').className = 'notice' + (success ? ' success' : ''); el('pageNotice').hidden = !message; }
    function escapeHtml(text) { return String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function date(value) { return new Date(value).toLocaleString('th-TH', {dateStyle:'medium',timeStyle:'short'}); }
    el('serverUrl').textContent = location.origin;
    async function loadOverview() {
      if (loading || resetting) return;
      loading = true; el('refreshBtn').disabled = true;
      try {
        const data = await request('/server-admin/api/overview');
        currentConnectKey = data.security.connectKey || '';
        el('connectKeyText').textContent = currentConnectKey || 'ยังไม่มีรหัส';
        el('copyKeyBtn').disabled = !currentConnectKey; el('rotateKeyBtn').disabled = false;
        el('keyHint').textContent = 'รหัสรุ่นที่ ' + data.security.keyVersion + ' · เมื่อสร้างรหัสใหม่ เครื่องที่เคยเชื่อมต่อจะต้องยืนยันรหัสอีกครั้ง';
        const up = data.server.uptimeSeconds;
        const uptime = Math.floor(up/86400) + ' วัน ' + Math.floor(up%86400/3600) + ' ชม. ' + Math.floor(up%3600/60) + ' นาที';
        el('statsGrid').innerHTML = [
          ['ฐานข้อมูล', '<span class="badge ' + (data.server.ready ? 'ok' : 'off') + '">' + (data.server.ready ? 'พร้อมใช้งาน' : 'ไม่พร้อมใช้งาน') + '</span>'],
          ['ร้านค้า', escapeHtml(data.store.name || 'ยังไม่ตั้งค่าร้าน')],
          ['เครื่องที่ลงทะเบียน', data.devices.length + ' เครื่อง'],
          ['เวลาทำงานต่อเนื่อง', uptime],
        ].map(s => '<div class="stat"><div class="stat-label">' + s[0] + '</div><div class="stat-value">' + s[1] + '</div></div>').join('');
        el('statsGrid').setAttribute('aria-busy','false');
        el('dbAlert').textContent = data.server.dbError || ''; el('dbAlert').hidden = !data.server.dbError;
        el('serverDetails').innerHTML = [
          ['Host', data.server.host], ['Port', data.server.port], ['เริ่มทำงาน', date(data.server.startedAt)],
          ['Web Portal (CORS)', data.server.corsEnabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'],
          ['ตั้งค่าร้าน', data.store.initialized ? date(data.store.createdAt) : 'ยังไม่ตั้งค่า'],
        ].map(s => '<div class="detail"><dt>' + escapeHtml(s[0]) + '</dt><dd>' + escapeHtml(s[1]) + '</dd></div>').join('');
        el('bootstrapCard').hidden = !data.security.bootstrapSecret;
        el('bootstrapText').value = data.security.bootstrapSecret || '';
        el('deviceCount').textContent = data.devices.length + ' เครื่อง';
        el('devicesBody').innerHTML = data.devices.length ? data.devices.map(d => '<tr><td class="device-name" data-label="ชื่อเครื่อง"><strong>' + escapeHtml(d.name) + '</strong></td><td data-label="PIN เครื่อง">' + (d.hasPin ? 'ตั้งรหัสแล้ว' : 'ยังไม่ตั้งรหัส') + '</td><td data-label="ผู้ใช้งาน">' + (d.activeUser ? escapeHtml(d.activeUser) + (d.sessionLocked ? ' <span class="badge warn">ล็อกหน้าจอ</span>' : '') : 'ไม่มีผู้ใช้งาน') + '</td><td data-label="สถานะ"><span class="badge ' + (d.isActive ? 'ok' : 'off') + '">' + (d.isActive ? 'เปิดใช้งาน' : 'ระงับ') + '</span></td></tr>').join('') : '<tr><td class="empty" colspan="4">ยังไม่มีเครื่อง POS ลงทะเบียน<br>เชื่อมต่อ Desktop App เพื่อเพิ่มเครื่องแรก</td></tr>';
        el('openResetBtn').disabled = !data.server.ready || !data.security.hasBootstrapSecret;
        el('resetHint').textContent = data.security.hasBootstrapSecret ? 'ต้องยืนยันด้วยรหัสผู้ดูแลจาก Terminal' : 'กำหนด BOOTSTRAP_SECRET บนเซิร์ฟเวอร์ก่อน เพื่อให้ตั้งค่าร้านใหม่ได้';
        el('updatedAt').textContent = 'อัปเดตล่าสุด ' + new Date().toLocaleTimeString('th-TH');
      } catch (error) { notice(error.message || 'ไม่สามารถโหลดข้อมูลได้'); el('updatedAt').textContent = 'โหลดข้อมูลไม่สำเร็จ'; }
      finally { loading = false; el('refreshBtn').disabled = false; }
    }
    async function copy(value, button) {
      try { await navigator.clipboard.writeText(value); const label = button.textContent; button.textContent = 'คัดลอกแล้ว'; setTimeout(() => { button.textContent = label; }, 1500); }
      catch { notice('คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกรหัสหรือ URL แล้วคัดลอกด้วยตนเอง'); }
    }
    el('refreshBtn').onclick = () => { notice(''); loadOverview(); };
    el('logoutBtn').onclick = async () => { try { await request('/server-admin/logout', {}); location.reload(); } catch (e) { notice(e.message); } };
    el('copyKeyBtn').onclick = () => copy(currentConnectKey, el('copyKeyBtn'));
    el('copyUrlBtn').onclick = () => copy(location.origin, el('copyUrlBtn'));
    el('copyBootstrapBtn').onclick = () => copy(el('bootstrapText').value, el('copyBootstrapBtn'));
    el('toggleBootstrapBtn').onclick = () => { const visible = el('bootstrapText').type === 'password'; el('bootstrapText').type = visible ? 'text' : 'password'; el('toggleBootstrapBtn').textContent = visible ? 'ซ่อนรหัส' : 'แสดงรหัส'; el('toggleBootstrapBtn').setAttribute('aria-pressed', String(visible)); };
    el('rotateKeyBtn').onclick = async () => {
      if (!confirm('สร้างรหัสเชื่อมต่อใหม่? เครื่องที่เชื่อมต่ออยู่จะต้องกรอกรหัสใหม่')) return;
      el('rotateKeyBtn').disabled = true;
      try { await request('/server-admin/api/rotate-connect-key', {}); await loadOverview(); notice('สร้างรหัสเชื่อมต่อใหม่แล้ว', true); }
      catch (e) { notice(e.message); } finally { el('rotateKeyBtn').disabled = false; }
    };
    const dialog = el('resetDialog');
    function validateReset() { el('confirmResetBtn').disabled = resetting || !el('resetCode').value.trim() || el('resetConfirmation').value !== 'ล้างข้อมูลทั้งหมด'; }
    el('openResetBtn').onclick = () => { el('resetForm').reset(); el('resetError').textContent = ''; validateReset(); dialog.showModal(); el('cancelResetBtn').focus(); };
    el('cancelResetBtn').onclick = () => { if (!resetting) dialog.close(); };
    dialog.addEventListener('cancel', e => { if (resetting) e.preventDefault(); });
    dialog.addEventListener('close', () => { el('resetForm').reset(); validateReset(); });
    el('resetCode').oninput = validateReset; el('resetConfirmation').oninput = validateReset;
    el('resetForm').onsubmit = async e => {
      e.preventDefault(); if (el('confirmResetBtn').disabled) return;
      resetting = true; validateReset(); el('cancelResetBtn').disabled = true; el('resetError').textContent = ''; el('confirmResetBtn').textContent = 'กำลังล้างข้อมูล…';
      el('resetCode').disabled = true; el('resetConfirmation').disabled = true;
      try {
        await request('/server-admin/api/reset-data', { code:el('resetCode').value, confirmation:el('resetConfirmation').value });
        resetting = false; dialog.close(); await loadOverview();
        notice('ล้างข้อมูลทั้งหมดแล้ว เปิด Desktop App เพื่อตั้งค่าร้านและลงทะเบียนเครื่องใหม่', true);
      } catch (error) { el('resetError').textContent = error.message || 'ไม่สามารถล้างข้อมูลได้ กรุณาลองใหม่'; }
      finally { resetting = false; el('cancelResetBtn').disabled = false; el('resetCode').disabled = false; el('resetConfirmation').disabled = false; el('confirmResetBtn').textContent = 'ยืนยันล้างข้อมูลถาวร'; validateReset(); }
    };
    loadOverview();
    ` : `
    el('loginForm').onsubmit = async e => {
      e.preventDefault(); const button = e.currentTarget.querySelector('button'); button.disabled = true; el('loginErr').textContent = '';
      try { await request('/server-admin/login', {code:el('code').value}); location.reload(); }
      catch (error) { el('loginErr').textContent = error.message || 'ไม่สามารถเข้าสู่ระบบได้'; }
      finally { button.disabled = false; }
    };
    `}
  </script>
</body>
</html>`;
}
