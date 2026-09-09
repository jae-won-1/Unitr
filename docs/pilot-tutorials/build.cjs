// Run from the repository root: node docs/pilot-tutorials/build.cjs
// Uses the existing Playwright installation. No account access is needed.
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const tracks = require('./slides.cjs');
const ROOT = __dirname;
const W=1080, H=1600;
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const title = s => s.split('<br>').map(esc).join('<br>');
const css = `
*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#101f1c;background:#e5ebe5}
.slide{width:${W}px;height:${H}px;position:relative;overflow:hidden;background:#f7f9f3;break-after:page;padding:0;}
.slide:last-child{break-after:auto}.accent{position:absolute;left:0;top:0;width:14px;height:100%;background:#008000}
.brand{position:absolute;left:64px;top:45px;font-size:34px;font-weight:900;letter-spacing:-1.5px}.brand i{color:#008000;font-style:normal}
.role{position:absolute;right:64px;top:44px;border:1px solid #b8c8b9;border-radius:30px;padding:10px 21px;font-size:23px;font-weight:700;text-transform:uppercase;letter-spacing:2px}
h1{position:absolute;left:64px;top:105px;margin:0;font-size:66px;line-height:1.015;letter-spacing:-2.8px;font-weight:800}
.path{position:absolute;left:64px;right:64px;top:255px;font-size:30px;line-height:1.2;font-weight:800;color:#fff;background:#086b32;border-left:8px solid #e6f060;border-radius:10px;padding:12px 16px}
.intro{position:absolute;left:64px;right:64px;top:360px;margin:0;font-size:30px;line-height:1.33;color:#45564f}
.visual{position:absolute;left:64px;right:64px;top:460px;height:743px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#e6ede4;border-radius:25px;padding:22px;overflow:hidden}
.visual.columns{flex-direction:row;align-items:center}.shot{position:relative;overflow:hidden;border-radius:15px;flex:none;box-shadow:0 3px 10px #152e2314;background:#f5f6fb;outline:1px solid #c5d3c8}
.shot img{position:absolute;max-width:none;display:block}.shot svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.steps{position:absolute;left:64px;right:64px;top:1230px;display:flex;flex-direction:column;gap:16px}
.step{display:flex;align-items:flex-start;gap:18px;font-size:29px;line-height:1.25;font-weight:700}.number{width:36px;height:36px;background:#e6f060;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:23px;color:#15271e;flex:none}
.note{position:absolute;left:64px;right:64px;top:1380px;font-size:25px;line-height:1.3;color:#52635a;border-top:2px solid #d6dfd2;padding-top:20px}
.footer{position:absolute;left:64px;right:64px;bottom:34px;display:flex;align-items:center;justify-content:space-between;font-size:22px;font-weight:700;color:#355144}.footer a{color:inherit;text-decoration:none}.footer span{font-variant-numeric:tabular-nums;letter-spacing:1px}
.large h1{font-size:60px}.large .path{top:240px}.large .intro{top:345px;font-size:28px}.large .visual{top:430px;height:860px}.large .steps{top:1310px}.large .step{font-size:27px}.large .note{top:1450px;padding-top:12px;font-size:23px}
@page{size:${W}px ${H}px;margin:0}@media print{body{background:white}.slide{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;
function renderShot(s, scale) {
  const [x,y,w,h]=s.crop;
  const url='data:image/png;base64,'+fs.readFileSync(path.join(ROOT,'screens',s.file+'.png')).toString('base64');
  const markerUnit=(s.size?.[0]??390)>670?2:1;
  const marks = s.marks.map(m=>{
    const px=m.x-x,py=m.y-y;
    const cx=Math.max(13*markerUnit,px+4*markerUnit),cy=Math.max(13*markerUnit,py+4*markerUnit);
    return `<rect x="${px}" y="${py}" width="${m.w}" height="${m.h}" rx="9" fill="none" stroke="#dfe936" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="${12*markerUnit}" fill="#e6f060" stroke="#fff" stroke-width="1.2"/><text x="${cx}" y="${cy+4.5*markerUnit}" text-anchor="middle" font-family="Arial" font-size="${13*markerUnit}" font-weight="bold" fill="#11261c">${m.n}</text>`;
  }).join('');
  const [sw,sh]=s.size??[390,844];
  return `<div class="shot" style="width:${w*scale}px;height:${h*scale}px"><img alt="${esc(s.file.replaceAll('-',' '))}: actual app screen" src="${url}" style="width:${sw*scale}px;height:${sh*scale}px;left:${-x*scale}px;top:${-y*scale}px"><svg viewBox="0 0 ${w} ${h}">${marks}</svg></div>`;
}
function renderSlide(t,s,i){
  // Keep stacked crops at the same scale so both parts retain readable text.
  const availableHeight=s.largeScreen?816:699;
  const scale=s.columns
    ? Math.min((908-(s.shots.length-1)*18)/s.shots.reduce((n,s)=>n+s.crop[2],0),availableHeight/Math.max(...s.shots.map(s=>s.crop[3])))
    : Math.min(908/Math.max(...s.shots.map(s=>s.crop[2])),(availableHeight-(s.shots.length-1)*18)/s.shots.reduce((n,s)=>n+s.crop[3],0));
  return `<article class="slide ${s.largeScreen?'large':''}" id="${t.id}-${i+1}" aria-label="${esc(s.title.replace('<br>',' '))}"><div class="accent"></div><div class="brand">UNITER<i>/</i></div><div class="role">${esc(t.label)} · pilot guide</div><h1>${title(s.title)}</h1><div class="path">${esc(s.path)}</div><p class="intro">${esc(s.intro)}</p><div class="visual ${s.columns?'columns':''}">${s.shots.map(s=>renderShot(s,scale)).join('')}</div><div class="steps">${s.steps.map((s,j)=>`<div class="step"><span class="number">${j+1}</span><div>${esc(s)}</div></div>`).join('')}</div><div class="note">${esc(s.note)}</div><div class="footer"><a href="https://unitr-omega.vercel.app/">unitr-omega.vercel.app ↗</a><span>${String(i+1).padStart(2,'0')} / ${String(t.slides.length).padStart(2,'0')}</span></div></article>`;
}
const doc=(t,slides)=>`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Uniter · ${esc(t.label)} pilot guide</title><style>${css}</style></head><body>${slides}</body></html>`;
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});
  const results=[];
  for(const t of tracks){
    const dir=path.join(ROOT,'images',t.id);fs.mkdirSync(dir,{recursive:true});
    const html=doc(t,t.slides.map((s,i)=>renderSlide(t,s,i)).join(''));
    const htmlPath=path.join(ROOT,t.id+'.html'); fs.writeFileSync(htmlPath,html);
    await page.goto(pathToFileURL(htmlPath).href);await page.evaluate(()=>document.fonts.ready);
    await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));
    const issues=await page.locator('.slide').evaluateAll(slides=>slides.flatMap((s,i)=>{
      const r = el=>el.getBoundingClientRect();const errs=[];
      for(const [a,b] of [['h1','.path'],['.path','.intro'],['.intro','.visual'],['.steps','.note'],['.note','.footer']]) {
        if(r(s.querySelector(a)).bottom>r(s.querySelector(b)).top-3)errs.push(`Slide ${i+1}: ${a} overlaps ${b}`);
      }
      return errs;
    }));
    if(issues.length)throw new Error(t.id+': '+issues.join('; '));
    await page.pdf({path:path.join(ROOT,'Uniter-'+t.id+'.pdf'),width:W+'px',height:H+'px',printBackground:true,preferCSSPageSize:true,tagged:true});
    for(let i=0;i<t.slides.length;i++)await page.locator('.slide').nth(i).screenshot({path:path.join(dir,String(i+1).padStart(2,'0')+'.jpg'),type:'jpeg',quality:92});
    results.push({guide:t.id,slides:t.slides.length,pdfBytes:fs.statSync(path.join(ROOT,'Uniter-'+t.id+'.pdf')).size});
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT,'validation.json'),JSON.stringify({generated:new Date().toISOString(),slideSize:[W,H],layout:'No heading, instructions or footer overlaps detected.',guides:results},null,2)+'\n');
  console.log(JSON.stringify(results));
})().catch(e=>{console.error(e.message);process.exitCode=1});
