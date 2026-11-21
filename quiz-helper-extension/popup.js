const DEFAULTS = { provider: 'keyless', baseUrl: '', apiKey: '', model: '', style: 'brief' };

function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(resp);
    });
  });
}

async function init() {
  const s = await new Promise((r) => chrome.storage.sync.get(DEFAULTS, (v) => r(Object.assign({}, DEFAULTS, v))));
  const presets = await send({ type: 'presets:get' }).catch(() => ({}));
  const preset = presets[s.provider] || {};

  document.getElementById('provider').textContent = preset.label || s.provider || '未选择';
  document.getElementById('model').textContent = s.model || '未填写';
  document.getElementById('model').title = s.baseUrl || '';

  const keyEl = document.getElementById('key');
  const st = document.getElementById('status');
  if (!s.apiKey && (s.provider === 'keyless' || /pollinations/i.test(s.baseUrl || ''))) {
    keyEl.textContent = '免 Key 模式';
    keyEl.className = 'ok';
    st.textContent = '开箱即用（45 秒 1 次，仅文字题）';
  } else if (s.apiKey) {
    keyEl.textContent = s.apiKey.slice(0, 6) + '••••' + s.apiKey.slice(-4);
    keyEl.className = 'ok';
    st.textContent = '已配置，可以开箱即用';
  } else {
    keyEl.textContent = '未填写';
    keyEl.className = 'warn';
    st.textContent = '还差一步：填一个免费 API Key';
  }

  document.querySelectorAll('#styles button').forEach((b) => {
    b.classList.toggle('on', b.dataset.style === s.style);
    b.addEventListener('click', () => {
      document.querySelectorAll('#styles button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      chrome.storage.sync.set({ style: b.dataset.style });
    });
  });
}

document.getElementById('opts').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('open').addEventListener('click', async () => {
  const msgEl = document.getElementById('msg');
  msgEl.textContent = '正在打开…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) { msgEl.textContent = '找不到当前标签页'; return; }

  const trySend = () => chrome.tabs.sendMessage(tab.id, { type: 'open-panel' });

  try {
    await trySend();
    window.close();
  } catch (e) {
    // 页面是安装插件之前打开的 → 手动注入一次
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await new Promise((r) => setTimeout(r, 150));
      await trySend();
      window.close();
    } catch (e2) {
      msgEl.textContent = '这个页面不支持注入（如系统页 / 应用商店），换个网页试试';
    }
  }
});

init();
