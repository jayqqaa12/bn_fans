const puppeteer = require('puppeteer');

async function login() {
  console.log('启动浏览器...');
  
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-web-security',
      '--disable-blink-features=AutomationControlled',
      '--proxy-server=127.0.0.1:7890'
    ],
    defaultViewport: { width: 1200, height: 800 },
    ignoreDefaultArgs: ['--enable-automation']
  });

  const page = await browser.newPage();
  
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  });

  console.log('打开币安登录页...');
  await page.goto('https://accounts.binance.com/zh-CN/login', { 
    waitUntil: 'networkidle2', 
    timeout: 60000 
  });

  console.log('页面加载完成，等待二维码渲染...');
  await new Promise(r => setTimeout(r, 5000));
  
  await page.screenshot({ path: 'page1.png' });

  const iframes = page.frames();
  console.log('Frames数量:', iframes.length);
  
  for (let i = 0; i < iframes.length; i++) {
    try {
      const url = iframes[i].url();
      console.log(`Frame ${i}: ${url}`);
    } catch (e) {
      console.log(`Frame ${i}: 无法获取URL`);
    }
  }
  
  let qrFrame = null;
  for (const frame of iframes) {
    try {
      const url = frame.url();
      if (url && (url.includes('qrcode') || url.includes('QRCode'))) {
        qrFrame = frame;
        console.log('找到二维码Frame:', url);
        break;
      }
    } catch (e) {
      continue;
    }
  }

  if (!qrFrame) {
    console.log('未找到二维码frame，尝试直接在主页面查找canvas...');
    const mainCanvas = await page.$('canvas');
    if (mainCanvas) {
      const qrDataUrl = await mainCanvas.evaluate(el => el.toDataURL());
      console.log('在主页面找到canvas!');
      
      const fs = require('fs');
      const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync('qrcode.png', base64Data, 'base64');
      console.log('二维码已保存到 qrcode.png');
      console.log('请使用币安App扫码登录...');
    }
  } else {
    await qrFrame.waitForSelector('canvas', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    
    const canvas = await qrFrame.$('canvas');
    if (canvas) {
      const qrDataUrl = await canvas.evaluate(el => el.toDataURL());
      console.log('二维码已生成！');
      
      const fs = require('fs');
      const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync('qrcode.png', base64Data, 'base64');
      console.log('二维码已保存到 qrcode.png');
      console.log('请使用币安App扫码登录...');
    }
  }

  console.log('等待扫码登录...(按 Ctrl+C 退出)');
  
  const checkLogin = setInterval(async () => {
    try {
      const currentUrl = page.url();
      console.log('当前URL:', currentUrl);
      
      if (!currentUrl.includes('login') && !currentUrl.includes('accounts')) {
        clearInterval(checkLogin);
        console.log('登录成功！');
        
        const cookies = await page.cookies();
        
        const fs = require('fs');
        fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
        console.log('Cookies已保存');
      }
    } catch (e) {
      console.error('错误:', e.message);
    }
  }, 3000);

  process.on('SIGINT', async () => {
    clearInterval(checkLogin);
    await browser.close();
    process.exit(0);
  });
}

login().catch(e => {
  console.error('错误:', e.message);
  process.exit(1);
});
