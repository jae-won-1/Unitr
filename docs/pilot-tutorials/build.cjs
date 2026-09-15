// Run from the repository root: node docs/pilot-tutorials/build.cjs
// Offline export of real screenshot crops; no app account access is needed.
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const tracks=require('./slides.cjs');
const ROOT=__dirname, W=1080, H=1600;
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const css=`
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;background:#008000;color:#f7f9f3}
.slide{width:1080px;height:1600px;position:relative;overflow:hidden;background:#008000;break-after:page}
.slide:last-child{break-after:auto}
.brand{position:absolute;left:64px;top:54px;font-size:38px;font-weight:900;letter-spacing:-1.8px}
.brand i{color:#e6f060;font-style:normal}
.role{position:absolute;right:64px;top:62px;font-size:23px;font-weight:700;letter-spacing:2px;text-transform:uppercase}
h1{position:absolute;left:64px;right:64px;top:142px;margin:0;font-size:108px;line-height:.98;font-weight:900;letter-spacing:-4.4px}
h1 span{display:block;white-space:nowrap}h1 span:last-child{color:#e6f060}
.path{position:absolute;left:64px;right:64px;top:390px;min-height:66px;padding:15px 22px;border-radius:12px;background:#e6f060;color:#063b1e;font-size:30px;font-weight:800;line-height:1.2}
.pitch{position:absolute;left:0;top:700px;width:1080px;height:560px;pointer-events:none;color:#f7f9f3;opacity:.14}
.content{position:absolute;left:64px;right:64px;top:510px;height:920px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:28px}
.visual{flex:none;display:flex;align-items:center;justify-content:center;max-width:100%}
.shot{position:relative;overflow:hidden;border-radius:18px;flex:none;background:#f7f9f3;outline:12px solid #f7f9f3;box-shadow:0 16px 38px #063b1e50}
.shot img{position:absolute;display:block;max-width:none}.shot svg{position:absolute;inset:0;width:100%;height:100%}
.action{margin:8px 0 0;width:100%;font-size:34px;line-height:1.24;font-weight:700;letter-spacing:-.35px}
.note{margin:0;width:100%;font-size:25px;line-height:1.3;color:#f7f9f3;opacity:.87}
.footer{position:absolute;left:64px;right:64px;top:1490px;display:flex;align-items:center;justify-content:space-between;font-size:22px;font-weight:700}
.footer a{color:inherit;text-decoration:none}.footer span{letter-spacing:1px;font-variant-numeric:tabular-nums}
.progress{position:absolute;left:64px;right:64px;bottom:39px;display:flex;gap:8px;height:5px}
.progress span{flex:1;background:#f7f9f345;border-radius:8px}.progress .done{background:#e6f060}
@page{size:1080px 1600px;margin:0}@media print{.slide{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;
function renderShot(s){
  const [x,y,w,h]=s.crop, [sw,sh]=s.size;
  const scale=Math.min(888/w,650/h);
  const source=fs.readFileSync(path.join(ROOT,'screens',s.file+'.png')).toString('base64');
  const marks=s.marks.map(m=>`<rect x="${m.x-x}" y="${m.y-y}" width="${m.w}" height="${m.h}" rx="8" fill="none" stroke="#e6f060" stroke-width="${4/scale}"/>`).join('');
  return `<div class="shot" style="width:${w*scale}px;height:${h*scale}px"><img alt="${esc(s.file.replaceAll('-',' '))}: actual app screen" src="data:image/png;base64,${source}" style="width:${sw*scale}px;height:${sh*scale}px;left:${-x*scale}px;top:${-y*scale}px"><svg viewBox="0 0 ${w} ${h}" aria-hidden="true">${marks}</svg></div>`;
}
function renderSlide(t,s,i){
  if(s.shots.length!==1)throw new Error(t.id+': each slide needs exactly one screenshot');
  const heading=s.title.split('<br>').map(line=>'<span>'+esc(line)+'</span>').join('');
  const progress=t.slides.map((_,j)=>`<span class="${j<=i?'done':''}"></span>`).join('');
  return `<article class="slide" id="${t.id}-${i+1}" aria-label="${esc(s.title.replace('<br>',' '))}">
    <div class="brand">UNITER<i>/</i></div><div class="role">${esc(t.label)} · pilot guide</div>
    <h1>${heading}</h1><div class="path">${esc(s.path)}</div>
    <svg class="pitch" viewBox="0 0 1080 560" aria-hidden="true"><path d="M0 280H1080M540 0V560" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="540" cy="280" r="250" fill="none" stroke="currentColor" stroke-width="3"/></svg>
    <div class="content"><div class="visual">${renderShot(s.shots[0])}</div><p class="action">${esc(s.action)}</p><p class="note">${esc(s.note)}</p></div>
    <div class="footer"><a href="https://unitr-omega.vercel.app/">unitr-omega.vercel.app ↗</a><span>${String(i+1).padStart(2,'0')} / ${String(t.slides.length).padStart(2,'0')}</span></div><div class="progress" aria-hidden="true">${progress}</div>
  </article>`;
}
const doc=(t,body=t.slides.map((s,i)=>renderSlide(t,s,i)).join(''))=>`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Uniter · ${esc(t.label)} pilot guide</title><style>${css}</style></head><body>${body}</body></html>`;
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});
    const results=[];
    for(const t of tracks){
      const dir=path.join(ROOT,'images',t.id);fs.mkdirSync(dir,{recursive:true});
      for(const s of t.slides)for(const shot of s.shots){
        const [x,y,w,h]=shot.crop,[sw,sh]=shot.size;
        if(x<0||y<0||x+w>sw||y+h>sh)throw new Error('Crop outside screenshot: '+shot.file);
        for(const m of shot.marks)if(m.x<x||m.y<y||m.x+m.w>x+w||m.y+m.h>y+h)throw new Error('Highlight outside crop: '+shot.file);
      }
      const htmlPath=path.join(ROOT,t.id+'.html');fs.writeFileSync(htmlPath,doc(t));
      await page.goto(pathToFileURL(htmlPath).href);await page.evaluate(()=>document.fonts.ready);
      await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));
      const issues=await page.locator('.slide').evaluateAll(slides=>slides.flatMap((slide,i)=>{
        const errors=[],rect=sel=>slide.querySelector(sel).getBoundingClientRect();
        for(const [a,b] of [['h1','.path'],['.path','.content'],['.visual','.action'],['.action','.note'],['.note','.footer']])
          if(rect(a).bottom>rect(b).top-8)errors.push('Slide '+(i+1)+': '+a+' overlaps '+b);
        for(const el of slide.querySelectorAll('h1 span,.path,.action,.note'))
          if(el.scrollWidth>el.clientWidth+1)errors.push('Slide '+(i+1)+': text overflows '+el.className);
        return errors;
      }));
      if(issues.length)throw new Error(t.id+': '+issues.join('; '));
      await page.pdf({path:path.join(ROOT,'Uniter-'+t.id+'.pdf'),width:W+'px',height:H+'px',printBackground:true,preferCSSPageSize:true,tagged:true});
      // Isolate each JPEG from the long PDF document and wait for stable paint.
      for(let i=0;i<t.slides.length;i++){
        const exportPage=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});
        await exportPage.setContent(doc(t,renderSlide(t,t.slides[i],i)));
        await exportPage.evaluate(()=>document.fonts.ready);
        await exportPage.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));
        await exportPage.locator('.slide').screenshot({path:path.join(dir,String(i+1).padStart(2,'0')+'.jpg'),type:'jpeg',quality:94});
        await exportPage.close();
      }
      results.push({guide:t.id,slides:t.slides.length,pdfBytes:fs.statSync(path.join(ROOT,'Uniter-'+t.id+'.pdf')).size});
    }
    fs.writeFileSync(path.join(ROOT,'validation.json'),JSON.stringify({generated:new Date().toISOString(),slideSize:[W,H],layout:'One screenshot per slide; no text overlaps, horizontal overflow or out-of-bounds crops/highlights.',guides:results},null,2)+'\n');
    console.log(JSON.stringify(results));
  }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
