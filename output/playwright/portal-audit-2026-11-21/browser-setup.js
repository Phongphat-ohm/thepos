async (page) => {
  const id='11111111-1111-4111-8111-111111111111';
  const profile={user:{id,username:'audit',name:'ผู้ตรวจทดสอบ',roles:['ADMIN']},store:{id,name:'ร้านจำลองสำหรับตรวจ'},device:{id,name:'เว็บทดสอบ',isWebDevice:true},permissions:['session:use'],capabilities:['sales:read','report:sales','report:profit','catalog:read','catalog:write','inventory:read','inventory:receive','member:read','member:write','shares:write','dividend:read','settings:manage','shift:review']};
  let dashboardCalls=0;
  const requests=[];
  await page.route('**/api/v1/**',async route=>{
    const url=new URL(route.request().url());
    const path=url.pathname.split('/api/v1/')[1];
    requests.push({path,query:Object.fromEntries(url.searchParams)});
    let status=200; let body={};
    if(path==='health') body={ready:true};
    else if(path==='setup/status') body={initialized:true,registered:true};
    else if(path==='auth/web-login') body={accessToken:'audit-access',refreshToken:'a'.repeat(43),deviceToken:'b'.repeat(43),profile};
    else if(path==='auth/me') body=profile;
    else if(path==='dashboard') {
      dashboardCalls++;
      if(dashboardCalls>1){status=503;body={code:'NETWORK_ERROR'};}
      else body={date:'2026-11-21',sales:{net:'1234.50',receipts:'2',refunds:'0',personal:false,profit:'234.50'}};
    }
    else if(path==='reports') {
      if(url.searchParams.get('page')==='2'||url.searchParams.get('q')==='FAIL'){status=503;body={code:'NETWORK_ERROR'};}
      else body={store:profile.store.name,title:'ยอดขายตามวันที่',start:url.searchParams.get('start'),end:url.searchParams.get('end'),columns:[{label:'วันที่'},{label:'ขาย (บาท)',number:'money'}],rows:[['2026-11-21','1234.50']],limited:false,total:26,page:1,pageSize:25,totalPages:2};
    }
    else if(path==='catalog/products') body={items:[{id,sku:'AUDIT',name:'สินค้า '+(url.searchParams.get('q')||'เดิม'),baseUnit:'ชิ้น',regularPrice:'10.00',memberPrice:'9.00',costPrice:'5.00',isActive:true,categoryId:id,categoryName:'ทดสอบ',units:[],barcodes:[],trackStock:true,trackExpiration:false}],nextCursor:null,total:26,page:Number(url.searchParams.get('page')||1),pageSize:25,totalPages:2};
    else if(path==='catalog/categories') body={items:[],nextCursor:null};
    else if(path==='auth/logout') status=204;
    else {status=503;body={code:'NETWORK_ERROR'};}
    if(status===204) await route.fulfill({status});
    else await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('thepos/web/server-url',location.origin);});
  await page.reload();
  console.log('API responses are synthetic; no store data accessed.');
}
