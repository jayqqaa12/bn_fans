const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { ProxyAgent } = require('proxy-agent');

let config = {};

try {
  if (fs.existsSync('config.json')) {
    config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    console.log('配置文件已加载');
  }
} catch (e) {
  console.log('配置文件加载失败:', e.message);
}

const app = express();
app.use(express.json());
app.use(express.static('public'));

let browser = null;
let page = null;
let cookies = null;
let csrftoken = null;
let taskRunning = false;
let taskLogs = [];

const FOLLOW_API = 'https://www.binance.com/bapi/composite/v2/private/pgc/user/follow';
const FOLLOWERS_API = 'https://www.binance.com/bapi/composite/v3/friendly/pgc/user/queryFollowers';

function loadCookies() {
  if (fs.existsSync('cookies.json')) {
    const data = fs.readFileSync('cookies.json', 'utf8');
    cookies = JSON.parse(data);
    csrftoken = cookies.find(c => c.name === 'csrftoken')?.value || '';
    return true;
  }
  return false;
}

async function initBrowser() {
  loadCookies();
  
  if (browser) {
    try {
      if (page) {
        try {
          await page.url();
          console.log('复用已有浏览器');
          return;
        } catch (e) {
          console.log('Page已失效，关闭浏览器...');
          try {
            await browser.close();
          } catch (e2) {}
        }
      }
    } catch (e) {
      console.log('浏览器检查出错');
    }
    browser = null;
    page = null;
  }
  
  console.log('启动新的浏览器...');
  browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--disable-blink-features=AutomationControlled', '--proxy-server=127.0.0.1:7890'],
    defaultViewport: { width: 1200, height: 800 },
    ignoreDefaultArgs: ['--enable-automation']
  });

  page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  
  if (cookies) {
    await page.setCookie(...cookies);
    console.log('已设置Cookies');
  }
}
  
async function login() {
  loadCookies();
  await initBrowser();
  
  if (cookies) {
    await page.setCookie(...cookies);
  }
  
  try {
    await page.goto('https://www.binance.com/zh-CN', { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (e) {
    console.log('页面加载可能需要更长时间');
  }
  
  await new Promise(r => setTimeout(r, 3000));
  const currentUrl = page.url();
  console.log('当前URL:', currentUrl);
  
  const isLoggedIn = await page.evaluate(() => {
    const loginButtons = Array.from(document.querySelectorAll('button')).filter(btn => {
      const text = btn.textContent?.trim() || '';
      return text === '登录' || text === '登录/注册';
    });
    const userElements = document.querySelector('[class*="user"], [class*="avatar"], [class*="profile"]');
    return loginButtons.length === 0 || !!userElements;
  });
  
  console.log('页面检测登录状态:', isLoggedIn);
  
  if (!isLoggedIn || currentUrl.includes('login') || currentUrl.includes('accounts')) {
    console.log('需要扫码登录...等待用户扫码');
    
    return new Promise((resolve) => {
      const checkLogin = setInterval(async () => {
        try {
          const url = page.url();
          const loggedIn = await page.evaluate(() => {
            const loginButtons = Array.from(document.querySelectorAll('button')).filter(btn => {
              const text = btn.textContent?.trim() || '';
              return text === '登录' || text === '登录/注册';
            });
            return loginButtons.length === 0;
          });
          console.log('检查登录状态:', url, loggedIn);
          if (loggedIn && !url.includes('login') && !url.includes('accounts')) {
            clearInterval(checkLogin);
            cookies = await page.cookies();
            fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
            csrftoken = cookies.find(c => c.name === 'csrftoken')?.value || '';
            console.log('✓ 登录成功，Cookies已保存');
            resolve(true);
          }
        } catch (e) {
          console.log('检查登录出错:', e.message);
        }
      }, 3000);
    });
  } else {
    if (!cookies) {
      cookies = await page.cookies();
      fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
      csrftoken = cookies.find(c => c.name === 'csrftoken')?.value || '';
      console.log('✓ Cookies已保存');
    }
    console.log('已登录');
    return true;
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

function httpRequest(url, options, postData) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : http;
    
    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
    
    if (config.proxy && config.proxy.http) {
      const agent = new ProxyAgent(config.proxy.http);
      requestOptions.agent = agent;
    }
    
    const req = lib.request(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function getFollowers(username, pageIndex = 1, pageSize = 20) {
  if (!page) {
    await initBrowser();
  }
  
  const body = {
    username: username,
    pageIndex: pageIndex,
    pageSize: pageSize,
    offset: 0
  };

  try {
    console.log('通过浏览器发送请求...');
    
    const cookiesStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    const result = await page.evaluate(async (apiUrl, bodyStr, cookieStr, csrfToken) => {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'accept': '*/*',
          'content-type': 'application/json',
          'cookie': cookieStr,
          'csrftoken': csrfToken,
          'origin': 'https://www.binance.com',
          'referer': 'https://www.binance.com/zh-CN/square'
        },
        body: bodyStr
      });
      return await response.json();
    }, FOLLOWERS_API, JSON.stringify(body), cookiesStr, csrftoken);
    
    console.log('API返回:', JSON.stringify(result).substring(0, 500));
    return result;
  } catch (e) {
    console.error('获取粉丝失败:', e.message);
    return null;
  }
}

async function followUser(targetSquareUid) {
  if (!page) {
    await initBrowser();
  }
  
  const body = {
    targetSquareUid: targetSquareUid
  };

  try {
    const cookiesStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    const result = await page.evaluate(async (apiUrl, bodyStr, cookieStr, csrfToken) => {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'accept': '*/*',
          'content-type': 'application/json',
          'cookie': cookieStr,
          'csrftoken': csrfToken,
          'origin': 'https://www.binance.com',
          'referer': 'https://www.binance.com/zh-CN/square'
        },
        body: bodyStr
      });
      return await response.json();
    }, FOLLOW_API, JSON.stringify(body), cookiesStr, csrftoken);
    
    return result;
  } catch (e) {
    console.error('关注失败:', e.message);
    return null;
  }
}

