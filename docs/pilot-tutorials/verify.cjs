// Offline artifact checks. Run after build.cjs from any working directory.
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const tracks=require('./slides.cjs');
(async()=>{
  for(const t of tracks){
    const pdf=fs.readFileSync(path.join(__dirname,'Uniter-'+t.id+'.pdf')).toString('latin1');
    const count=(pdf.match(/\/Type\s*\/Page\b/g)||[]).length;
    if(!pdf.startsWith('%PDF-')||!pdf.trimEnd().endsWith('%%EOF')||count!==t.slides.length)throw new Error(t.id+': invalid PDF structure/count');
    if(!pdf.includes('https://unitr-omega.vercel.app/'))throw new Error(t.id+': missing PDF app link');
    const images=fs.readdirSync(path.join(__dirname,'images',t.id)).filter(f=>/^\d+\.jpg$/.test(f));
    if(images.length!==t.slides.length)throw new Error(t.id+': stale/missing JPEG files');
    console.log(t.id+': '+count+' PDF pages and JPEGs');
  }
  const browser=await chromium.launch();
  try{
    const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await p.goto(pathToFileURL(path.join(__dirname,'index.html')).href);
    for(const t of tracks){
      await p.locator('#track').selectOption(t.id);
      if(!await p.locator('#prev').isDisabled())throw new Error('Previous must be disabled on first slide');
      for(let i=1;i<=t.slides.length;i++){
        const pixels=await p.locator('#slide').evaluate(async (img,source)=>{
          await img.decode();
          if(img.naturalWidth!==1080||img.naturalHeight!==1600)throw new Error('JPEG dimensions');
          const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1600;
          const painted=new Image();painted.src=source;await painted.decode();
          const ctx=canvas.getContext('2d');ctx.drawImage(painted,0,0);
          const lightPixels=(x,y,w,h)=>{const a=ctx.getImageData(x,y,w,h).data;let n=0;for(let k=0;k<a.length;k+=4)if(a[k]>180&&a[k+1]>180&&a[k+2]>100)n++;return n;};
          return {brand:lightPixels(64,54,185,50),footer:lightPixels(64,1490,420,35)};
        },'data:image/jpeg;base64,'+fs.readFileSync(path.join(__dirname,'images',t.id,String(i).padStart(2,'0')+'.jpg')).toString('base64'));
        if(pixels.brand<200||pixels.footer<200)throw new Error(t.id+'/'+i+': missing rendered brand/footer '+JSON.stringify(pixels));
        if(await p.locator('#count').innerText()!==i+' / '+t.slides.length)throw new Error('Viewer counter');
        if(i<t.slides.length)await p.locator('#next').click();
      }
      if(!await p.locator('#next').isDisabled())throw new Error('Next must be disabled on final slide');
      await p.locator('#prev').click();
      if(await p.locator('#count').innerText()!==(t.slides.length-1)+' / '+t.slides.length)throw new Error('Previous navigation');
    }
    if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile horizontal overflow');
    await p.setViewportSize({width:1440,height:1000});
    if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Desktop horizontal overflow');
    console.log('All '+tracks.reduce((n,t)=>n+t.slides.length,0)+' images decoded with visible branding/footer; viewer counts, role switching, next/previous and mobile/desktop width passed.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
