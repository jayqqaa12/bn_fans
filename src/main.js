const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const puppeteer = require('puppeteer');
const fs = require('fs');

let mainWindow;
let browser = null;
let page = null;
let checkInterval = null;
let taskRunning = false;
let taskLogs = [];

const FOLLOW_API = 'https://www.binance.com/bapi/composite/v2/private/pgc/user/follow';
const FOLLOWERS_API = 'https://www.binance.com/bapi/composite/v3/friendly/pgc/user/queryFollowers';

let config = {};
let cookies = [];
let csrftoken = '';

function loadConfig() {
  try {
    if (fs.existsSync('config.json')) {
      config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
      console.log('配置文件已加载');
    }
  } catch (e) {
    console.log('配置文件加载失败:', e.message);
  }
}

function addLog(msg, type = 'info') {
  const entry = { time: new Date().toLocaleTimeString(), message: msg, type };
  taskLogs.push(entry);
  if (taskLogs.length > 100) taskLogs.shift();
  console.log(`[${type}] ${msg}`);
  
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('task-log', entry);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 600,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function initBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch (e) {}
  }
  
  addLog('启动浏览器...');
  
  const proxyArgs = [];
  if (config.proxy && config.proxy.http) {
    proxyArgs.push(`--proxy-server=${config.proxy.http}`);
  }
  
  browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--disable-blink-features=AutomationControlled', ...proxyArgs],
    defaultViewport: { width: 1200, height: 800 },
    ignoreDefaultArgs: ['--enable-automation']
  });

  page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  
  await page.goto('https://www.binance.com/zh-CN', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const currentUrl = page.url();
  addLog('当前URL: ' + currentUrl);
  
  const isLoggedIn = await page.evaluate(() => {
    const loginButtons = Array.from(document.querySelectorAll('button')).filter(btn => {
      const text = btn.textContent?.trim() || '';
      return text === '登录' || text === '登录/注册';
    });
    const userElements = document.querySelector('[class*="user"], [class*="avatar"], [class*="profile"]');
    return loginButtons.length === 0 || !!userElements;
  });
  
  addLog('检测登录状态: ' + isLoggedIn);
  
  if (!isLoggedIn || currentUrl.includes('login') || currentUrl.includes('accounts')) {
    addLog('请在浏览器中扫码登录...');
    
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
          
          if (loggedIn && !url.includes('login') && !url.includes('accounts')) {
            clearInterval(checkLogin);
            cookies = await page.cookies();
            csrftoken = cookies.find(c => c.name === 'csrftoken')?.value || '';
            addLog('✓ 登录成功');
            mainWindow.webContents.send('login-success');
            resolve(true);
          }
        } catch (e) {
          addLog('检查登录出错: ' + e.message);
        }
      }, 3000);
    });
  } else {
    cookies = await page.cookies();
    csrftoken = cookies.find(c => c.name === 'csrftoken')?.value || '';
    addLog('✓ 已登录');
    mainWindow.webContents.send('login-success');
    return true;
  }
}

async function startFollowTask(username) {
  if (taskRunning) {
    return { success: false, error: '任务正在运行中' };
  }
  
  if (!page || !browser) {
    return { success: false, error: '请先登录' };
  }
  
  taskRunning = true;
  taskLogs = [];
  addLog(`开始任务: 获取 [${username}] 的粉丝并关注`);
  
  if (mainWindow) {
    mainWindow.webContents.send('task-started');
  }
  
  try {
    addLog('打开粉丝页面...');
    try {
      await page.goto(`https://www.binance.com/zh-CN/square/profile/${username}/followers`, { 
        waitUntil: 'domcontentloaded', 
        timeout: 60000 
      });
    } catch (e) {
      addLog('页面加载超时: ' + e.message);
    }
    
    addLog('等待粉丝列表加载...');
    await new Promise(r => setTimeout(r, 5000));
    
    try {
      await page.waitForSelector('.follow-card', { timeout: 15000 });
      addLog('找到关注卡片');
    } catch (e) {
      addLog('等待卡片超时: ' + e.message);
    }
    
    await new Promise(r => setTimeout(r, 2000));
    
    const currentUrl = page.url();
    addLog('当前URL: ' + currentUrl);
    
    if (currentUrl.includes('login') || currentUrl.includes('accounts')) {
      addLog('未登录，请重新登录！', 'error');
      taskRunning = false;
      return;
    }
    
    addLog('开始获取粉丝...');
    
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
        
        if (followCards.length > 0) {
          addLog('卡片状态: ' + followCards.slice(0, 3).map(c => `${c.name}(${c.text})`).join(', '), 'info');
        }
      } catch (e) {
        addLog('获取卡片失败: ' + e.message, 'error');
        await new Promise(r => setTimeout(r, 3000));
        scrollCount++;
        continue;
      }
      
      const needFollow = followCards.filter(c => c.text === '关注' || c.text === 'Follow');
      addLog(`待关注: ${needFollow.length} 个`);
      
      if (needFollow.length === 0) {
        addLog('当前页面已关注完，滚动加载更多...');
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
        addLog(`✓ 关注 ${result.name} 成功`, 'success');
        await new Promise(r => setTimeout(r, 1200));
      }
    }
    
    addLog(`任务完成! 共关注: ${totalFollowed} 人`, 'success');
    taskRunning = false;
    
    if (mainWindow) {
      mainWindow.webContents.send('task-stopped');
    }
    
    return { success: true, totalFollowed };
  } catch (e) {
    addLog(`任务错误: ${e.message}`, 'error');
    console.error('任务错误:', e);
    taskRunning = false;
    
    if (mainWindow) {
      mainWindow.webContents.send('task-stopped');
    }
    
    return { success: false, error: e.message };
  }
}

function stopTask() {
  taskRunning = false;
  addLog('任务已停止', 'error');
  return { success: true };
}

app.whenReady().then(() => {
  loadConfig();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (browser) {
    try {
      await browser.close();
    } catch (e) {}
  }
});

ipcMain.handle('start-login', async () => {
  try {
    await initBrowser();
    return { success: true };
  } catch (e) {
    console.error('Login error:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('start-task', async (event, username) => {
  return await startFollowTask(username);
});

ipcMain.handle('stop-task', async () => {
  return stopTask();
});

ipcMain.handle('get-task-status', async () => {
  return { running: taskRunning, logs: taskLogs };
});
