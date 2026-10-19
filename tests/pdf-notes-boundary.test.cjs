'use strict';
// A viewer integration mock, not a PDF-layout or live-server test.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length,1);
async function fixture(data,opts={}){
 const elements=new Map(),events={},calls=[],downloads=[];let supplied;
 function element(tag){return {tag,style:{},disabled:tag==='save',hidden:false,children:[],textContent:'',clientWidth:720,
  setAttribute(k,v){this[k]=v;},append(...nodes){this.children.push(...nodes);},appendChild(n){this.children.push(n);if(n.tag==='script')n.onload();},
  replaceChildren(){this.children=[];},addEventListener(k,fn){this[k]=fn;},getContext(){return {};},click(){},remove(){}};}
 for(const id of ['title','status','pages','save'])elements.set(id,element(id));
 const TestURL=class extends URL {};
 TestURL.createObjectURL=blob=>{downloads.push(blob);return 'blob:synthetic';};TestURL.revokeObjectURL=()=>{};
 const box=vm.createContext({URL:TestURL,URLSearchParams,Uint8Array,Blob,AbortController,Promise,
  atob:s=>Buffer.from(s,'base64').toString('binary'),setTimeout:()=>0,clearTimeout(){},
  navigator:{userAgent:'synthetic-browser'},window:{location:{search:'?v='+'a'.repeat(64),href:'https://example.invalid/'},devicePixelRatio:1},
  document:{visibilityState:'visible',head:element('head'),body:element('body'),getElementById:id=>elements.get(id),createElement:element,addEventListener(k,fn){events[k]=fn;}},
  fetch:async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>data};},
  pdfjsLib:{GlobalWorkerOptions:{},getDocument(o){supplied=Buffer.from(o.data);return {destroy:async()=>{},promise:Promise.resolve({numPages:1,getPage:async()=>({getViewport:()=>({width:500,height:700}),render(){return {promise:opts.renderFail?Promise.reject(Error('render')):Promise.resolve()};},cleanup(){}})})};}}
 });
 vm.runInContext(scripts[0][1].replace(/openDocument\(\);\s*$/, 'globalThis.run = openDocument;'),box);
 await box.run();
 return {elements,calls,downloads,supplied,body:box.document.body};
}
const pdf=text=>Buffer.from('%PDF-1.4\nsynthetic '+text+'\n%%EOF');
const response=(title,bytes,extra={})=>({ok:true,title,b64:bytes.toString('base64'),...extra});
(async()=>{
 let groups=0;
 for(const [name,title,text,extra] of [
  ['quote notes from PDF','공사 견적서','견적 전용 문구',{견적특이사항:'JSON 무시',특약사항:'계약 전용 무시'}],
  ['blank quote notes stay blank','공사 견적서','본문만',{견적특이사항:'',특약사항:'옛 계약 문구 무시'}],
  ['untrusted JSON cannot overlay','공사 견적서','견적 전용 문구',{견적특이사항:'<script>unsafe</script>',특약사항:'옛 문구'}],
  ['contract remains its own PDF','공사 계약서','계약 특약 보존',{견적특이사항:'견적 문구 무시'}],
  ['payroll remains its own PDF','급여명세서','별도 문서',{견적특이사항:'견적 문구 무시'}]
 ]){
  const bytes=pdf(text),f=await fixture(response(title,bytes,extra));
  assert.deepEqual(f.supplied,bytes,name);assert.equal(f.elements.get('save').disabled,false,name);
  assert.equal(f.elements.get('title').textContent,title,name);assert.equal(f.elements.get('pages').children.length,1,name);
  assert.equal(f.elements.get('pages').children[0].children[1].textContent,'1 / 1',name);
  assert.equal(f.calls.length,1,name);assert.equal(new URL(f.calls[0].url).searchParams.get('f'),'json',name);
  f.elements.get('save').click();assert.equal(f.downloads.length,1,name);
  assert.deepEqual(Buffer.from(await f.downloads[0].arrayBuffer()),bytes,name);groups++;
 }
 for(const data of [response('공사 견적서',Buffer.from('not a PDF'),{견적특이사항:'대신 표시 금지'}),{...response('공사 견적서',pdf('body')),ok:false},response('unknown',pdf('body'))]){
  const f=await fixture(data);assert.equal(f.supplied,undefined);assert.equal(f.elements.get('save').disabled,true);assert.equal(f.elements.get('pages').children.length,0);groups++;
 }
 const failed=await fixture(response('공사 견적서',pdf('body')),{renderFail:true});
 assert.equal(failed.elements.get('save').disabled,true);assert.equal(failed.elements.get('pages').children.length,0);groups++;
 console.log('PASS PDF viewer note boundary '+groups+' mock groups; live PDF layout/server=NOT_TESTED');
})().catch(e=>{console.error(e);process.exitCode=1;});
