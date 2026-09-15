// A compact visual preview of the captain guide, generated from exported JPEGs.
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1376,height:512},deviceScaleFactor:1});
    const images=['01','04','05','09'].map(n=>'<img alt="Captain guide slide '+n+'" src="data:image/jpeg;base64,'+fs.readFileSync(path.join(__dirname,'images/captains',n+'.jpg')).toString('base64')+'">').join('');
    await page.setContent('<html><head><style>*{box-sizing:border-box}body{margin:0;padding:16px;display:flex;gap:16px;background:#f7f9f3}img{display:block;width:324px;height:480px;border-radius:8px}</style></head><body>'+images+'</body></html>');
    await page.locator('img').evaluateAll(xs=>Promise.all(xs.map(x=>x.decode())));
    await page.locator('body').screenshot({path:path.join(__dirname,'preview.jpg'),type:'jpeg',quality:94});
  }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
