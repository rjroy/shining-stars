import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rm, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const controlled = process.env.CITY_REVIEW_CONTROLLED === '1';
const variant = process.env.CITY_REVIEW_VARIANT ?? 'baseline';
assert(['baseline','optimized','spatial','meshopt'].includes(variant));
const spatialComparison = process.env.CITY_REVIEW_SPATIAL_COMPARISON === '1';
const integratedSmoke = process.env.CITY_REVIEW_INTEGRATED_SMOKE === '1';
const currentPbr = process.env.CITY_REVIEW_CURRENT_PBR === '1';
assert(!currentPbr || (integratedSmoke && controlled), 'Current PBR verification must use the normal controlled route');
assert(!spatialComparison || controlled, 'Spatial comparison requires the identical controlled fixtures');
assert(!integratedSmoke || (controlled && variant === 'meshopt'), 'Integrated smoke uses selected compressed artifact and controlled scenes');
assert(variant !== 'spatial' || spatialComparison || integratedSmoke, 'Spatial artifact requires separate evidence output');
const output = `${root}assets/production/brightvale-city/evidence/${currentPbr?'consumer-city-pbr':integratedSmoke?'consumer-compressed':controlled?(spatialComparison?'consumer-spatial/':'consumer-optimized/')+variant:'consumer'}`;
const artifact = `${root}${variant==='meshopt'?'assets/production/brightvale-city/city-meshopt.glb':variant==='spatial'?'assets/experiments/brightvale-city/production-intermediates/city-optimized-spatial.glb':variant==='optimized'?'assets/experiments/brightvale-city/production-intermediates/city-optimized.glb':'assets/experiments/brightvale-city/production-intermediates/city-full-baseline.glb'}`;
const expectedHash = variant==='meshopt'?'db79454415423002bf87eb36d845a427f2c6c3e2dc4a3e63a05e4b2ded1be878':variant==='spatial'?'73022af6f2bc45e38cd5bcbb7eb03f24cfacdd43d9b3f715e91f489fe0e464ff':variant==='optimized'?'7afe010e17ad3dcf87c67efc63d158b96bd8d6a75cdfc313013d2bec570d5fff':'fb03e38ffd4592bd14ed2f9451d0671c1f09de3fecf779ea22d36c292928277c';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { purpose: 'Disposable actual-app validation; no placement/camera/material changes', controlled, variant, integratedSmoke, networkRequests: [], networkFailures: [], networkResponses: [], attempts: [], console: [], exceptions: [], captures: [], cleanup: {} };
let server, browser, socket, profile, debugPort, seq = 0;
const pending = new Map();
async function wait(check, label, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await pause(200); }
  throw Error(`Timed out: ${label}`);
}
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(method)); }, 30000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function click(selector) {
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Unavailable control');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}
async function capture(name) {
  const observed = await evaluate(`(()=>{const {renderer,scene,camera}=window.__cityReview;const city=scene.getObjectByName('CITYProvisionalLayout')||scene.getObjectByProperty('name','CITY.ProvisionalLayout');const materials=new Map();let cityMeshes=0;scene.traverse(o=>{if(o.isMesh && (o.userData.source_object || o.parent?.userData.source_object)){cityMeshes++;for(const m of Array.isArray(o.material)?o.material:[o.material])materials.set(m.uuid,{name:m.name,type:m.type,role:m.userData.brightvaleRole,color:m.color?.toArray(),emissive:m.emissive?.toArray(),intensity:m.emissiveIntensity,side:m.side})}});return {mode:document.querySelector('[data-mode-label]')?.textContent,time:document.querySelector('[data-time]')?.textContent,render:JSON.parse(JSON.stringify(renderer.info)),camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),near:camera.near,far:camera.far,fov:camera.fov},cityFound:!!city,cityMeshes,materials:[...materials.values()],frameIntervals:window.__reviewFrames.slice(-120),heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null}})()`);
  observed.citySceneRenderStats = await evaluate('window.__cityReviewStats');
  observed.fixture = await evaluate('window.__reviewFixture ?? null');
  if(currentPbr) {
    observed.lights = await evaluate(`(()=>{const result=[];window.__cityReview.scene.traverse(o=>{if(o.isLight)result.push({name:o.name,type:o.type,color:o.color.toArray(),groundColor:o.groundColor?.toArray(),intensity:o.intensity,position:o.position.toArray(),castShadow:o.castShadow})});return result})()`);
    observed.citySurfaceMaterials = await evaluate(`(()=>{const s=window.__cityReview.scene;const root=s.getObjectByName('Brightvale.City')||s.getObjectByName('Observatory.BrightvaleCity');const materials=new Map();root?.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.set(m.uuid,{name:m.name,type:m.type,role:m.userData.brightvaleRole||m.userData.city_role,color:m.color?.toArray(),emissive:m.emissive?.toArray(),intensity:m.emissiveIntensity,roughness:m.roughness,metalness:m.metalness,ior:m.ior,side:m.side,hasNormalMap:!!m.normalMap})});return [...materials.values()]})()`);
  }
  observed.renderSettings = await evaluate(`(()=>{const r=window.__cityReview.renderer;return {outputColorSpace:r.outputColorSpace,toneMapping:r.toneMapping,exposure:r.toneMappingExposure,shadowEnabled:r.shadowMap.enabled,shadowType:r.shadowMap.type,shadowAutoUpdate:r.shadowMap.autoUpdate,pixelRatio:r.getPixelRatio()}})()`);
  observed.backend = await evaluate(`(()=>{const gl=window.__cityReview.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return {version:gl.getParameter(gl.VERSION),vendor:e?gl.getParameter(e.UNMASKED_VENDOR_WEBGL):null,renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):null,userAgent:navigator.userAgent,devicePixelRatio,cityMatrix:window.__cityReview.scene.getObjectByName('Brightvale.City')?.matrixWorld.toArray()}})()`);
  observed.cityConsumer = await evaluate(`(()=>{const root=window.__cityReview.scene.getObjectByName('Brightvale.City');if(!root)return null;const mats=new Map();let batches=0,instances=0;root.traverse(o=>{if(!o.isMesh)return;batches++;instances+=o.isInstancedMesh?o.count:1;for(const m of Array.isArray(o.material)?o.material:[o.material])mats.set(m.uuid,{name:m.name,type:m.type,role:m.userData.brightvaleRole,color:m.color?.toArray(),emissive:m.emissive?.toArray(),intensity:m.emissiveIntensity,side:m.side})});return {batches,instances,materials:[...mats.values()]}})()`);
  const image = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(`${output}/${name}.png`, Buffer.from(image.data, 'base64'));
  report.captures.push({ name, ...observed });
}
try {
  const disk = await statfs('/tmp/opencode');
  report.preflight = { memory: await readFile('/proc/meminfo','utf8'), artifactBytes: (await readFile(artifact)).length, scratchAvailableBytes: disk.bavail * disk.bsize };
  assert(report.preflight.scratchAvailableBytes > 1024**3, 'At least 1 GiB available scratch');
  assert(Number(report.preflight.memory.match(/MemAvailable:\s+(\d+)/)[1]) > 4*1048576, 'At least 4 GiB available RAM');
  report.sha256 = createHash('sha256').update(await readFile(artifact)).digest('hex');
  assert.equal(report.sha256, expectedHash);
  await mkdir(output, { recursive: true });
  profile = await mkdtemp('/tmp/opencode/brightvale-consumer-');
  process.env.VITE_SONG_VOLUME = '0';
  server = await createServer({ root, plugins: [{ name: 'disposable-city-review', enforce: 'pre',
    configureServer(s) { if(integratedSmoke){report.attempts.push({event:'Normal app asset routing: no substitution middleware installed'});return;} s.middlewares.use((req,res,next)=>{
      if (req.url?.split('?')[0] !== '/assets/production/brightvale-distant-city/city.glb' || req.url?.includes('import')) return next();
      report.attempts.push({event:'city network substitution attempt',url:req.url,at:new Date().toISOString()});
      res.setHeader('Content-Type','model/gltf-binary'); res.setHeader('Content-Length',report.preflight.artifactBytes);
      res.on('finish',()=>report.attempts.push({event:'city network substitution delivered',at:new Date().toISOString()}));
      createReadStream(artifact).on('error',e=>res.destroy(e)).pipe(res);
    }); },
    transform(code,id) {
      if(!controlled || id.split('?')[0] !== `${root}src/rendering/scene.ts`) return;
      const marker='      lastFrame = frame;';
      assert(code.includes(marker),'Existing actual-app updateFrame interface marker');
      const result=code.replace(marker,`      (window as any).__reviewLastInput = frame;
      if ((window as any).__reviewFixture) frame = (window as any).__reviewFixture;
${marker}`).replace('      observatoryFrame = {','      frame = { ...frame, elapsedSeconds: 0, reducedMotion: true };\n      observatoryFrame = {');
      report.attempts.push({event:'controlled validation-only scene input hook attached',interface:'BrightvaleScene.updateFrame and updateObservatoryFrame',noCameraOrPlacementChange:true});
      return {code:result,map:null};
    },
    transformIndexHtml(html) { return html.replace('<script type="module" src="/src/main.ts"></script>', `<script type="module">
      import * as THREE from '/node_modules/.vite/deps/three.js';
      ${integratedSmoke?`const originalFetch=window.fetch.bind(window);window.fetch=async(...args)=>{const response=await originalFetch(...args);if(response.url.includes('/assets/production/brightvale-city/city-meshopt.glb')){window.__integratedTransfer={url:response.url,status:response.status,contentLength:response.headers.get('content-length')};response.clone().arrayBuffer().then(async bytes=>{window.__integratedTransfer.bytes=bytes.byteLength;window.__integratedTransfer.sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('')}).catch(e=>window.__integratedTransfer.error=String(e))}return response};`:''}
      const before=THREE.Scene.prototype.onBeforeRender;
      THREE.Scene.prototype.onBeforeRender=function(renderer,scene,camera){if(scene.getObjectByName('Brightvale.City')||scene.getObjectByName('CITYProvisionalLayout')||scene.getObjectByName('CITY.ProvisionalLayout'))window.__cityReview={renderer,scene,camera};return before.call(this,renderer,scene,camera)};
      const after=THREE.Scene.prototype.onAfterRender;
      THREE.Scene.prototype.onAfterRender=function(renderer,scene,camera){if(window.__cityReview?.scene===scene){window.__cityReviewStats={...renderer.info.render};window.__reviewCityFrames=(window.__reviewCityFrames||0)+1}return after.call(this,renderer,scene,camera)};
      window.__reviewFrames=[];let last;function frame(t){if(last)window.__reviewFrames.push(t-last);last=t;if(window.__reviewFrames.length>240)window.__reviewFrames.shift();requestAnimationFrame(frame)}requestAnimationFrame(frame);
      await import('/src/main.ts');
      </script>`); }
  }], server: { host: '127.0.0.1', port: 0, strictPort: true } });
  await server.listen(); report.url = server.resolvedUrls.local[0]; assert(!report.url.includes(':3100/'));
  browser = spawn('/usr/bin/chromium', ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--mute-audio','--no-first-run','--disable-extensions','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { stdio: ['ignore','ignore','pipe'] });
  const stderr=[];browser.stderr.on('data',d=>{if(stderr.length<200)stderr.push(String(d))});report.browserStderr=stderr;
  const endpoint = await wait(async()=>{try{return await readFile(`${profile}/DevToolsActivePort`,'utf8')}catch{return null}},'browser endpoint',15000);
  debugPort=Number(endpoint.split('\n')[0]);assert.notEqual(debugPort,3100);
  const pages=await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  socket.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}else if(m.method==='Runtime.consoleAPICalled')report.console.push({type:m.params.type,args:m.params.args.map(a=>a.value??a.description)});else if(m.method==='Runtime.exceptionThrown')report.exceptions.push(m.params);else if(m.method==='Network.requestWillBeSent')report.networkRequests.push({id:m.params.requestId,url:m.params.request.url,type:m.params.type});else if(m.method==='Network.loadingFailed')report.networkFailures.push(m.params);else if(m.method==='Network.responseReceived'){const r=m.params.response;report.networkResponses.push({url:r.url,status:r.status,mimeType:r.mimeType,fromDiskCache:r.fromDiskCache,fromServiceWorker:r.fromServiceWorker})}};
  await command('Runtime.enable');await command('Page.enable');
  if(integratedSmoke)await command('Network.enable');
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const Original=window.AudioContext;window.AudioContext=class extends Original{constructor(...a){super(...a);window.__reviewAudio=this}};const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(when,...a){window.__reviewWhen??=when;return start.call(this,when,...a)}})()`});
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await command('Page.navigate',{url:report.url});
  await wait(()=>evaluate(`!!window.__cityReview && !!document.querySelector('[data-action="all-songs"]') && document.querySelector('[data-renderer-notice]').hidden`),'real app rendered');
  if(integratedSmoke){await wait(()=>evaluate('!!window.__integratedTransfer?.sha256'),'normal city response SHA256');report.normalCityResponse=await evaluate('window.__integratedTransfer');assert.equal(report.normalCityResponse.sha256,expectedHash);assert.equal(report.normalCityResponse.bytes,59559056);assert.equal(report.normalCityResponse.status,200);assert.equal(new URL(report.normalCityResponse.url).pathname,'/assets/production/brightvale-city/city-meshopt.glb');assert(!report.networkResponses.some(r=>r.url.includes('brightvale-distant-city/city.glb')));}
  async function settledCapture(name) {
    const start=await evaluate('window.__reviewCityFrames||0');
    await wait(()=>evaluate(`(window.__reviewCityFrames||0)>=${start+(integratedSmoke?2:5)}`),'warmup city render invocations',45000);
    await evaluate('window.__reviewFrames=[]');
    const sampleStart=await evaluate('window.__reviewCityFrames||0');
    await wait(()=>evaluate(`(window.__reviewCityFrames||0)>=${sampleStart+(integratedSmoke?2:16)}`),'observed city render invocations',60000);
    await capture(name);
  }
  if(controlled) await settledCapture('observatory'); else {await pause(2500);await capture('observatory-existing-placement');}
  await click('[data-action="all-songs"]');await click('[data-action="select-song"][data-song-id="the-first-shining-star"]');await click('[data-action="play"]');
  await wait(()=>evaluate(`window.__reviewAudio?.state==='running' && Number.isFinite(window.__reviewWhen)`),'native playback');
  const chart=JSON.parse(await readFile(`${root}data/charts/generated/the-first-shining-star.charts.json`,'utf8')).charts.normal;
  if(controlled) {
    await evaluate(`(async()=>{const input=window.__reviewLastInput;if(!input)throw Error('No actual-app frame input');const {projectNotes}=await import('/src/rendering/note-projection.ts');const notes=${JSON.stringify(chart.notes)};const states=notes.filter(n=>n.time>=16&&n.time<=18.4).map(n=>({id:n.id,outcome:null}));window.__reviewFixture={city:{phase:'audience',victory:false,cityIntensity:.5,cityBrightness:.61,transitionProgress:0,motion:{powerLinePulse:false,buildingPulse:false,windTravel:false,cameraPush:0},playerDefiant:true,twilightConsumed:false},gameplay:{...input.gameplay,transportTime:16,timeLabel:'00:16',playing:true,reducedMotion:true,notes:projectNotes(states,notes,16,2.4),feedback:[],countdownLabel:''}}})()`);
    await settledCapture('audience');
    await evaluate(`window.__reviewFixture={...window.__reviewFixture,city:{...window.__reviewFixture.city,phase:'twilight',transitionProgress:1}}`);
    await settledCapture('twilight');
    report.result='controlled paired modes captured';
    report.controlledState='Real app updateFrame fixture: transport=16, chart-projected notes, strength=.5/brightness=.61 in both modes, transition=0/1, motion disabled/cameraPush=0; native audio runs muted. HUD remains actual controller state, not relabelled; not earned gameplay.';
  } else {
  await evaluate(`(()=>{const notes=${JSON.stringify(chart.notes)};let next=0;window.__reviewKeys=setInterval(()=>{const t=window.__reviewAudio.currentTime-window.__reviewWhen;while(next<notes.length&&notes[next].time<=t){const n=notes[next++];if(n.time<t-.15)continue;const code=['KeyD','KeyF','KeyJ','KeyK'][n.lane];for(const type of ['keydown','keyup'])window.dispatchEvent(new KeyboardEvent(type,{code,key:code.slice(3).toLowerCase(),bubbles:true}))}},8)})()`);
  let audience=false,twilight=false;const end=Date.now()+(process.env.CITY_REVIEW_AUDIENCE_ONLY?45000:200000);
  while(Date.now()<end&&!twilight){const t=await evaluate('window.__reviewAudio.currentTime-window.__reviewWhen');if(!audience&&t>16){await capture('gameplay-audience-existing-placement');audience=true}if(t>chart.twilightAt+3){await capture('transition-state-requires-visual-check');twilight=true}await pause(200)}
  if(process.env.CITY_REVIEW_AUDIENCE_ONLY){assert(audience);report.limit='Audience material/placement inspection only. Earlier native-playback attempt reached defeat at transition; Twilight appearance remains unverified.'}else assert(audience&&twilight,'Both native gameplay mode-label states captured; inspect transition/render progress before claiming Twilight appearance');
  report.result='captured';
  }
} catch(error){report.result='failed';report.failure=String(error.stack??error);process.exitCode=1;
} finally {
  socket?.close();for(const p of pending.values())clearTimeout(p.timer);
  if(browser){browser.kill('SIGTERM');await Promise.race([new Promise(r=>browser.once('exit',r)),pause(3000)]);if(browser.exitCode===null&&browser.signalCode===null){browser.kill('SIGKILL');await pause(400)}report.cleanup.browserExited=browser.exitCode!==null||browser.signalCode!==null}
  if(server){await server.close();report.cleanup.serverClosed=true}
  if(profile){await rm(profile,{recursive:true,force:true});report.cleanup.profileRemoved=true}
  if(debugPort){try{await fetch(`http://127.0.0.1:${debugPort}/json/list`);report.cleanup.portClosed=false}catch{report.cleanup.portClosed=true}}
  await mkdir(output,{recursive:true});await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,failure:report.failure,output,cleanup:report.cleanup}));
}
