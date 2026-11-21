/* 题目助手 · background service worker
 * 职责：保存配置、调用 OpenAI 兼容接口（流式）、截图、跨 frame 转发
 */

const PRESETS = {
  keyless: {
    label: '免 Key 公共接口（Pollinations，开箱即用）',
    baseUrl: 'https://text.pollinations.ai/openai',
    model: 'openai',
    imageFormat: 'dataurl',
    chatPath: '',
    noKey: true,
    keyUrl: '',
    note: '不用注册、不用填 Key，装完直接能用。限制：同一 IP 约 45 秒 1 次请求，只保证文字题；想稳定 + 支持截图识题，换下面的「智谱 glm-4v-flash」。'
  },
  siliconflow: {
    label: '硅基流动 SiliconFlow（有免费模型）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-VL-7B-Instruct',
    imageFormat: 'dataurl',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: '视觉模型 Qwen2.5-VL 按量计费极便宜；想完全零成本可把模型改成免费视觉模型（如 PaddlePaddle/PaddleOCR-VL-1.5）'
  },
  zhipu: {
    label: '智谱 GLM（glm-4v-flash 免费，支持读图）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4v-flash',
    imageFormat: 'base64',
    maxOutput: 1024,
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    note: '推荐长期使用：glm-4v-flash 免费且支持图片，注册只需手机号，国内直连。注意它的单次输出上限是 1024 tokens（插件会自动按上限发送）'
  },
  modelscope: {
    label: '魔搭 ModelScope（免费额度）',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    model: 'Qwen/Qwen2.5-VL-72B-Instruct',
    imageFormat: 'dataurl',
    keyUrl: 'https://modelscope.cn/my/myaccesstoken',
    note: '每天有免费调用额度，国内直连'
  },
  gemini: {
    label: 'Google Gemini（免费额度）',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    imageFormat: 'dataurl',
    keyUrl: 'https://aistudio.google.com/apikey',
    note: '需要能访问 Google'
  },
  openrouter: {
    label: 'OpenRouter（:free 模型）',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash:free',
    imageFormat: 'dataurl',
    keyUrl: 'https://openrouter.ai/keys',
    note: '模型名带 :free 后缀即为免费模型，注意限速'
  },
  custom: {
    label: '自定义（任意 OpenAI 兼容接口）',
    baseUrl: '',
    model: '',
    imageFormat: 'dataurl',
    keyUrl: '',
    note: '填自己的 baseUrl（到 /v1 为止）与模型名'
  }
};

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

const STYLE_PROMPTS = {
  answer: '只给最终答案，不要解析、不要复述题目。选择题只回选项字母 + 该选项内容。',
  brief: '先给最终答案，再用 3-6 行说明关键思路（为什么选它 / 为什么排除其他项）。',
  detail: '给出完整解答：最终答案 → 分步骤推导 → 涉及的知识点或公式 → 易错点提醒。'
};

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (s) => resolve(Object.assign({}, DEFAULTS, s)));
  });
}

function buildSystemPrompt(style) {
  const styleText = STYLE_PROMPTS[style] || STYLE_PROMPTS.brief;
  return [
    '你是一位严谨、准确的中文解题助手。用户会给你一道题目，可能是文字，也可能是截图/图片。',
    '请按下面格式作答：',
    '1) 第一行用「答案：」给出明确结论；选择题必须给出正确选项字母，并抄出该选项的完整内容。',
    '2) 解析要求：' + styleText,
    '3) 图片模糊或题目信息缺失时，直接说明缺了什么，然后给出基于现有信息最可能的答案，不要拒绝作答。',
    '4) 用简体中文，纯文本 + 少量 Markdown（**加粗**、列表、行内代码），不要用表格。',
    '5) 不要输出与解题无关的客套话，不要写免责声明。'
  ].join('\n');
}

function normalizeImage(dataUrl, format) {
  if (!dataUrl) return '';
  if (format === 'base64') return String(dataUrl).replace(/^data:[^,]*,/, '');
  return dataUrl;
}

