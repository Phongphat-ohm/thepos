import { isolatedDatabase } from "./isolated-db";
import { seedRoles } from "../prisma/roles";
import { createApp } from "../src/app";
import { newToken } from "../src/security";

const database = isolatedDatabase();
const secret = newToken(), device = newToken(), password = "acceptance tests local only";
const app = createApp(database.db, {jwtSecret:newToken(), bootstrapSecret:secret, memberEncryptionKey:"9".repeat(64)});
const routes: Record<string, [string, string]> = {
  dashboard:["GET","dashboard"], reports:["GET","reports"], shifts:["GET","shifts"], open_shift:["POST","shifts"],
  shift_detail:["GET","shifts/:id"], shift_movement:["POST","shifts/:id/movements"], close_shift:["POST","shifts/:id/close"],
  checkout:["POST","sales"], store_settings:["GET","settings/store"], update_store_settings:["PUT","settings/store"],
  users:["GET","settings/users"], create_user:["POST","settings/users"], update_user:["PUT","settings/users/:id"],
  devices:["GET","settings/devices"], update_device:["PATCH","settings/devices/:id"], change_password:["POST","auth/change-password"],
  pos_lookup:["GET","sales/products"], pos_categories:["GET","sales/categories"], pos_members:["GET","sales/members"],
  sales_history:["GET","sales"], sale_detail:["GET","sales/:id"], return_quote:["POST","sales/:id/returns/quote"], return_sale:["POST","sales/:id/returns"],
};
let token = "", refresh = "";
async function call(path: string, method = "GET", input?: unknown, key?: string) {
  const response = await app.request("/api/v1/"+path,{
    method, headers:{ "content-type":"application/json", "x-device-token":device, authorization:"Bearer "+token, ...(refresh&&{"x-refresh-token":refresh}), ...(key&&{"idempotency-key":key}) },
    body:input===undefined?undefined:JSON.stringify(input),
  });
  const raw = await response.text(); const data = raw ? JSON.parse(raw) : null;
  if(!response.ok)throw new Error(data?.code ?? "UNAVAILABLE");
  return response.headers.has("idempotency-replayed") ? {sale:data,replayed:response.headers.get("idempotency-replayed")==="true"} : data;
}
await database.create();
try {
  database.migrate(); await seedRoles(database.db);
  await call("setup/bootstrap","POST",{secret,username:"admin",password,pin:"012345",displayName:"ผู้ดูแลทดสอบ",deviceName:"จุดขายตรวจรับ",storeName:"สหกรณ์ตรวจรับ"});
  const admin = await database.db.user.findUniqueOrThrow({where:{username:"admin"}});
  for (const role of ["MANAGER","CASHIER","STOCK_STAFF"] as const) await database.db.user.create({data:{
    storeId:admin.storeId,username:role.toLowerCase(),name:role,passwordHash:admin.passwordHash,pinHash:admin.pinHash,
    roles:{create:{role:{connect:{code:role}}}},
  }});
  token=(await call("auth/login","POST",{username:"admin",password})).accessToken;
  const category=await call("catalog/categories","POST",{name:"ของแห้ง"});
  const supplier=await call("catalog/suppliers","POST",{name:"คู่ค้าตรวจรับ"});
  const product=await call("catalog/products","POST",{categoryId:category.id,sku:"UAT-RICE",barcodes:["000123"],name:"ข้าวสารตรวจรับ",baseUnit:"ชิ้น",costPrice:"100.00",regularPrice:"10.10",memberPrice:"9.00",trackExpiration:true});
  const expiry = new Date(Date.now()+10*86_400_000).toISOString().slice(0,10);
  await call("inventory/receipts","POST",{supplierId:supplier.id,lines:[{productId:product.id,unit:"ชิ้น",quantity:"3",lotNumber:"LOT-UAT",expirationDate:expiry,unitCostPerBaseUnit:"4.00"}]},crypto.randomUUID());
  await call("members","POST",{name:"สมาชิกตรวจรับ",number:"UAT001",phone:"0810000000",joinedOn:"2025-01-01"});
  const server = Bun.serve({hostname:"127.0.0.1",port:1436,async fetch(req){
    const headers={"access-control-allow-origin":"http://127.0.0.1:1434","access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"content-type"};
    if(req.method==="OPTIONS")return new Response(null,{headers});
    try {
      const command=await req.json();
      if(command.kind==="startup")return Response.json({url:"http://127.0.0.1:1436",setup:{initialized:true,registered:true},lockedUser:null},{headers});
      if(command.kind==="login"){
        const result=await call("auth/login","POST",command.input); token=result.accessToken; refresh=result.refreshToken;
        return Response.json(result.profile,{headers});
      }
      if(command.kind==="profile")return Response.json(await call("auth/me"),{headers});
      if(command.kind==="lock")return Response.json(await call("auth/lock","POST"),{headers});
      if(command.kind==="unlock"){const session=await call("auth/unlock","POST",{pin:command.pin}); token=session.accessToken; refresh=session.refreshToken; return Response.json(session.profile,{headers});}
      const route=routes[command.route];
      if(!route)throw new Error("NOT_FOUND");
      const path=route[1].replace(":id",command.id??"");
      const query=new URLSearchParams(Object.entries(command.query??{}).map(([k,v])=>[k,String(v)]));
      return Response.json(await call(path+(query.size?"?"+query:""),route[0],command.input,command.key),{headers});
    } catch (reason) { return Response.json({code:reason instanceof Error?reason.message:"UNAVAILABLE"},{status:400,headers}); }
  }});
  console.log("ACCEPTANCE READY",server.port);
  await new Promise<void>((resolve)=>{process.once("SIGINT",()=>resolve());process.once("SIGTERM",()=>resolve());});
  server.stop(true);
} finally { await database.drop(); }

