import { renderHtml } from '../../apps/server/src/modules/server-admin/page';
const overview = {
 server:{ready:true,dbError:null,host:'0.0.0.0',port:3000,startedAt:'2026-11-21T02:00:00Z',uptimeSeconds:18540,corsEnabled:true},
 security:{connectKey:'POS-DEMO-DEMO-DEMO',keyVersion:3,hasBootstrapSecret:true,bootstrapSecret:null},
 store:{initialized:true,name:'ร้านทดสอบ',createdAt:'2026-11-16T02:00:00Z'},
 devices:[{name:'จุดขาย 01',hasPin:true,activeUser:'ผู้ดูแล (admin)',sessionLocked:false,isActive:true},{name:'จุดขาย 02',hasPin:true,activeUser:null,isActive:true},{name:'เครื่องสำรอง',hasPin:false,activeUser:null,isActive:false}],
};
Bun.serve({hostname:'127.0.0.1',port:3199,fetch(req){
 const path=new URL(req.url).pathname;
 if(path==='/brand-logo')return new Response(Bun.file('logo.png'));
 if(path==='/server-admin/api/overview')return Response.json(overview);
 if(path==='/server-admin/login-preview')return new Response(renderHtml(false,'preview'),{headers:{'content-type':'text/html'}});
 if(path==='/server-admin')return new Response(renderHtml(true,'preview').replace('</body>',new URL(req.url).searchParams.has('dialog') ? '<script>setTimeout(()=>document.getElementById("openResetBtn").click(),300)</script></body>' : '</body>'),{headers:{'content-type':'text/html'}});
 return new Response('Preview does not perform writes',{status:405});
}});
console.log('Read-only fixture preview http://127.0.0.1:3199/server-admin');
