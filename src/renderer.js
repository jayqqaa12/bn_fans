let isLoggedIn = false;
let taskRunning = false;

function updateStatus(type, message) {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.className = `status ${type}`;
    statusEl.textContent = message;
  }
}

function addLog(msg, type = 'info') {
  const logsDiv = document.getElementById('logs');
  if (!logsDiv) return;
  
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  logsDiv.appendChild(entry);
  logsDiv.scrollTop = logsDiv.scrollHeight;
}

function showTaskPage() {
  const loginPage = document.getElementById('loginPage');
  const taskPage = document.getElementById('taskPage');
  
  if (loginPage) loginPage.classList.add('hidden');
  if (taskPage) taskPage.classList.remove('hidden');
}

function showLoginPage() {
  const loginPage = document.getElementById('loginPage');
  const taskPage = document.getElementById('taskPage');
  
  if (taskPage) taskPage.classList.add('hidden');
  if (loginPage) loginPage.classList.remove('hidden');
  
  updateStatus('pending', '请点击下方按钮登录');
}

async function startLogin() {
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) loginBtn.disabled = true;
  
  updateStatus('pending', '正在启动浏览器...');
  
  try {
    await window.electronAPI.startLogin();
  } catch (e) {
    console.error('Start login error:', e);
    updateStatus('error', '启动失败: ' + e.message);
    if (loginBtn) loginBtn.disabled = false;
  }
}

async function startTask() {
  const targetUserId = document.getElementById('targetUserId');
  if (!targetUserId) return;
  
  const userId = targetUserId.value.trim();
  if (!userId) {
    alert('请输入要获取粉丝的用户ID');
    return;
  }
  
  const startBtn = document.getElementById('startTaskBtn');
  const stopBtn = document.getElementById('stopTaskBtn');
  const userIdInput = document.getElementById('targetUserId');
  
  if (startBtn) startBtn.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'block';
  if (userIdInput) userIdInput.disabled = true;
  
  taskRunning = true;
  addLog('开始任务: ' + userId);
  
  try {
    const result = await window.electronAPI.startTask(userId);
    if (!result.success) {
      addLog('任务错误: ' + result.error, 'error');
    }
  } catch (e) {
    addLog('启动任务失败: ' + e.message, 'error');
  }
}

async function stopTask() {
  if (!taskRunning) return;
  
  const startBtn = document.getElementById('startTaskBtn');
  const stopBtn = document.getElementById('stopTaskBtn');
  const userIdInput = document.getElementById('targetUserId');
  
  try {
    await window.electronAPI.stopTask();
    addLog('任务已停止', 'error');
  } catch (e) {
    addLog('停止任务失败: ' + e.message, 'error');
  }
  
  taskRunning = false;
  
  if (startBtn) startBtn.style.display = 'block';
  if (stopBtn) stopBtn.style.display = 'none';
  if (userIdInput) userIdInput.disabled = false;
}

function resetButtons() {
  const startBtn = document.getElementById('startTaskBtn');
  const stopBtn = document.getElementById('stopTaskBtn');
  const userIdInput = document.getElementById('targetUserId');
  
  if (startBtn) startBtn.style.display = 'block';
  if (stopBtn) stopBtn.style.display = 'none';
  if (userIdInput) userIdInput.disabled = false;
  
  taskRunning = false;
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.electronAPI) {
    window.electronAPI.onLoginSuccess(() => {
      updateStatus('success', '登录成功！');
      isLoggedIn = true;
      
      setTimeout(() => {
        showTaskPage();
      }, 1000);
    });
    
    window.electronAPI.onTaskLog((entry) => {
      addLog(entry.message, entry.type);
    });
    
    window.electronAPI.onTaskStarted(() => {
      taskRunning = true;
    });
    
    window.electronAPI.onTaskStopped(() => {
      resetButtons();
    });
  } else {
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.textContent = 'Electron API 不可用';
      statusEl.className = 'status error';
    }
  }
  
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', startLogin);
  }
  
  const startTaskBtn = document.getElementById('startTaskBtn');
  if (startTaskBtn) {
    startTaskBtn.addEventListener('click', startTask);
  }
  
  const stopTaskBtn = document.getElementById('stopTaskBtn');
  if (stopTaskBtn) {
    stopTaskBtn.addEventListener('click', stopTask);
  }
  
  const reloginBtn = document.getElementById('reloginBtn');
  if (reloginBtn) {
    reloginBtn.addEventListener('click', () => {
      if (confirm('确定要切换账号吗？')) {
        if (window.electronAPI) {
          window.electronAPI.startLogin();
        }
        showLoginPage();
      }
    });
  }
});