function pickDelta(json) {
  const choice = json && json.choices && json.choices[0];
  if (!choice) return '';
  const d = choice.delta || choice.message || {};
  const c = d.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((p) => (typeof p === 'string' ? p : p && p.text ? p.text : '')).join('');
  }
  // 部分推理模型把内容放在 reasoning_content
  if (typeof d.reasoning_content === 'string') return d.reasoning_content;
  return '';
}

function shortError(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > 300 ? t.slice(0, 300) + '…' : t;
}

/* 把各类报错翻译成人话，并保留原始信息 */
function describeError(status, raw, sentTokens) {
  const bits = [];
  if (/FREE_LIMIT|Free limit/i.test(raw)) bits.push('免费公共接口限速：同一 IP 约 45 秒只能问一次');
  if (/does not support image|不支持图片|image input/i.test(raw)) bits.push('这个模型不能读图，换 glm-4v-flash / *-VL-* 视觉模型');
  if (/max_tokens|max output|output token|上限|范围/i.test(raw)) {
    bits.push('输出长度超过该模型上限' + (sentTokens ? '（本次按 ' + sentTokens + ' 发送）' : '') + '，到「设置」把最大输出长度调小');
  }
  if (status === 401 || status === 403 || /apikey|api key|鉴权|令牌|未授权/i.test(raw)) bits.push('Key 无效 / 未实名 / 没有该模型的权限');
  if (status === 402) bits.push('余额不足或免费额度用尽');
  if (status === 404) bits.push('接口地址或模型名不对');
  if (status === 429) bits.push('触发限速，稍后再试');
  if (!bits.length) bits.push(status >= 500 ? '服务端异常，稍后重试' : '请求被拒绝');
  return '接口返回 ' + status + '｜' + bits.join('；') + '｜原始：' + shortError(raw);
}

function post(port, msg) {
  try { port.postMessage(msg); } catch (e) { /* 页面已关闭 */ }
}

async function runSolve(payload, requestId, port, signal) {
  const s = await getSettings();
  const preset = PRESETS[s.provider] || {};
  const key = (s.apiKey || '').trim();
  const keyless = preset.noKey === true || /pollinations/i.test(s.baseUrl || '');
  if (!key && !keyless) {
    throw new Error('还没有填写 API Key。点面板右下角「设置」，选一个免费服务商并粘贴 Key。');
  }
  const base = String(s.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('接口地址为空，请在「设置」里填写 baseUrl。');
  const chatPath = preset.chatPath === undefined ? '/chat/completions' : preset.chatPath;
  const url = chatPath && !base.endsWith(chatPath) ? base + chatPath : base;

  const parts = [];
  const text = (payload.text || '').trim();
  if (text) parts.push({ type: 'text', text: '题目：\n' + text });
  if (payload.image) {
    parts.push({ type: 'image_url', image_url: { url: normalizeImage(payload.image, s.imageFormat) } });
  }
  if (!parts.length) throw new Error('没有可发送的题目内容。');

  const messages = [
    { role: 'system', content: buildSystemPrompt(payload.style || s.style) },
    { role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts }
  ];

  // 有些模型对单次输出长度有硬上限（智谱 glm-4v-flash 只有 1024），超出直接 400
  const presetMax = Number(preset.maxOutput) || 8000;
  const wantTokens = Number(s.maxTokens) || 1400;
  const body = {
    model: s.model,
    stream: true,
    temperature: Math.min(1, Math.max(0, Number(s.temperature) >= 0 ? Number(s.temperature) : 0.2)),
    max_tokens: Math.max(1, Math.min(wantTokens, presetMax)),
    messages
  };

  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = 'Bearer ' + key;

  const send = () => fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });

  let res = await send();

  // 参数越界（如 max_tokens 超出服务端范围）时，按服务端给的范围自动修正并重试一次
  if (!res.ok) {
    let raw = await res.text().catch(() => '');
    const range = raw.match(/\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
    const paramErr = /max_tokens|max output|output token|参数/i.test(raw);
    if (res.status === 400 && paramErr && range) {
      const fixed = Number(range[2]);
      if (fixed > 0 && fixed !== body.max_tokens) {
        body.max_tokens = fixed;
        res = await send();
        if (!res.ok) {
          raw = await res.text().catch(() => '');
          throw new Error(describeError(res.status, raw, body.max_tokens));
        }
      } else {
        throw new Error(describeError(res.status, raw, body.max_tokens));
      }
    } else {
      throw new Error(describeError(res.status, raw, body.max_tokens));
    }
  }

  const ctype = res.headers.get('content-type') || '';

  // 有些兼容网关忽略 stream，直接返回 JSON
  if (!ctype.includes('event-stream')) {
    const data = await res.json().catch(() => null);
    const out = data ? pickDelta(data) : '';
    if (out) post(port, { type: 'delta', requestId, text: out });
    post(port, { type: 'done', requestId });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let gotAny = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '').trim();
      buffer = buffer.slice(idx + 1);
      if (!line || line.startsWith(':') || line.startsWith('event:')) continue;
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let json;
      try { json = JSON.parse(data); } catch (e) { continue; }
      if (json.error) throw new Error(shortError(json.error.message || JSON.stringify(json.error)));
      const chunk = pickDelta(json);
      if (chunk) { gotAny = true; post(port, { type: 'delta', requestId, text: chunk }); }
    }
  }

  if (!gotAny) post(port, { type: 'delta', requestId, text: '（模型没有返回内容，可能是模型不支持图片输入，换一个视觉模型试试）' });
  post(port, { type: 'done', requestId });
}