function randomDelay(min = 500, max = 1000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

let loggedIn = false;

async function checkLoginStatus() {
  loadCookies();
  if (!cookies || cookies.length === 0) {
    return false;
  }
  return true;
}

app.get('/api/status', async (req, res) => {
  try {
    const isLoggedIn = await checkLoginStatus();
    res.json({ 
      loggedIn: isLoggedIn,
      taskRunning: taskRunning
    });
  } catch (e) {
    console.error('Status error:', e.message);
    res.json({ 
      loggedIn: false,
      taskRunning: taskRunning,
      error: e.message
    });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const isLoggedIn = await checkLoginStatus();
    res.json({ success: true, loggedIn: isLoggedIn });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/init-login', async (req, res) => {
  try {
    loadCookies();
    if (cookies) {
      await page.setCookie(...cookies);
    }
    const result = await login();
    res.json({ success: true, loggedIn: result });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/start-task', async (req, res) => {
  const { username } = req.body;
  
  if (taskRunning) {
    return res.json({ success: false, error: '任务正在运行中' });
  }
  
  if (!cookies) {
    return res.json({ success: false, error: '请先登录' });
  }
  
  taskRunning = true;
  taskLogs = [];
  
  function addLog(msg, type = 'info') {
    const entry = { time: new Date().toLocaleTimeString(), message: msg, type };
    taskLogs.push(entry);
    if (taskLogs.length > 100) taskLogs.shift();
    console.log(`[${type}] ${msg}`);
  }
  
  addLog(`开始任务: 获取 [${username}] 的粉丝并关注`);
  
  (async () => {
    try {
      let pageConnected = false;
      try {
        await page.url();
        pageConnected = true;
      } catch (e) {}
      
      if (!browser || !page || !pageConnected) {
        addLog('需要启动浏览器...');
        await initBrowser();
      } else {
        addLog('复用已有浏览器');
      }
      
      addLog('打开粉丝页面检测登录状态...');
      try {
        await page.goto(`https://www.binance.com/zh-CN/square/profile/${username}/followers`, { 
          waitUntil: 'domcontentloaded', 
          timeout: 60000 
        });
      } catch (e) {
        addLog('页面加载超时，继续尝试: ' + e.message);
      }
      
      addLog('等待粉丝列表加载...');
      await new Promise(r => setTimeout(r, 5000));
      
      try {
        await page.waitForSelector('.follow-card', { timeout: 15000 });
        addLog('找到关注卡片');
      } catch (e) {
        addLog('等待关注卡片超时: ' + e.message);
      }
      
      await new Promise(r => setTimeout(r, 2000));
      
      const currentUrl = page.url();
      addLog('当前URL: ' + currentUrl);
      
      if (currentUrl.includes('login') || currentUrl.includes('accounts')) {
        addLog('未登录，需要扫码登录！', 'error');
        addLog('请先点击"重新登录"按钮', 'error');
        taskRunning = false;
        return;
      }
      
      addLog('已登录，开始获取粉丝...');
      
      let totalFollowed = 0;
      let scrollCount = 0;
      const maxScrolls = 20;
      
      while (taskRunning && scrollCount < maxScrolls) {
        let followCards = [];
        try {
          followCards = await page.evaluate(() => {
            const cards = document.querySelectorAll('.follow-card');
            return Array.from(cards).map(card => {
              const btn = card.querySelector('button');
              const text = btn ? btn.textContent?.trim() : '';
              const nameEl = card.querySelector('[class*="name"]') || card.querySelector('a');
              const name = nameEl ? nameEl.textContent?.trim() : '未知用户';
              return { text, name };
            });
          });
          addLog('关注卡片数量: ' + followCards.length, 'info');
          if (followCards.length > 0) {
            addLog('卡片状态: ' + followCards.slice(0, 5).map(c => `${c.name}(${c.text})`).join(', '), 'info');
          }
        } catch (e) {
          addLog('获取卡片失败: ' + e.message, 'error');
          await new Promise(r => setTimeout(r, 3000));
          scrollCount++;
          continue;
        }
        
        const needFollow = followCards.filter(c => c.text === '关注' || c.text === 'Follow');
        addLog(`发现 ${needFollow.length} 个待关注用户`);
        
        if (needFollow.length === 0) {
          addLog('当前页面都已关注，滚动加载更多...');
          try {
            await page.evaluate(() => {
              window.scrollBy(0, 800);
            });
          } catch (e) {
            addLog('滚动失败: ' + e.message, 'error');
          }
          await new Promise(r => setTimeout(r, 2000));
          scrollCount++;
          continue;
        }
        
        let result = { success: false };
        try {
          result = await page.evaluate(() => {
            const cards = document.querySelectorAll('.follow-card');
            for (const card of cards) {
              const btn = card.querySelector('button');
              const text = btn ? btn.textContent?.trim() : '';
              if (text === '关注' || text === 'Follow') {
                btn.click();
                const nameEl = card.querySelector('[class*="name"]') || card.querySelector('a');
                const name = nameEl ? nameEl.textContent?.trim() : '未知用户';
                return { success: true, name };
              }
            }
            return { success: false };
          });
        } catch (e) {
          addLog('点击按钮失败: ' + e.message, 'error');
        }
        
        if (result.success) {
          totalFollowed++;
          addLog(`✓ 关注 ${result.name} 成功，累计: ${totalFollowed}`, 'success');
          await new Promise(r => setTimeout(r, 1200));
        }
      }
      
      addLog(`任务完成! 共关注: ${totalFollowed} 人`, 'success');
      taskRunning = false;
    } catch (e) {
      addLog(`任务错误: ${e.message}`, 'error');
      console.error('任务错误:', e);
      taskRunning = false;
    }
  })();
  
  res.json({ success: true });
});

app.post('/api/stop-task', async (req, res) => {
  taskRunning = false;
  res.json({ success: true });
});

app.post('/api/logout', async (req, res) => {
  try {
    if (fs.existsSync('cookies.json')) {
      fs.unlinkSync('cookies.json');
    }
    cookies = null;
    csrftoken = null;
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/task-status', (req, res) => {
  res.json({ running: taskRunning, logs: taskLogs });
});

const HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>币安自动关注机器人</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100vh; color: #fff; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; }
    h1 { text-align: center; color: #f0b90b; margin-bottom: 30px; font-size: 28px; }
    .card { background: rgba(255, 255, 255, 0.05); border-radius: 16px; padding: 30px; margin-bottom: 20px; backdrop-filter: blur(10px); }
    .status-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; background: #ff5252; }
    .status-dot.online { background: #00c853; }
    .status-text { color: #888; font-size: 14px; }
    .input-group { margin-bottom: 20px; }
    .input-group label { display: block; margin-bottom: 8px; color: #aaa; font-size: 14px; }
    .input-group input { width: 100%; padding: 14px 16px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; background: rgba(255, 255, 255, 0.05); color: #fff; font-size: 16px; }
    .input-group input:focus { outline: none; border-color: #f0b90b; }
    .btn { width: 100%; padding: 14px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.3s; }
    .btn-primary { background: #f0b90b; color: #000; }
    .btn-primary:hover { background: #d4a60a; }
    .btn-primary:disabled { background: #666; cursor: not-allowed; }
    .btn-danger { background: #ff5252; color: #fff; margin-top: 10px; }
    .btn-danger:hover { background: #ff1744; }
    .progress { margin-top: 20px; }
    .progress-bar { height: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: #f0b90b; width: 0%; transition: width 0.3s; }
    .progress-text { display: flex; justify-content: space-between; margin-top: 10px; font-size: 14px; color: #888; }
    .log-container { max-height: 300px; overflow-y: auto; background: rgba(0, 0, 0, 0.3); border-radius: 8px; padding: 15px; font-family: monospace; font-size: 13px; margin-top: 20px; }
    .log-entry { margin-bottom: 5px; color: #aaa; }
    .log-entry.success { color: #00c853; }
    .log-entry.error { color: #ff5252; }
  </style>
</head>
<body>
  <div class="container">
    <h1>币安自动关注机器人</h1>
    
    <div class="card">
      <div class="status-bar">
        <div class="status-dot" id="statusDot"></div>
        <span class="status-text" id="statusText">检查登录状态...</span>
        <button class="btn btn-primary" id="loginBtn" onclick="doLogin()" style="margin-left:auto;padding:8px 16px;font-size:12px;width:auto;display:none;">重新登录</button>
        <button class="btn btn-danger" id="logoutBtn" onclick="logout()" style="margin-left:auto;padding:8px 16px;font-size:12px;width:auto;">退出登录</button>
      </div>
      
      <div class="input-group">
        <label>输入要获取粉丝的用户ID</label>
        <input type="text" id="userId" placeholder="例如: dahuzi886">
      </div>
      
      <button class="btn btn-primary" id="startBtn" onclick="startTask()">开始关注</button>
      <button class="btn btn-danger" id="stopBtn" onclick="stopTask()" style="display:none;">停止任务</button>
      
      <div class="progress" id="progress" style="display:none;">
        <div class="progress-bar">
          <div class="progress-fill" id="progressFill"></div>
        </div>
        <div class="progress-text">
          <span id="progressText">0 / 0</span>
          <span id="progressPercent">0%</span>
        </div>
      </div>
    </div>
    
    <div class="card">
      <h3 style="margin-bottom:15px;">执行日志</h3>
      <div class="log-container" id="logs"></div>
    </div>
  </div>
  
  <script>
    function log(msg, type='info') {
      const logs=document.getElementById('logs');
      const entry=document.createElement('div');
      entry.className='log-entry '+type;
      entry.textContent='['+new Date().toLocaleTimeString()+'] '+msg;
      logs.appendChild(entry);
      logs.scrollTop=logs.scrollHeight;
    }
    
    async function checkStatus() {
      const res=await fetch('/api/status');
      const data=await res.json();
      
      const dot=document.getElementById('statusDot');
      const text=document.getElementById('statusText');
      
      if(data.loggedIn){
        dot.className='status-dot online';
        text.textContent='已登录';
        document.getElementById('loginBtn').style.display='none';
        document.getElementById('logoutBtn').style.display='block';
      }else{
        dot.className='status-dot';
        text.textContent='未登录';
        document.getElementById('loginBtn').style.display='block';
        document.getElementById('logoutBtn').style.display='none';
      }
      
      const taskRes=await fetch('/api/task-status');
      const taskData=await taskRes.json();
      
      if(taskData.running){
        document.getElementById('startBtn').style.display='none';
        document.getElementById('stopBtn').style.display='block';
        document.getElementById('progress').style.display='block';
      }else{
        if(document.getElementById('startBtn').style.display==='none'){
          document.getElementById('startBtn').style.display='block';
          document.getElementById('stopBtn').style.display='none';
        }
      }
      
      if(taskData.logs && taskData.logs.length>0){
        const logsDiv=document.getElementById('logs');
        logsDiv.innerHTML='';
        taskData.logs.forEach(l=>log(l.message,l.type));
      }
    }
    
    async function logout(){
      if(!confirm('确定要退出登录吗？'))return;
      await fetch('/api/logout',{method:'POST'});
      location.reload();
    }
    
    async function doLogin() {
      log('正在启动浏览器，请扫码登录...');
      const res = await fetch('/api/init-login', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        log('请扫码登录，页面将自动刷新...');
        const checkInterval = setInterval(async () => {
          const statusRes = await fetch('/api/status');
          const status = await statusRes.json();
          if (status.loggedIn) {
            clearInterval(checkInterval);
            log('登录成功', 'success');
            location.reload();
          }
        }, 3000);
      } else {
        log('登录失败: ' + data.error, 'error');
      }
    }
    
    async function startTask(){
      const userId=document.getElementById('userId').value.trim();
      if(!userId){alert('请输入用户ID');return;}
      
      taskRunning=true;
      document.getElementById('startBtn').style.display='none';
      document.getElementById('stopBtn').style.display='block';
      document.getElementById('progress').style.display='block';
      
      log('开始任务: '+userId);
      
      const res=await fetch('/api/start-task',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({username:userId})
      });
      
      const data=await res.json();
      if(!data.success){
        log('错误: '+data.error,'error');
        resetButtons();
      }
    }
    
    async function stopTask(){
      taskRunning=false;
      await fetch('/api/stop-task',{method:'POST'});
      log('任务已停止','error');
      resetButtons();
    }
    
    function resetButtons(){
      document.getElementById('startBtn').style.display='block';
      document.getElementById('stopBtn').style.display='none';
      document.getElementById('progress').style.display='none';
    }
    
    checkStatus();
    setInterval(checkStatus,3000);
  </script>
</body>
</html>
`;

app.get('/', (req, res) => { res.send(HTML); });

app.listen(3000, () => {
  console.log('======================================');
  console.log('币安自动关注机器人 Web界面');
  console.log('请访问: http://localhost:3000');
  console.log('======================================\n');
  console.log('浏览器将在需要时自动启动');
});
