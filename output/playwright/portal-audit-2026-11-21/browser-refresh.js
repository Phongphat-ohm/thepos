async (page)=>{
  let calls=0,refreshes=0;
  const id='11111111-1111-4111-8111-111111111111';
  const profile={user:{id,username:'audit',name:'ผู้ตรวจทดสอบ',roles:['CASHIER']},store:{id,name:'ร้านจำลองสำหรับตรวจ'},device:{id,name:'เว็บทดสอบ',isWebDevice:true},permissions:['session:use'],capabilities:['sales:read']};
  await page.route('**/api/v1/auth/refresh',async route=>{refreshes++;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({accessToken:'audit-new-access',refreshToken:'c'.repeat(43),profile})});});
  await page.route('**/api/v1/reports?**',async route=>{calls++;await route.fulfill({status:calls===1?401:200,contentType:'application/json',body:JSON.stringify(calls===1?{code:'SESSION_REQUIRED'}:{fixture:true})});});
  await page.evaluate(async()=>{const {webExecute}=await import('/src/ui/lib/api/web-transport.ts');window.__auditRefresh=await webExecute('business',{route:'reports',query:{kind:'daily',start:'2026-11-21',end:'2026-11-21'}});});
  await page.evaluate(counts=>{window.__auditRefreshCounts=counts;},{calls,refreshes});
}