/* ---------------- 连线：长连接流式 ---------------- */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'solve') return;
  let controller = null;

  port.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'stop') {
      if (controller) controller.abort();
      return;
    }
    if (msg.type !== 'start') return;

    if (controller) controller.abort();
    controller = new AbortController();
    runSolve(msg.payload || {}, msg.requestId, port, controller.signal).catch((e) => {
      if (e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''))) {
        post(port, { type: 'aborted', requestId: msg.requestId });
      } else {
        post(port, { type: 'error', requestId: msg.requestId, message: (e && e.message) || String(e) });
      }
    });
  });

  port.onDisconnect.addListener(() => {
    if (controller) controller.abort();
    controller = null;
  });
});

/* ---------------- 一次性消息 ---------------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'settings:get') {
    getSettings().then(sendResponse);
    return true;
  }

  if (msg.type === 'settings:set') {
    chrome.storage.sync.set(msg.patch || {}, () => getSettings().then(sendResponse));
    return true;
  }

  if (msg.type === 'presets:get') {
    sendResponse(PRESETS);
    return;
  }

  if (msg.type === 'capture') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) { sendResponse({ error: 'no tab' }); return; }
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message });
      else sendResponse({ dataUrl });
    });
    return true;
  }

  if (msg.type === 'relay-solve') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) { sendResponse({ error: 'no tab' }); return; }
    chrome.tabs.sendMessage(tabId, { type: 'relay-answer', text: msg.text || '' }, { frameId: 0 }, () => {
      void chrome.runtime.lastError;
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (msg.type === 'test-api') {
    (async () => {
      try {
        const s = await getSettings();
        const patch = msg.patch || {};
        const merged = Object.assign({}, s, patch);
        if (!merged.apiKey) throw new Error('没有填 API Key');
        const res = await fetch(String(merged.baseUrl).replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + merged.apiKey.trim() },
          body: JSON.stringify({
            model: merged.model,
            stream: false,
            max_tokens: 32,
            temperature: 0,
            messages: [{ role: 'user', content: '只回复两个字：正常' }]
          })
        });
        const txt = await res.text();
        if (!res.ok) throw new Error('HTTP ' + res.status + '：' + shortError(txt));
        let out = '';
        try { out = pickDelta(JSON.parse(txt)); } catch (e) { out = shortError(txt); }
        sendResponse({ ok: true, message: out || '连接成功（无内容返回）' });
      } catch (e) {
        sendResponse({ ok: false, message: (e && e.message) || String(e) });
      }
    })();
    return true;
  }
});

/* ---------------- 快捷键 ---------------- */
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'solve-selection') return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null) return;
    chrome.tabs.sendMessage(tab.id, { type: 'command-solve' }, { frameId: 0 }, () => {
      void chrome.runtime.lastError;
    });
  });
});

chrome.runtime.onInstalled.addListener(() => {
  getSettings().then((s) => {
    if (!s.apiKey) chrome.storage.sync.set({ _installedAt: Date.now() });
  });
});
