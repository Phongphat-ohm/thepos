async (page) => {
  const assert=(ok,message)=>{if(!ok)throw new Error(message)};
  page.setDefaultTimeout(9000);
  await page.setViewportSize({width:1366,height:900});
  await page.addInitScript(()=>{
    window.acceptanceCommands=[];
    const request=async command=>{
      const response=await fetch("http://127.0.0.1:1436/",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(command)});
      const data=await response.json();
      if(!response.ok)throw data.code;
      return data;
    };
    window.acceptanceRequest=request;
    Object.defineProperty(window,"__TAURI_INTERNALS__",{value:{invoke:(_, {command})=>{
      window.acceptanceCommands.push(command);
      return request(command);
    }}});
  });
  await page.goto("http://127.0.0.1:1434/");
  const b=(name,root=page)=>root.getByRole("button",{name,exact:true});
  const l=(name,root=page)=>root.getByLabel(name,{exact:true});
  const nav=page.getByRole("navigation",{name:"พื้นที่ทำงาน"});
  const modal=page.locator("dialog:modal:not(.thepos-alert-layer)");
  const swal=page.locator(".swal2-popup:not(.swal2-toast)");
  const open=async (group,item)=>{
    const header=b(group,nav);
    if(await header.getAttribute("aria-expanded")!=="true")await header.click();
    await b(item,nav).click();
    await page.getByRole("heading",{name:item,level:1,exact:true}).waitFor();
  };
  const login=async user=>{
    await l("ชื่อผู้ใช้").fill(user);
    await l("รหัสผ่าน").fill("acceptance tests local only");
    await b("เข้าสู่ระบบ").click();
    await page.getByRole("heading",{name:"ภาพรวมระบบ",level:1}).waitFor();
  };
  const rejected=(command,code)=>page.evaluate(({command,code})=>window.acceptanceRequest(command).then(()=>false,e=>e===code),{command,code});
  await login("cashier");
  assert(await b("การดูแลระบบ",nav).count()===0,"Cashier sees settings navigation");
  assert(await rejected({kind:"business",route:"store_settings"},"FORBIDDEN"),"Cashier can read settings by API");
  assert(await rejected({kind:"business",route:"reports",query:{kind:"profit",start:"2026-11-01",end:"2026-11-17"}},"FORBIDDEN"),"Cashier can view profit by API");
  await open("ขายหน้าร้าน","กะเงินสด");
  await b("เปิดกะ").click();
  await l("เงินทอนเริ่มกะ (บาท)",modal).fill("100.00");
  await b("บันทึก",modal).click();
  await modal.waitFor({state:"hidden"});
  await open("ขายหน้าร้าน","ขายหน้าร้าน (POS)");
  await page.keyboard.press("F3");
  await l("เลขสมาชิก ชื่อ บาร์โค้ด หรือเบอร์โทร",modal).fill("0810000000");
  await b("ค้นหา",modal).click();
  await modal.getByRole("option",{name:/สมาชิกตรวจรับ/}).click();
  await b("ยืนยันเลือกสมาชิก (สมาชิกตรวจรับ)",modal).click();
  async function scan(){
    await page.keyboard.press("F2");
    await l("ค้นหาสินค้าด้วยชื่อ รหัส หรือบาร์โค้ด").fill("000123");
    await l("ค้นหาสินค้าด้วยชื่อ รหัส หรือบาร์โค้ด").press("Enter");
    await page.locator(".pos-cart-item").getByText("ข้าวสารตรวจรับ",{exact:true}).waitFor();
  }
  await scan();
  await page.locator(".pos-totals .is-net").getByText("฿9.00",{exact:true}).waitFor();
  await page.keyboard.press("F9");
  await b("ยืนยันชำระเงิน",modal).click();
  await modal.getByText("ยอดสุทธิ ฿9.00",{exact:true}).waitFor();
  await page.screenshot({path:"output/playwright/phase8-cashier-receipt.png"});
  assert(await page.evaluate(async()=>{
    const initial=window.acceptanceCommands.filter(c=>c.route==="checkout").at(-1);
    const replay=await window.acceptanceRequest(initial);
    return replay.replayed&&replay.sale.netTotal==="9.00";
  }),"Repeated checkout was not returned as an idempotent replay");
  await b("ปิดหน้าต่าง",modal).click();
  await scan();
  await page.keyboard.press("F4");
  await l("จำนวน",modal).fill("3");
  await b("บันทึกจำนวน",modal).click();
  await page.keyboard.press("F9");
  await b("ยืนยันชำระเงิน",modal).click();
  await swal.getByText("สินค้าคงเหลือไม่เพียงพอ",{exact:true}).waitFor();
  await b("ตกลง",swal).click();
  await page.locator(".thepos-alert-layer").waitFor({state:"hidden"});
  await b("ปิดหน้าต่าง",modal).click();
  await b("ล็อกเครื่อง").click();
  await page.getByRole("heading",{name:"หน้าจอถูกล็อก",exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector(".pin-field")?.disabled);
  assert(await rejected({kind:"profile"},"SESSION_LOCKED"),"Locked session still accepted");
  for(const [i,d] of [..."012345"].entries())await l("รหัส PIN หลักที่ "+(i+1)).fill(d);
  await page.getByRole("heading",{name:"ภาพรวมระบบ",level:1}).waitFor();
  await page.reload();
  await login("stock_staff");
  assert(await b("ขายหน้าร้าน",nav).count()===0,"Stock staff sees POS group");
  assert(await rejected({kind:"business",route:"checkout"},"FORBIDDEN"),"Stock staff can use checkout API");
  await page.reload();
  await login("manager");
  await open("ภาพรวมและรายงาน","รายงาน");
  await l("ประเภทรายงาน").selectOption("profit");
  await b("แสดงรายงาน").click();
  await page.getByRole("cell",{name:"5.00",exact:true}).waitFor();
  await page.screenshot({path:"output/playwright/phase8-manager-profit.png"});
  console.log("Phase 8 Playwright passed: member checkout, replay, insufficient stock, locked session, role boundaries and actual lot profit.");
}
