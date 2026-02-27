const puppeteer = require('puppeteer');
const fs = require('fs');

let browser = null;
let page = null;
let cookies = null;
let csrftoken = null;

const FOLLOW_API = 'https://www.binance.com/bapi/composite/v2/private/pgc/user/follow';
const FOLLOWERS_API = 'https://www.binance.com/bapi/composite/v3/friendly/pgc/user/queryFollowers';

async function loadCookies() {
  if (fs.existsSync('cookies.json')) {
    const data = fs.readFileSync('cookies.json', 'utf8');
    cookies = JSON.parse(data);
    csrftoken = cookies.find(c => c.name === 'csrftoken')?.value || '';
    console.log('✓ Cookies加载成功');
    return true;
  }
  return false;
}

async function initBrowser() {
  console.log('启动浏览器...');
  
  browser = await puppeteer.launch({
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

  page = await browser.newPage();
  
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  
  if (cookies) {
    await page.setCookie(...cookies);
    console.log('✓ Cookies已设置');
  }
}

async function login() {
  const hasCookies = await loadCookies();
  
  await initBrowser();
  
  console.log('打开币安...');
  await page.goto('https://www.binance.com/zh-CN', { 
    waitUntil: 'networkidle2', 
    timeout: 30000 
  });
  
  await new Promise(r => setTimeout(r, 2000));
  
  const currentUrl = page.url();
  console.log('当前URL:', currentUrl);
  
  if (currentUrl.includes('login') || currentUrl.includes('accounts')) {
    console.log('需要登录，等待扫码...');
    
    await page.waitForSelector('iframe', { timeout: 15000 }).catch(() => null);
    await new Promise(r => setTimeout(r, 3000));
    
    let qrFrame = null;
    const iframes = page.frames();
    for (const frame of iframes) {
      try {
        const url = frame.url();
        if (url && url.includes('qrcode')) {
          qrFrame = frame;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (qrFrame) {
      await qrFrame.waitForSelector('canvas', { timeout: 15000 }).catch(() => null);
      await new Promise(r => setTimeout(r, 2000));
      
      const canvas = await qrFrame.$('canvas');
      if (canvas) {
        const qrDataUrl = await canvas.evaluate(el => el.toDataURL());
        const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync('qrcode.png', base64Data, 'base64');
        console.log('✓ 二维码已保存到 qrcode.png');
        console.log('请使用币安App扫码登录...');
      }
    }

    const checkLogin = setInterval(async () => {
      const url = page.url();
      if (!url.includes('login') && !url.includes('accounts')) {
        clearInterval(checkLogin);
        cookies = await page.cookies();
        fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
        console.log('✓ 登录成功，Cookies已保存');
      }
    }, 3000);
  } else {
    console.log('✓ 已登录');
  }
}

function buildHeaders(referer = 'https://www.binance.com/zh-CN/square') {
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  
  return {
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'bnc-level': '0',
    'bnc-location': 'CN',
    'bnc-time-zone': 'Asia/Shanghai',
    'bnc-uuid': cookies.find(c => c.name === 'bnc-uuid')?.value || '',
    'clienttype': 'web',
    'content-type': 'application/json',
    'cookie': cookieStr,
    'csrftoken': csrftoken,
    'lang': 'zh-CN',
    'origin': 'https://www.binance.com',
    'referer': referer,
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  };
}

async function getFollowers(username, pageIndex = 1, pageSize = 20) {
  if (!cookies) {
    throw new Error('请先登录');
  }

  const headers = buildHeaders(`https://www.binance.com/zh-CN/square/profile/${username}/followers`);
  
  const body = {
    username: username,
    pageIndex: pageIndex,
    pageSize: pageSize,
    offset: 0
  };

  console.log(`[API] 获取粉丝列表 - ${username} - 第${pageIndex}页`);

  try {
    const response = await fetch(FOLLOWERS_API, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });

    const data = await response.json();
    console.log('API响应:', JSON.stringify(data).substring(0, 500));
    return data;
  } catch (e) {
    console.error('获取粉丝失败:', e.message);
    return null;
  }
}

async function followUser(targetSquareUid) {
  if (!cookies) {
    throw new Error('请先登录');
  }

  const headers = buildHeaders('https://www.binance.com/zh-CN/square');
  
  const body = {
    targetSquareUid: targetSquareUid
  };

  try {
    const response = await fetch(FOLLOW_API, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });

    const data = await response.json();
    return data;
  } catch (e) {
    console.error('关注失败:', e.message);
    return null;
  }
}

function randomDelay(min = 500, max = 1000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function startTask(username) {
  console.log(`\n========================================`);
  console.log(`开始任务: 获取 [${username}] 的粉丝并关注`);
  console.log(`========================================\n`);
  
  let pageIndex = 1;
  let totalFollowed = 0;
  let hasMore = true;

  while (hasMore) {
    const result = await getFollowers(username, pageIndex);
    
    if (!result || !result.data || !result.data.list || result.data.list.length === 0) {
      console.log('没有更多粉丝了');
      break;
    }

    const followers = result.data.list;
    console.log(`\n[第${pageIndex}页] 获取到 ${followers.length} 个粉丝`);

    for (let i = 0; i < followers.length; i++) {
      const follower = followers[i];
      const targetSquareUid = follower.targetSquareUid || follower.userId || follower.squareUid;
      const nickname = follower.nickname || follower.userNickName || follower.nickName || '未知用户';
      
      if (!targetSquareUid) {
        console.log(`  [跳过] ${nickname} (无targetSquareUid)`);
        continue;
      }

      const delay = randomDelay(500, 1000);
      await new Promise(r => setTimeout(r, delay));

      const followResult = await followUser(targetSquareUid);
      
      if (followResult && followResult.success) {
        totalFollowed++;
        console.log(`  [✓] 关注成功: ${nickname} | 已关注: ${totalFollowed}/${followers.length * pageIndex}`);
      } else {
        const msg = followResult?.message || '未知错误';
        console.log(`  [✗] 关注失败: ${nickname} | 原因: ${msg}`);
      }
    }

    hasMore = result.data.hasMore || false;
    pageIndex++;

    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n========================================`);
  console.log(`任务完成! 共关注: ${totalFollowed} 人`);
  console.log(`========================================\n`);
  
  if (browser) {
    await browser.close();
  }
  process.exit(0);
}

async function main() {
  const username = process.argv[2];
  
  console.log('\n======================================');
  console.log('   币安自动关注机器人 v1.0');
  console.log('======================================\n');
  
  await login();
  
  if (username) {
    console.log(`\n开始执行任务: ${username}`);
    await startTask(username);
  } else {
    console.log('\n用法: node app.js <用户ID>');
    console.log('示例: node app.js dahuzi886');
    
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('\n请输入要获取粉丝的用户ID: ', async (input) => {
      if (input.trim()) {
        await startTask(input.trim());
      }
      rl.close();
    });
  }
}

main();
