import { chromium } from 'playwright';
import fs from 'node:fs';
const root='artifacts/redesign';
const fixtures=JSON.parse(fs.readFileSync('/tmp/softlans-redesign-fixtures.json','utf8'));
const inventory=JSON.parse(fs.readFileSync(`${root}/route-inventory.json`,'utf8'));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const manifest=process.env.REDESIGN_RESUME ? JSON.parse(fs.readFileSync(`${root}/screenshot-manifest.json`,'utf8')) : []; let clientId=1;
function concrete(r){return r.replace(':studentId',fixtures.ids.student).replace(':groupId',fixtures.ids.group).replace(':id',r.startsWith('/students')||r.startsWith('/debts')?fixtures.ids.student:r.startsWith('/groups')?fixtures.ids.group:r.startsWith('/schedules')?fixtures.ids.schedule:r.startsWith('/attendance')?fixtures.ids.session:r.startsWith('/leads')?fixtures.ids.lead:r.startsWith('/payroll')?fixtures.ids.payroll:fixtures.ids.tenant)}
async function capture(entry,state,action){
 const name=`${entry.role}-${(entry.route==='/'?'dashboard':entry.route.replaceAll('/','-').replace(/^-/, '').replace(/:/g,'').replace(/[^a-zA-Z0-9_-]/g,'-'))}${state?'-'+state:''}`;
 const result={...entry,state:state||'default',screenshots:{},errors:[],expectedErrors:[],overflow:[],screenshotStatus:'captured',browserTestStatus:'passed'};
 for(const [device,width,height] of [['desktop',1440,900],['mobile',390,844]]){
 const context=await browser.newContext({viewport:{width,height},extraHTTPHeaders:{'X-Forwarded-For':`198.18.${Math.floor(clientId/250)}.${clientId++%250+1}`},reducedMotion:'reduce'});
 if(entry.role!=='anonymous')await context.addCookies([{name:'softlans_session',value:fixtures.cookies[entry.role],url:'http://localhost:5173',httpOnly:true}]);
 const page=await context.newPage();
 page.on('pageerror',e=>result.errors.push(`${device}: ${e.message}`));
 page.on('console',m=>{if(m.type()==='error'&&!/401 \(Unauthorized\)/.test(m.text())) (state==='error-state'?result.expectedErrors:result.errors).push(`${device}: ${m.text()}`)});
 try{
 await page.goto(`http://localhost:5173${concrete(entry.route)}`,{waitUntil:'networkidle',timeout:30000});
 await page.locator('h1:visible,h2:visible').first().waitFor({timeout:10000});
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForTimeout(450);
 if(action)await action(page,device);
 await page.waitForTimeout(150);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
 if(overflow)result.overflow.push(device);
 result.finalUrl=page.url();result.heading=await page.locator('h1').first().textContent().catch(()=>null);
 const file=`screenshots/${device}/${name}.png`;await page.screenshot({path:`${root}/${file}`,fullPage:true});result.screenshots[device]=file;
 if(!state && !page.url().endsWith(concrete(entry.route)) && !entry.route.includes('?'))result.errors.push(`${device}: unexpected redirect to ${page.url()}`);
 }catch(e){result.errors.push(`${device}: ${e.message}`);result.screenshotStatus='failed'}
 await context.close();
 }
 if(result.errors.length||result.overflow.length)result.browserTestStatus='failed';
 const previous=manifest.findIndex(x=>x.route===result.route&&x.role===result.role&&x.state===result.state);if(previous>=0)manifest.splice(previous,1);manifest.push(result);fs.writeFileSync(`${root}/screenshot-manifest.json`,JSON.stringify(manifest,null,2));console.log(name,result.browserTestStatus,result.errors.join(' | '),result.overflow.join(','));
}
let cursor=0;
await Promise.all(Array.from({length:3},async()=>{while(cursor<inventory.length){const entry=inventory[cursor++];if(process.env.REDESIGN_VARIANTS || process.env.REDESIGN_ONLY_EXTRA || process.env.REDESIGN_IMPORT)continue;if(process.env.REDESIGN_RETRY && !manifest.some(x=>x.route===entry.route&&x.role===entry.role&&x.browserTestStatus!=='passed'))continue;await capture(entry)}}));
if(!process.env.REDESIGN_SKIP_VARIANTS && !process.env.REDESIGN_ONLY_EXTRA && !process.env.REDESIGN_IMPORT) {
for(const step of ['center','teacher','group','students','telegram','completion'])await capture({route:`/onboarding?step=${step}`,role:'business_owner',pageName:`onboarding-${step}`});
await capture({route:'/',role:'business_owner',pageName:'dashboard'},'collapsed',async(p,d)=>{if(d==='desktop')await p.getByRole('button',{name:'Menyuni yig‘ish'}).click();else await p.getByRole('button',{name:'Menyuni ochish'}).click()});
await capture({route:'/team',role:'business_owner',pageName:'team'},'modal',async p=>{await p.getByRole('button',{name:'A’zo qo‘shish',exact:true}).click()});
await capture({route:'/students?search=NoMatchingRecord',role:'business_owner',pageName:'students'},'empty',async p=>{const input=p.locator('input[type="search"]');if(await input.count()){await input.fill('NoMatchingRecord');await p.waitForTimeout(800)}});
await capture({route:'/',role:'business_owner',pageName:'dashboard'},'all-statistics',async p=>{await p.locator('.dashboard-details summary').click()});
await capture({route:'/register',role:'anonymous',pageName:'registration'},'plan-selection',async p=>{await p.getByLabel('O‘quv markazi nomi').fill('Kelajak Sinov');await p.getByRole('button',{name:'Davom etish'}).click()});
await capture({route:'/register',role:'anonymous',pageName:'registration'},'account',async p=>{await p.getByLabel('O‘quv markazi nomi').fill('Kelajak Sinov');await p.getByRole('button',{name:'Davom etish'}).click();await p.getByRole('radio').first().click();await p.getByRole('button',{name:'Davom etish'}).click()});
await capture({route:'/students/new',role:'business_owner',pageName:'student-create'},'validation',async p=>{await p.locator('form button[type="submit"],form button:not([type])').last().click()});
await capture({route:'/classrooms',role:'business_owner',pageName:'classrooms'},'create-form',async p=>{await p.getByRole('button',{name:'Xona qo‘shish',exact:true}).click()});
await capture({route:'/super-admin/plans',role:'super_admin',pageName:'plans'},'create-modal',async p=>{await p.getByRole('button',{name:'Tarif yaratish',exact:true}).click()});
await capture({route:'/super-admin',role:'super_admin',pageName:'dashboard'},'navigation',async(p,d)=>{await p.getByRole('button',{name:d==='desktop'?'Menyuni yig‘ish':'Menyuni ochish'}).click()});
await capture({route:'/students',role:'business_owner',pageName:'students'},'error-state',async p=>{await p.route('**/api/students?**',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Sinov: vaqtinchalik server xatosi'}})}));await p.reload({waitUntil:'networkidle'})});
}
if(!process.env.REDESIGN_SKIP_VARIANTS && !process.env.REDESIGN_IMPORT) {
await capture({route:'/students',role:'business_owner',pageName:'students'},'loading-state',async p=>{await p.route('**/api/students?**',async route=>{await new Promise(resolve=>setTimeout(resolve,5000));await route.continue().catch(()=>{})});await p.reload({waitUntil:'domcontentloaded'});await p.locator('.loading-panel,[role="status"]').first().waitFor()});
await capture({route:'/login',role:'anonymous',pageName:'login'},'validation-error',async p=>{await p.getByLabel('Email manzili').fill('missing@redesign.test');await p.getByLabel('Parol',{exact:true}).fill('Invalid-fictional-password');await p.getByRole('button',{name:'Hisobga kirish'}).click();await p.getByRole('alert').waitFor()});
}
if(process.env.REDESIGN_IMPORT) await capture({route:'/students/import',role:'business_owner',pageName:'student-import'},'preview',async p=>{await p.locator('input[type="file"]').setInputFiles({name:'fictional-students.csv',mimeType:'text/csv',buffer:Buffer.from('firstName,lastName,phone\nKamola,Sinov,\n')});await p.getByRole('button',{name:'Faylni tekshirish'}).click();await p.getByRole('heading',{name:'3. Import preview'}).waitFor()});
await browser.close();
