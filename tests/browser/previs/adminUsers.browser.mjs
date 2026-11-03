// Local Worker + D1/R2 and isolated Chrome profiles. Never contacts production.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, pbkdf2Sync } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, extname, sep } from 'node:path';
import puppeteer from 'puppeteer-core';
import { createStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';

const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare } = require( 'miniflare' ), { build } = require( 'esbuild' ), { unstable_splitSqlQuery: splitSql } = require( 'wrangler' );
const root = resolve( process.env.STUDENT_BUILD_DIR || 'app/dist' );
const digest = x => createHash( 'sha256' ).update( x ).digest( 'hex' );
const password = randomUUID(), salt = randomBytes( 16 ), secret = randomBytes( 32 );
const verifier = `pbkdf2-sha256$1000$${salt.toString('base64url')}$${pbkdf2Sync(password,salt,1000,32,'sha256').toString('base64url')}`;
const script = ( await build( { entryPoints: [ 'backend/src/worker.js' ], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } ) ).outputFiles[0].text;
const mf = new Miniflare( { modules:true, script, compatibilityDate:'2026-07-30', d1Databases:['DB','ADMIN_AUTH_DB'], r2Buckets:['DOCUMENTS','NARRATION','LIBRARY'], bindings:{ ENVIRONMENT:'test', ENABLE_DRAFT_API:'true', ENABLE_CATALOGUE_API:'true', ALLOW_LOCAL_GEO_EXEMPTION:'true', ADMIN_PASSWORD_VERIFIER:verifier, ADMIN_SESSION_SECRET:secret.toString('base64url'), ADMIN_SESSION_SECONDS:'3600', ADMIN_LOGIN_ATTEMPTS_PER_MINUTE:'30', MAX_JSON_BYTES:'2097152', MAX_LIBRARY_ASSET_BYTES:'67108864', MAX_NARRATION_BYTES:'16777216', MAX_DRAFT_REVISIONS:'10000', MAX_DRAFT_MEDIA:'100', MAX_DRAFT_CREATIONS_PER_MINUTE:'100' } } );
const db=await mf.getD1Database('DB'), auth=await mf.getD1Database('ADMIN_AUTH_DB'), docs=await mf.getR2Bucket('DOCUMENTS'), library=await mf.getR2Bucket('LIBRARY');
for(const name of (await readdir('backend/migrations')).filter(x=>/^\d+_.*\.sql$/.test(x)).sort()) { const sql=await readFile(`backend/migrations/${name}`,'utf8');await db.batch(splitSql(sql).map(q=>db.prepare(q)));if(name==='0003_admin_password.sql')await auth.batch(splitSql(sql).map(q=>auth.prepare(q))); }
const starter=createStudentProjectDocument({projectId:randomUUID(),name:'Admin test starting timeline'}), json=JSON.stringify(starter), sha=digest(json), objectKey=`fixture/${randomUUID()}`,versionId=randomUUID();
await db.prepare("INSERT INTO object_reservations VALUES (?,'pending',?)").bind(objectKey,Date.now()).run();await docs.put(objectKey,json,{sha256:sha,httpMetadata:{contentType:'application/json'}});await library.put('student/shared-starting-project.json',json,{httpMetadata:{contentType:'application/json'}});await db.prepare('INSERT INTO student_default_versions VALUES (?,?,?,?,?,?)').bind(versionId,objectKey,sha,Buffer.byteLength(json),JSON.stringify({assets:[],scenes:[],narration:[]}),Date.now()).run();await db.prepare('INSERT INTO student_default_head VALUES (1,?,0,?)').bind(versionId,Date.now()).run();
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm'};
const calls=[],errors=[];let dropIssue=false;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/v1/')){const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks),headers={...req.headers};delete headers.host;delete headers.connection;delete headers['content-length'];calls.push({method:req.method,path:u.pathname});const response=await mf.dispatchFetch(`${origin}${u.pathname}${u.search}`,{method:req.method,headers,...(body.length?{body}:{})});if(dropIssue&&req.method==='POST'&&u.pathname.endsWith('/access-link')){dropIssue=false;res.writeHead(503);res.end();return;}const h=Object.fromEntries(response.headers);delete h['content-encoding'];delete h['content-length'];res.writeHead(response.status,h);res.end(Buffer.from(await response.arrayBuffer()));return;}if(u.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}const path=resolve(root,`.${decodeURIComponent(u.pathname)}${u.pathname.endsWith('/')?'index.html':''}`);if(!path.startsWith(`${root}${sep}`))throw Error('invalid path');const bytes=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless'});res.end(bytes);}catch(e){errors.push(`${req.url}: ${e.message}`);res.writeHead(500);res.end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 const login=await fetch(`${origin}/v1/admin/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0].split('=');
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-webgpu']});
 const admin=await browser.newPage();admin.setDefaultTimeout(30000);await admin.setCookie({name:cookie[0],value:cookie.slice(1).join('='),url:origin,secure:true,httpOnly:true});admin.on('pageerror',e=>errors.push(e.message));
 await admin.goto(`${origin}/admin/users/`,{waitUntil:'domcontentloaded'});
 await admin.waitForFunction(()=>document.body.innerText.includes('Create student'),{timeout:60000});
 assert.equal(await admin.$eval('form',form=>form.checkValidity()),false);await admin.$eval('form button',button=>button.click());assert.equal((await db.prepare('SELECT count(*) AS n FROM student_users').first()).n,0);
 const create=async(first,last,year)=>{
  const form=await admin.$('form');const fields=await form.$$('input');await fields[0].type(first);await fields[1].type(last);await fields[2].type(String(year));await form.$eval('button',e=>e.click());
  await admin.waitForFunction(name=>document.querySelector('main')?.innerText.includes(`${name} · 2030`),{timeout:30000},`${first} ${last}`);
  await admin.locator('button::-p-text(Issue login link)').click();await admin.waitForSelector('input[aria-label="Student login link"]');
  const link=await admin.$eval('input[aria-label="Student login link"]',e=>e.value);assert.ok(link.startsWith(`${origin}/student/#login=`));
  await admin.locator('button::-p-text(Copy link)').click();await admin.waitForFunction(()=>document.body.innerText.includes('Link copied.'));
  return link;
 };
 const firstLink=await create('Ada','Test',2030);const secondLink=await create('Bea','Test',2030);
 const users=(await db.prepare('SELECT user_id,first_name FROM student_users ORDER BY first_name').all()).results;assert.equal(users.length,2);
 const isolated=async link=>{const context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.goto(link,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('Admin test starting timeline'),{timeout:60000});return {context,page};};
 const first=await isolated(firstLink),second=await isolated(secondLink);
 const rename=async(page,value)=>{await page.click('button[aria-label="Workspace settings"]');const input=await page.$('.sim-dialog-label input');await input.focus();await input.evaluate(e=>e.select());await input.type(value);await page.click('.sim-dialog h2');await page.click('button[aria-label="Close dialog"]');await page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Saved to cloud'),{timeout:60000});};
 await rename(first.page,'Ada project');await rename(second.page,'Bea project');
 await first.page.click('.sim-project-button');await first.page.locator('button::-p-text(Duplicate project)').click();await first.page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('copy'),{timeout:60000});await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Saved to cloud'),{timeout:60000});
 await admin.reload({waitUntil:'domcontentloaded'});await admin.waitForFunction(()=>document.querySelectorAll('tbody tr').length===2);const rowText=await admin.$$eval('tbody tr',rows=>rows.map(r=>r.innerText));assert.ok(rowText.every(t=>!t.includes('No cloud activity yet')));
 const show=async name=>{await admin.evaluate(name=>{const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(name));if(!row)throw Error('Student row missing');row.querySelector('button').click();},name);await admin.waitForFunction(n=>document.querySelector('main')?.innerText.includes(`${n} · 2030`),{},name);};
 await show('Ada Test');await admin.waitForFunction(()=>document.body.innerText.includes('Ada project copy'));const links=await admin.$$('a::-p-text(Open project)');assert.equal(links.length,2);
 const target=await links[0].evaluate(a=>a.href),before=await db.prepare('SELECT count(*) AS n FROM draft_revisions').first();await admin.goto(target,{waitUntil:'domcontentloaded'});await admin.waitForSelector('#review-summary');await admin.waitForFunction(()=>document.querySelector('#review-summary')?.innerText.includes('cloud revision'));
 await admin.keyboard.press('ControlOrMeta+S').catch(()=>{});await admin.keyboard.press('ControlOrMeta+Z').catch(()=>{});assert.equal((await db.prepare('SELECT count(*) AS n FROM draft_revisions').first()).n,before.n);assert.ok(!calls.some(c=>c.path.startsWith('/v1/admin/projects/')&&c.method!=='GET'));
 await first.page.setOfflineMode(true);await first.page.click('button[aria-label="Workspace settings"]');const offlineName=await first.page.$('.sim-dialog-label input');await offlineName.focus();await offlineName.evaluate(e=>e.select());await offlineName.type('Ada offline retained');await first.page.click('.sim-dialog h2');await first.page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('Ada offline retained'));await first.page.click('button[aria-label="Close dialog"]');
 await admin.goto(`${origin}/admin/users/`,{waitUntil:'domcontentloaded'});await admin.waitForFunction(()=>document.querySelectorAll('tbody tr').length===2);await show('Ada Test');await admin.locator('button::-p-text(Revoke access)').click();await admin.waitForFunction(()=>document.body.innerText.includes('Access revoked.'));
 const invalid=await fetch(`${origin}/v1/student/me`,{headers:{Authorization:`Bearer ${new URL(firstLink).hash.slice(7)}`}});assert.ok([401,403].includes(invalid.status));
 await first.page.setOfflineMode(false);await first.page.evaluate(()=>window.dispatchEvent(new Event('online')));await first.page.waitForFunction(()=>document.querySelector('#student-auth-state')?.dataset.state==='revoked',{timeout:60000});assert.ok(await first.page.$('button::-p-text(Download project JSON)'));assert.match(await first.page.$eval('#student-auth-state',e=>e.innerText),/Ada offline retained/);
 await show('Ada Test');await admin.waitForFunction(()=>document.body.innerText.includes('Ada project'));assert.ok(await admin.$('a::-p-text(Open project)'));
 await admin.locator('button::-p-text(Restore access)').click();await admin.waitForFunction(()=>document.body.innerText.includes('Access restored.'));
 // A response lost after commit must never reveal/reuse a secret or silently rotate on replay.
 const lostKey=randomUUID(),issuePath=`/v1/admin/users/${users[0].user_id}/access-link`,cookieValue=`${cookie[0]}=${cookie.slice(1).join('=')}`;dropIssue=true;
 const opts={method:'POST',headers:{Origin:origin,Cookie:cookieValue,'Content-Type':'application/json','Idempotency-Key':lostKey},body:'{}'};assert.equal((await fetch(origin+issuePath,opts)).status,503);const replay=await fetch(origin+issuePath,opts);assert.equal(replay.status,409);assert.equal((await replay.json()).error.code,'LINK_ALREADY_ISSUED');
 const denied=await fetch(`${origin}/v1/admin/users`,{headers:{Authorization:`Bearer ${new URL(secondLink).hash.slice(7)}`}});assert.equal(denied.status,401);
 // Reissue through the admin UI; the old UUID must stop working immediately.
 await show('Bea Test');await admin.locator('button::-p-text(Issue login link)').click();await admin.waitForSelector('input[aria-label="Student login link"]');
 const rotated=await admin.$eval('input[aria-label="Student login link"]',e=>e.value);assert.notEqual(rotated,secondLink);
 assert.equal((await fetch(`${origin}/v1/student/me`,{headers:{Authorization:`Bearer ${new URL(secondLink).hash.slice(7)}`}})).status,401);
 const replacement={context:await browser.createBrowserContext()};replacement.page=await replacement.context.newPage();await replacement.page.goto(rotated,{waitUntil:'domcontentloaded'});await replacement.page.waitForSelector('.sim-project-button',{timeout:60000});await rename(replacement.page,'Bea active online');
 await admin.locator('button::-p-text(Revoke access)').click();await admin.waitForFunction(()=>document.body.innerText.includes('Access revoked.'));
 await replacement.page.click('button[aria-label="Workspace settings"]');const pendingName=await replacement.page.$('.sim-dialog-label input');await pendingName.focus();await pendingName.evaluate(e=>e.select());await pendingName.type('Bea online retained');await replacement.page.click('.sim-dialog h2');
 await replacement.page.waitForFunction(()=>document.querySelector('#student-auth-state')?.dataset.state==='revoked',{timeout:60000});assert.match(await replacement.page.$eval('#student-auth-state',e=>e.innerText),/Bea online retained/);await replacement.context.close();
 await first.context.close();await second.context.close();assert.deepEqual(errors,[]);
 console.log(JSON.stringify({browser:await browser.version(),checks:['Admin creates two users, issues and copies links','Separate students create and sync independent projects','Admin lists latest projects and reads review without writes','Offline and online revocation retain exports and admin cloud access; restore preserves ownership','UI link rotation invalidates the previous link','Lost issuance response safely replays; student admin access denied']}));
}finally{await browser?.close();await new Promise(done=>server.close(done));await mf.dispose();}
