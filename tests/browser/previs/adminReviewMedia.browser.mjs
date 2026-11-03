import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID, pbkdf2Sync} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,extname,sep} from 'node:path';
import puppeteer from 'puppeteer-core';
const require=createRequire(new URL('../../../backend/package.json',import.meta.url));
const {Miniflare}=require('miniflare'),{build}=require('esbuild'),{unstable_splitSqlQuery:splitSql}=require('wrangler');
const doc=JSON.parse(await readFile('.local-runtime/browser-student-default-export-20261102.json','utf8'));
const audio=await readFile('.local-runtime/browser-student-default-audio-20261102.webm');
const hash=x=>createHash('sha256').update(x).digest('hex');
const artifacts='/tmp/rayzee-default-113-render'; await mkdir(artifacts,{recursive:true});
const salt=randomBytes(16),password=randomUUID(),verifier=`pbkdf2-sha256$1000$${salt.toString('base64url')}$${pbkdf2Sync(password,salt,1000,32,'sha256').toString('base64url')}`;
const script=(await build({entryPoints:['backend/src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'})).outputFiles[0].text;
const mf=new Miniflare({modules:true,script,compatibilityDate:'2026-07-30',d1Databases:['DB','ADMIN_AUTH_DB'],r2Buckets:['DOCUMENTS','NARRATION','LIBRARY'],bindings:{ENVIRONMENT:'test',ENABLE_DRAFT_API:'true',ENABLE_CATALOGUE_API:'true',ALLOW_LOCAL_GEO_EXEMPTION:'true',ADMIN_PASSWORD_VERIFIER:verifier,ADMIN_SESSION_SECRET:randomBytes(32).toString('base64url'),ADMIN_SESSION_SECONDS:'3600',MAX_JSON_BYTES:'1048576',MAX_NARRATION_BYTES:'16777216',MAX_LIBRARY_ASSET_BYTES:'67108864',MAX_DRAFT_REVISIONS:'100',MAX_DRAFT_MEDIA:'10',MAX_DRAFT_CREATIONS_PER_MINUTE:'100'}});
let browser,server;
try {
 const db=await mf.getD1Database('DB'),auth=await mf.getD1Database('ADMIN_AUTH_DB');
 for (const name of (await readdir('backend/migrations')).filter(x=>/^\d+_.*\.sql$/.test(x)).sort()) {const sql=await readFile(`backend/migrations/${name}`,'utf8');await db.batch(splitSql(sql).map(q=>db.prepare(q)));if(name==='0003_admin_password.sql')await auth.batch(splitSql(sql).map(q=>auth.prepare(q)));}
 const id=randomUUID(),projectId=randomUUID(),draftId=randomUUID(),now=Date.now(),asset=Object.values(doc.narration.assets)[0];assert.equal(hash(audio),asset.sha256);
 doc.projectId=projectId;doc.narration.clips=[{narrationClipId:randomUUID(),media:{assetId:asset.assetId,version:asset.version},anchor:{type:'sequence'},offsetFrames:94,sourceStartSample:0,lengthSamples:asset.durationSamples,gain:1,muted:false}];
 await db.prepare('INSERT INTO student_users (user_id,first_name,last_name,graduation_year,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(id,'Review','Fixture',2030,now,now).run();
 await db.prepare('INSERT INTO drafts (draft_id,capability_hash,create_request_id,create_request_hash,created_at) VALUES (?,?,?,?,?)').bind(draftId,'a'.repeat(64),randomUUID(),'b'.repeat(64),now).run();
 await db.prepare("INSERT INTO student_projects (project_id,user_id,draft_id,state,title,created_at,updated_at) VALUES (?,?,?,'live',?,?,?)").bind(projectId,id,draftId,doc.name,now,now).run();
 const bytes=JSON.stringify(doc),docKey=`fixture/${randomUUID()}`,docSha=hash(bytes);await db.prepare("INSERT INTO object_reservations VALUES (?,'pending',?)").bind(docKey,now).run();await(await mf.getR2Bucket('DOCUMENTS')).put(docKey,bytes,{sha256:docSha,httpMetadata:{contentType:'application/json'}});await db.prepare('INSERT INTO draft_revisions VALUES (?,?,?,?,?,?,?,?,?,?)').bind(draftId,0,doc.revision,projectId,randomUUID(),'c'.repeat(64),docKey,docSha,Buffer.byteLength(bytes),now).run();
 const audioKey=`fixture/${randomUUID()}`;await(await mf.getR2Bucket('NARRATION')).put(audioKey,audio,{sha256:asset.sha256,httpMetadata:{contentType:asset.mimeType}});await db.prepare("INSERT INTO media_objects (draft_id,media_id,request_id,request_hash,object_key,sha256,byte_length,mime_type,state,created_at) VALUES (?,?,?,?,?,?,?,?,'complete',?)").bind(draftId,`${asset.assetId}@${asset.version}`,randomUUID(),'d'.repeat(64),audioKey,asset.sha256,audio.length,asset.mimeType,now).run();
 const assets=resolve('app/dist'), mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.hdr':'image/vnd.radiance','.png':'image/png'};
 const errors=[],requests=[];
 server=createServer(async(req,res)=>{try {const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/v1/')) console.log('REQUEST',u.pathname);
  if((u.pathname==='/v1/catalogue'||u.pathname.startsWith('/v1/catalogue/')||u.pathname==='/v1/plates'||u.pathname.startsWith('/v1/plates/'))) {const response=await fetch(`https://vp-previs.pages.dev${u.pathname}${u.search}`, {method:req.method, headers:{Origin:'https://vp-previs.pages.dev',...(req.headers.cookie?{Cookie:req.headers.cookie}:{}),...(req.headers.range?{Range:req.headers.range}:{})}});requests.push({path:u.pathname,status:response.status});console.log('RESPONSE',u.pathname,response.status);const headers=Object.fromEntries(response.headers);delete headers['content-encoding'];delete headers['content-length'];res.writeHead(response.status,headers);res.end(Buffer.from(await response.arrayBuffer()));return;}
  if(u.pathname.startsWith('/v1/')){const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks),headers={...req.headers};delete headers.host;delete headers.connection;delete headers['content-length'];requests.push({method:req.method,path:u.pathname});const response=await mf.dispatchFetch(`http://127.0.0.1:${server.address().port}${u.pathname}${u.search}`,{method:req.method,headers,...(body.length?{body}:{})});const h=Object.fromEntries(response.headers);delete h['content-encoding'];delete h['content-length'];res.writeHead(response.status,h);res.end(Buffer.from(await response.arrayBuffer()));return;}
  const path=resolve(assets,`.${decodeURIComponent(u.pathname)}${u.pathname.endsWith('/')?'index.html':''}`);if(!path.startsWith(`${assets}${sep}`))throw Error('bad path');const data=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless'});res.end(data);
 }catch(e){errors.push(`${req.url}: ${e.message}`);res.writeHead(500);res.end('failed');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const login=await fetch(`${origin}/v1/admin/session`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0].split('=');
 browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,protocolTimeout:240000,args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const page=await browser.newPage();await page.evaluateOnNewDocument(()=>{window.reviewAudioStarts=0;const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){window.reviewAudioStarts++;return start.apply(this,args)}});await page.setViewport({width:1586,height:992});page.setDefaultTimeout(180000);await page.setCookie({name:cookie[0],value:cookie.slice(1).join('='),url:origin,secure:true,httpOnly:true});const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 await page.goto(`${origin}/admin/users/review/?user=${id}&project=${projectId}`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#review-status')?.innerText==='Read-only review',{timeout:180000});assert.equal(await page.$eval('#review-shot',e=>e.options.length),4);
 // The first source shot intentionally freezes its LED video. Play the second
 // shot, whose saved media mode is playing, and observe at least one second.
 await page.select('#review-shot','94');await page.waitForFunction(()=>document.querySelector('#review-status')?.innerText==='Read-only review' && !document.querySelector('#review-play')?.disabled,{timeout:180000});
 const before=hash(await page.$eval('#review-viewport canvas',c=>c.toDataURL()));await page.click('#review-play');
 await page.waitForFunction(()=>Number(document.querySelector('#review-time')?.dataset.frame)>=119,{timeout:30000});
 const during=hash(await page.$eval('#review-viewport canvas',c=>c.toDataURL()));assert.notEqual(before,during);
 assert.ok(requests.some(r=>r.path.includes('/narration/')&&r.method==='GET'));assert.ok(await page.evaluate(()=>window.reviewAudioStarts>0),'verified narration must be scheduled for playback');await page.click('#review-pause');
 const renderedShots=[];const starts=await page.$$eval('#review-shot option',options=>options.map(o=>o.value));
 for(const start of starts){await page.select('#review-shot',start);await page.waitForFunction(()=>document.querySelector('#review-status')?.innerText==='Read-only review'&&!document.querySelector('#review-play')?.disabled,{timeout:180000});renderedShots.push(hash(await page.$eval('#review-viewport canvas',c=>c.toDataURL())));}
 assert.equal(new Set(renderedShots).size,4,'all four admin shots render distinct framing');
 await page.keyboard.down('Meta');await page.keyboard.press('S');await page.keyboard.press('Z');await page.keyboard.up('Meta');assert.equal((await db.prepare('SELECT count(*) AS n FROM draft_revisions').first()).n,1);assert.ok(!requests.some(r=>r.path.startsWith('/v1/admin/projects/')&&r.method!=='GET'));assert.deepEqual(pageErrors,[]);await page.screenshot({path:'/tmp/rayzee-admin-review-media.png'});console.log(JSON.stringify({browser:await browser.version(),shots:4,renderedFrameChanged:true,narrationRead:true,documentWrites:0,requests:requests.length,errors},null,2));
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await mf.dispose();}
