const DEFAULTS = {
  provider: 'keyless',
  baseUrl: 'https://text.pollinations.ai/openai',
  apiKey: '',
  model: 'openai',
  imageFormat: 'dataurl',
  style: 'brief',
  temperature: 0.2,
  maxTokens: 1400
};

let PRESETS = {};
let settings = Object.assign({}, DEFAULTS);

const el = (id) => document.getElementById(id);

function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(resp);
    });
  });
}

async function boot() {
  PRESETS = await send({ type: 'presets:get' }).catch(() => ({}));
  settings = await new Promise((r) => chrome.storage.sync.get(DEFAULTS, (v) => r(Object.assign({}, DEFAULTS, v))));

  const sel = el('provider');
  sel.innerHTML = Object.keys(PRESETS)
    .map((k) => `<option value="${k}">${PRESETS[k].label}</option>`)
    .join('');
  sel.value = PRESETS[settings.provider] ? settings.provider : 'custom';

  el('baseUrl').value = settings.baseUrl || '';
  el('model').value = settings.model || '';
  el('apiKey').value = settings.apiKey || '';
  el('imageFormat').value = settings.imageFormat || 'dataurl';
  el('maxTokens').value = settings.maxTokens || 1400;
  el('temperature').value = settings.temperature === 0 ? 0 : settings.temperature || 0.2;

  paintPresetInfo();
  paintStyle(settings.style);
  applyTokenCap();
}

/* 有些模型对单次输出有硬上限（如 glm-4v-flash = 1024），提前把输入框卡住 */
function applyTokenCap() {
  const p = PRESETS[el('provider').value] || {};
  const cap = Number(p.maxOutput) || 8000;
  const input = el('maxTokens');
  input.max = cap;
  if (Number(input.value) > cap) input.value = cap;
  const tip = el('tokenTip');
  if (tip) {
    tip.textContent = p.maxOutput
      ? `注意：${(p.model || '该模型')} 单次输出上限 ${cap} tokens，超过会自动按 ${cap} 发送。`
      : '多数模型上限 4096~8192；填太大可能被服务端拒绝。';
  }
}

function paintPresetInfo() {
  const p = PRESETS[el('provider').value] || {};
  el('providerNote').textContent = p.note || '';
  if (p.noKey) {
    el('keyHint').textContent = '这个预设不需要 Key，留空即可直接用（限制：约 45 秒 1 次，不能读图）。';
    el('apiKey').placeholder = '可留空';
  } else {
    el('apiKey').placeholder = '粘贴你的 Key';
    el('keyHint').innerHTML = p.keyUrl
      ? `还没有 Key？到 <a href="${p.keyUrl}" target="_blank" rel="noreferrer">${p.keyUrl}</a> 免费注册获取，粘贴到上面即可。`
      : '填写你的 Key；如果接口不需要鉴权可以随便填一个值。';
  }
}

function paintStyle(style) {
  document.querySelectorAll('#styleSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.style === style);
  });
}

el('provider').addEventListener('change', () => {
  const p = PRESETS[el('provider').value] || {};
  if (p.baseUrl) el('baseUrl').value = p.baseUrl;
  if (p.model) el('model').value = p.model;
  if (p.imageFormat) el('imageFormat').value = p.imageFormat;
  paintPresetInfo();
  applyTokenCap();
});

el('toggleKey').addEventListener('click', () => {
  const input = el('apiKey');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  el('toggleKey').textContent = show ? '隐藏' : '显示';
});

document.querySelectorAll('#styleSeg button').forEach((b) => {
  b.addEventListener('click', () => {
    settings.style = b.dataset.style;
    paintStyle(b.dataset.style);
  });
});

function collect() {
  const cap = Number((PRESETS[el('provider').value] || {}).maxOutput) || 8000;
  return {
    provider: el('provider').value,
    baseUrl: el('baseUrl').value.trim(),
    model: el('model').value.trim(),
    apiKey: el('apiKey').value.trim(),
    imageFormat: el('imageFormat').value,
    style: settings.style,
    maxTokens: Math.max(1, Math.min(cap, Number(el('maxTokens').value) || 1400)),
    temperature: Math.max(0, Math.min(1.5, Number(el('temperature').value) || 0))
  };
}

function msg(text, isErr) {
  const m = el('saveMsg');
  m.textContent = text;
  m.className = isErr ? 'err' : '';
  clearTimeout(msg._t);
  msg._t = setTimeout(() => { m.textContent = ''; }, 5000);
}

el('save').addEventListener('click', async () => {
  const patch = collect();
  if (!patch.baseUrl) { msg('接口地址不能为空', true); return; }
  if (!patch.model) { msg('模型名不能为空', true); return; }
  await new Promise((r) => chrome.storage.sync.set(patch, r));
  msg('已保存 ✓');
});

el('test').addEventListener('click', async () => {
  const patch = collect();
  const preset = PRESETS[patch.provider] || {};
  if (!patch.apiKey && !preset.noKey) { msg('这个服务商需要 API Key，先填上再测试', true); return; }
  msg('正在测试…');
  try {
    const res = await send({ type: 'test-api', patch });
    if (res && res.ok) msg('连通 ✓ 模型回复：' + res.message);
    else msg('失败：' + ((res && res.message) || '未知错误'), true);
  } catch (e) {
    msg('失败：' + e.message, true);
  }
});

boot();
