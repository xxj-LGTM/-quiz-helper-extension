/* 题目助手 · content script
 * 页面内悬浮面板：选文字解题 / 点选取题 / 自动抓题 / 截图识题（视觉模型）
 */
(() => {
  if (window.__QH_LOADED__) return;
  window.__QH_LOADED__ = true;

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

  function isKeyless() {
    return settings.provider === 'keyless' || /pollinations/i.test(settings.baseUrl || '');
  }

  const IS_TOP = (() => {
    try { return window.top === window.self; } catch (e) { return false; }
  })();

  let settings = Object.assign({}, DEFAULTS);
  let host = null;
  let root = null;
  const els = {};
  let busy = false;
  let curReq = null;
  let curPort = null;
  let rawAnswer = '';
  let rafPending = false;
  let pickCleanup = null;
  let lastPointer = { x: 0, y: 0 };

  /* ============================ 样式 ============================ */
  const CSS = `
    .qh-wrap, .qh-wrap * { box-sizing: border-box; }
    .qh-wrap { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; font-size: 13px; line-height: 1.55; color: #111827; text-align: left; }
    .qh-wrap [hidden] { display: none !important; }
    .qh-wrap button { font-family: inherit; cursor: pointer; }

    .qh-launcher { pointer-events: auto; position: fixed; right: 18px; bottom: 20px; width: 46px; height: 46px; border-radius: 14px; border: none; background: linear-gradient(140deg, #3b82f6, #4f46e5); color: #fff; font-size: 13px; font-weight: 700; letter-spacing: 1px; box-shadow: 0 8px 22px rgba(59,130,246,.38); display: flex; align-items: center; justify-content: center; transition: transform .12s ease, box-shadow .12s ease; }
    .qh-launcher:hover { transform: translateY(-2px); box-shadow: 0 12px 26px rgba(59,130,246,.45); }

    .qh-panel { pointer-events: auto; position: fixed; right: 18px; bottom: 76px; width: 384px; max-width: calc(100vw - 24px); background: #fff; border: 1px solid #e6e9ef; border-radius: 14px; box-shadow: 0 20px 54px rgba(15,23,42,.20); display: flex; flex-direction: column; max-height: min(660px, 80vh); overflow: hidden; }
    .qh-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-bottom: 1px solid #f1f5f9; background: #fafbff; cursor: move; user-select: none; }
    .qh-title { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0; font-weight: 600; font-size: 13px; }
    .qh-badge { font-weight: 500; font-size: 11px; color: #4338ca; background: #eef2ff; border-radius: 6px; padding: 1px 6px; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qh-x { border: none; background: transparent; color: #9ca3af; font-size: 18px; line-height: 1; padding: 1px 5px; border-radius: 6px; }
    .qh-x:hover { background: #f1f5f9; color: #4b5563; }
    .qh-body { padding: 10px 12px 11px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
    .qh-body textarea { width: 100%; min-height: 92px; max-height: 190px; resize: vertical; border: 1px solid #e6e9ef; border-radius: 10px; padding: 8px 10px; font-size: 12.5px; line-height: 1.62; color: #111827; background: #fff; outline: none; font-family: inherit; display: block; }
    .qh-body textarea:focus { border-color: #93c5fd; box-shadow: 0 0 0 3px rgba(59,130,246,.12); }
    .qh-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .qh-chip { border: 1px solid #e6e9ef; background: #fff; color: #374151; border-radius: 8px; padding: 5px 9px; font-size: 12px; }
    .qh-chip:hover { border-color: #bfdbfe; background: #f8fbff; color: #1d4ed8; }
    .qh-go { margin-left: auto; border: none; background: #2563eb; color: #fff; border-radius: 8px; padding: 6px 16px; font-size: 12px; font-weight: 600; }
    .qh-go:hover { background: #1d4ed8; }
    .qh-go:disabled { opacity: .5; cursor: default; }
    .qh-styles { display: flex; gap: 4px; background: #f3f4f6; padding: 3px; border-radius: 9px; }
    .qh-styles button { flex: 1; border: none; background: transparent; color: #6b7280; padding: 4px 0; border-radius: 7px; font-size: 12px; }
    .qh-styles button.on { background: #fff; color: #1d4ed8; font-weight: 600; box-shadow: 0 1px 2px rgba(15,23,42,.10); }
    .qh-answer { border: 1px solid #eef1f6; background: #fbfcfe; border-radius: 10px; padding: 10px 11px; font-size: 12.5px; line-height: 1.72; overflow: auto; min-height: 104px; max-height: 47vh; word-break: break-word; }
    .qh-answer .qh-empty { color: #9aa3b2; }
    .qh-answer .qh-h { font-weight: 700; margin: 7px 0 2px; }
    .qh-answer .qh-li { padding-left: 15px; position: relative; }
    .qh-answer .qh-li:before { content: "•"; position: absolute; left: 3px; color: #9db0c8; }
    .qh-answer .qh-gap { height: 6px; }
    .qh-answer code { background: #eef2f7; padding: 1px 4px; border-radius: 4px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
    .qh-answer pre { background: #f1f5f9; border: 1px solid #e6e9ef; padding: 8px 9px; border-radius: 8px; overflow: auto; margin: 6px 0; }
    .qh-answer pre code { background: transparent; padding: 0; }
    .qh-answer .qh-err { color: #b91c1c; }
    .qh-answer .qh-hint { color: #6b7280; font-size: 11.5px; margin-top: 6px; }
    .qh-foot { display: flex; align-items: center; gap: 5px; }
    .qh-foot button { border: none; background: transparent; color: #4b5563; padding: 3px 7px; border-radius: 6px; font-size: 11.5px; }
    .qh-foot button:hover { background: #f3f4f6; color: #111827; }
    .qh-status { font-size: 11px; color: #9aa3b2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
    .qh-spacer { flex: 1; }

    .qh-bubble { pointer-events: auto; position: fixed; z-index: 2147483647; background: #111827; color: #fff; border: none; border-radius: 8px; padding: 5px 11px; font-size: 12px; font-weight: 600; box-shadow: 0 6px 18px rgba(0,0,0,.28); }
    .qh-bubble:hover { background: #1f2937; }

    .qh-shot-layer { pointer-events: auto; position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; }
    .qh-shot-bg { position: absolute; inset: 0; background-repeat: no-repeat; background-size: 100% 100%; }
    .qh-shot-rect { position: absolute; border: 2px solid #2563eb; background: rgba(37,99,235,.10); box-shadow: 0 0 0 9999px rgba(15,23,42,.45); }
    .qh-shot-tip { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); background: #111827; color: #fff; padding: 6px 13px; border-radius: 8px; font-size: 12px; pointer-events: none; }
    .qh-pick { pointer-events: none; position: fixed; z-index: 2147483647; border: 2px solid #22c55e; background: rgba(34,197,94,.12); border-radius: 4px; display: none; }
    .qh-toast { pointer-events: none; position: fixed; left: 50%; bottom: 100px; transform: translateX(-50%); background: rgba(17,24,39,.94); color: #fff; padding: 7px 14px; border-radius: 8px; font-size: 12px; z-index: 2147483647; max-width: 70vw; }
  `;

  const PANEL_HTML = `
    <div class="qh-panel" hidden>
      <div class="qh-head">
        <div class="qh-title">题目助手 <span class="qh-badge">未配置</span></div>
        <button class="qh-x" title="收起">×</button>
      </div>
      <div class="qh-body">
        <textarea placeholder="选中的题目会自动出现在这里，也可以直接粘贴题目"></textarea>
        <div class="qh-actions">
          <button class="qh-chip" data-act="shot">截图识题</button>
          <button class="qh-chip" data-act="pick">点选取题</button>
          <button class="qh-chip" data-act="auto">自动抓题</button>
          <button class="qh-go" data-act="solve">解答</button>
        </div>
        <div class="qh-styles">
          <button data-style="answer">只要答案</button>
          <button data-style="brief">简要解析</button>
          <button data-style="detail">详细解答</button>
        </div>
        <div class="qh-answer"><div class="qh-empty">把题目放进上面的框，点「解答」。<br>支持文字题、选择题、图片题。</div></div>
        <div class="qh-foot">
          <span class="qh-status">待命</span>
          <span class="qh-spacer"></span>
          <button data-act="copy">复制</button>
          <button data-act="stop">停止</button>
          <button data-act="opts">设置</button>
        </div>
      </div>
    </div>
  `;

  const LAUNCHER_HTML = `<button class="qh-launcher" title="题目助手（Alt+Q 解选中题目）">题</button>`;

  /* ============================ 初始化 ============================ */
  init();

  async function init() {
    settings = await loadSettings();
    buildHost();
    if (IS_TOP) buildPanel();
    bindGlobal();
    reflectSettings();
  }

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DEFAULTS, (s) => resolve(Object.assign({}, DEFAULTS, s)));
      } catch (e) { resolve(Object.assign({}, DEFAULTS)); }
    });
  }

  function buildHost() {
    host = document.createElement('div');
    host.id = '__qh_host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    (document.body || document.documentElement).appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    const wrap = document.createElement('div');
    wrap.className = 'qh-wrap';
    root.appendChild(wrap);
    els.wrap = wrap;
  }

  function buildPanel() {
    els.wrap.insertAdjacentHTML('beforeend', LAUNCHER_HTML + PANEL_HTML);
    els.launcher = els.wrap.querySelector('.qh-launcher');
    els.panel = els.wrap.querySelector('.qh-panel');
    els.ta = els.wrap.querySelector('textarea');
    els.answer = els.wrap.querySelector('.qh-answer');
    els.status = els.wrap.querySelector('.qh-status');
    els.badge = els.wrap.querySelector('.qh-badge');
    els.go = els.wrap.querySelector('.qh-go');
    els.styles = Array.from(els.wrap.querySelectorAll('.qh-styles button'));

    els.launcher.addEventListener('click', () => {
      if (els.panel.hidden) openPanel();
      else els.panel.hidden = true;
    });
    els.wrap.querySelector('.qh-x').addEventListener('click', () => { els.panel.hidden = true; });

    els.panel.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const style = btn.getAttribute('data-style');
      if (style) { setStyle(style); return; }
      if (act === 'solve') { solveWith({ text: els.ta.value.trim() }); }
      else if (act === 'stop') { stopStream(); }
      else if (act === 'copy') { copyAnswer(); }
      else if (act === 'shot') { startShot(); }
      else if (act === 'pick') { startPick(); }
      else if (act === 'auto') { autoGrab(); }
      else if (act === 'opts') { send({ type: 'open-options' }).catch(() => {}); }
    });

    makeDraggable(els.wrap.querySelector('.qh-head'), els.panel);
  }

  function bindGlobal() {
    // 选中文字 → 出现「解题」小气泡
    document.addEventListener('mouseup', (e) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      setTimeout(() => {
        const sel = readSelection();
        if (!sel || sel.length < 4) { hideBubble(); return; }
        if (e.composedPath && e.composedPath().includes(host)) return;
        showBubble(sel);
      }, 12);
    }, true);

    document.addEventListener('mousedown', (e) => {
      if (e.composedPath && e.composedPath().includes(els.bubble || host)) return;
      hideBubble();
    }, true);

    window.addEventListener('scroll', hideBubble, true);
    window.addEventListener('resize', hideBubble, true);

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg) return;
      if (msg.type === 'open-panel') {
        if (IS_TOP) openPanel(msg.text || '');
        sendResponse({ ok: true });
      } else if (msg.type === 'command-solve') {
        jumpToSelection();
        sendResponse({ ok: true });
      } else if (msg.type === 'relay-answer') {
        if (IS_TOP && msg.text) { openPanel(msg.text); solveWith({ text: msg.text }); }
        sendResponse({ ok: true });
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      Object.keys(changes).forEach((k) => { settings[k] = changes[k].newValue; });
      reflectSettings();
    });
  }

  function reflectSettings() {
    if (!IS_TOP) return;
    const model = (settings.model || '').trim();
    els.badge.textContent = model ? model.split('/').pop() : '未选模型';
    els.badge.title = (settings.baseUrl || '') + '\n' + model;
    els.styles.forEach((b) => b.classList.toggle('on', b.getAttribute('data-style') === settings.style));
    if (!settings.apiKey && !isKeyless()) els.badge.textContent = '未填 Key';
  }

  /* ============================ 面板 ============================ */
  let welcomeShown = false;

  function openPanel(prefill) {
    if (!IS_TOP) return;
    els.panel.hidden = false;
    if (typeof prefill === 'string' && prefill) els.ta.value = prefill;
    if (!settings.apiKey && !isKeyless()) {
      els.answer.innerHTML = '<div class="qh-empty">还没有配置 API Key。<br>点右下角「设置」，选一个免费服务商（推荐智谱 glm-4v-flash，免费且支持图片），粘贴 Key 即可。</div>';
    } else if (isKeyless() && !welcomeShown && !rawAnswer) {
      welcomeShown = true;
      els.answer.innerHTML =
        '<div class="qh-empty">开箱即用，不需要填 Key。<br>' +
        '选中题目文字按 Alt+Q，或点「自动抓题」直接解答。<br>' +
        '<span style="color:#b45309">注意：免 Key 接口约 45 秒 1 次、不能读图。要做「截图识题」或更稳定，点「设置」换成免费的 glm-4v-flash。</span></div>';
    }
  }

  function setStatus(t) { if (els.status) els.status.textContent = t; }

  function setBusyUI(b) {
    els.go.disabled = b;
    els.go.textContent = b ? '解题中' : '解答';
  }

  function setStyle(style) {
    settings.style = style;
    els.styles.forEach((b) => b.classList.toggle('on', b.getAttribute('data-style') === style));
    chrome.storage.sync.set({ style });
  }

  /* ============================ 解题 ============================ */
  function solveWith({ text = '', image = null } = {}) {
    if (!IS_TOP) return;
    text = (text || '').trim();
    if (!text && !image) { toast('先选中题目、点选页面上的题目，或截图'); return; }

    if (image && isKeyless()) {
      els.panel.hidden = false;
      els.answer.innerHTML =
        '<div class="qh-err">当前是「免 Key 公共接口」，它不能读图。</div>' +
        '<div class="qh-hint">要看图解题，点右下角「设置」→ 服务商选「智谱 GLM（glm-4v-flash 免费，支持读图）」→ 填 Key（手机号注册即可）→ 保存。之后截图识题就能用了。</div>';
      setStatus('需要视觉模型');
      return;
    }

    if (!settings.apiKey && !isKeyless()) { openPanel(text); toast('还没填 API Key，点「设置」'); return; }

    stopStream(true);
    const requestId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    curReq = requestId;
    busy = true;
    rawAnswer = '';
    setBusyUI(true);
    setStatus(image && !text ? '识别截图中…' : '解答中…');
    els.answer.innerHTML = '<div class="qh-empty">正在解题…</div>';

    let port;
    try {
      port = chrome.runtime.connect({ name: 'solve' });
    } catch (e) {
      els.answer.innerHTML = '<div class="qh-err">插件与后台的连接中断，刷新页面后重试。</div>';
      finishSolve();
      return;
    }
    curPort = port;

    port.onMessage.addListener((m) => {
      if (!m || m.requestId !== curReq) return;
      if (m.type === 'delta') {
        rawAnswer += m.text;
        scheduleRender();
      } else if (m.type === 'done') {
        finishSolve();
      } else if (m.type === 'error') {
        showError(m.message || '未知错误');
        finishSolve();
      } else if (m.type === 'aborted') {
        if (!rawAnswer) els.answer.innerHTML = '<div class="qh-empty">已停止</div>';
        finishSolve();
      }
    });

    port.onDisconnect.addListener(() => {
      if (curReq === requestId) finishSolve();
    });

    port.postMessage({ type: 'start', requestId, payload: { text, image, style: settings.style } });
  }

  function finishSolve() {
    const hadText = !!rawAnswer;
    busy = false;
    curReq = null;
    setBusyUI(false);
    if (hadText) {
      renderNow();
      setStatus('完成 · ' + rawAnswer.length + ' 字');
    } else if (!els.answer.querySelector('.qh-err')) {
      setStatus('已结束');
    }
    const p = curPort;
    curPort = null;
    if (p) { try { p.disconnect(); } catch (e) { /* ignore */ } }
  }

  function stopStream(silent) {
    if (curPort) { try { curPort.postMessage({ type: 'stop' }); } catch (e) { /* ignore */ } }
    if (!silent && busy) setStatus('已停止');
    if (!silent) { busy = false; curReq = null; }
  }

  function hintFor(msg) {
    if (/输出长度|max_tokens|上限|范围/.test(msg)) {
      return '这个模型对单次输出有硬上限（glm-4v-flash 是 1024 tokens）。插件会自动按上限重试，若仍失败：到「设置」把「最大输出长度」改成 1024 或更小；想要长解析就换 glm-4-flash 或硅基流动的模型。';
    }
    if (/限速|FREE_LIMIT|429/.test(msg)) return '等 45 秒左右再点「解答」；或在「设置」里换成自己的免费 Key（不限速）。';
    if (/读图|image|视觉/.test(msg)) return '截图识题需要视觉模型：设置里选「智谱 GLM（glm-4v-flash）」或任何 *-VL-* 模型。';
    if (/Key|401|403|鉴权|令牌|未授权/.test(msg)) return '检查 Key 是否完整粘贴、是否已实名认证；可在「设置」里点「测试连接」定位。';
    if (/404|模型名|接口地址/.test(msg)) return '接口地址要填到 /v1 这一层（不带 /chat/completions），模型名要与平台列表一致。';
    if (/network|Failed to fetch|网络|timeout/i.test(msg)) return '网络不通：确认能访问该接口域名（Gemini/OpenRouter 需要能连外网），或换个服务商。';
    return '可在「设置」里点「测试连接」定位问题；面板里的原始报错已完整保留在上方。';
  }

  function showError(msg) {
    els.answer.innerHTML =
      '<div class="qh-err"><strong>出错了：</strong>' + esc(msg) + '</div>' +
      '<div class="qh-hint">' + esc(hintFor(msg)) + '</div>';
    setStatus('出错');
  }

  /* ============================ 渲染（轻量 Markdown） ============================ */
  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; renderNow(); });
  }

  function renderNow() {
    if (!els.answer) return;
    els.answer.innerHTML = mdToHtml(rawAnswer);
    els.answer.scrollTop = els.answer.scrollHeight;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function mdToHtml(src) {
    const codes = [];
    let s = String(src).replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, (m, code) => {
      codes.push(code.replace(/\n+$/, ''));
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });

    const out = s.split('\n').map((line) => {
      const raw = line;
      let l = esc(line);
      l = l.replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

      if (/^\s*$/.test(raw)) return '<div class="qh-gap"></div>';
      if (/^\u0000C\d+\u0000$/.test(raw)) return l;
      if (/^#{1,6}\s+/.test(raw)) return '<div class="qh-h">' + esc(raw.replace(/^#{1,6}\s+/, '')) + '</div>';
      if (/^\s*([-*•]|\d+[.)]|[（(]\d+[)）])\s*/.test(raw)) {
        return '<div class="qh-li">' + l.trim().replace(/^\s*([-*•]|\d+[.)]|[（(]\d+[)）])\s*/, '') + '</div>';
      }
      return '<div class="qh-ln">' + l + '</div>';
    }).join('');

    return out.replace(/\u0000C(\d+)\u0000/g, (m, i) => '<pre><code>' + esc(codes[+i]) + '</code></pre>');
  }

  async function copyAnswer() {
    const t = rawAnswer || (els.answer ? els.answer.innerText : '');
    if (!t.trim()) { toast('还没有答案'); return; }
    try {
      await navigator.clipboard.writeText(t);
      toast('已复制');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('已复制'); } catch (e2) { toast('复制失败，请手动选择'); }
      ta.remove();
    }
  }

  /* ============================ 选中小气泡 ============================ */
  function readSelection() {
    try {
      const s = window.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) return '';
      return String(s.toString()).replace(/[ \t]+/g, ' ').trim();
    } catch (e) { return ''; }
  }

  function ensureBubble() {
    if (els.bubble) return;
    els.bubble = document.createElement('button');
    els.bubble.className = 'qh-bubble';
    els.bubble.textContent = '解题';
    els.bubble.hidden = true;
    els.wrap.appendChild(els.bubble);
    els.bubble.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = els.bubble.__text || readSelection();
      hideBubble();
      if (!text) return;
      if (IS_TOP) {
        openPanel(text);
        solveWith({ text });
      } else {
        send({ type: 'relay-solve', text }).catch(() => {});
      }
    });
  }

  function showBubble(text) {
    ensureBubble();
    els.bubble.__text = text;
    els.bubble.hidden = false;
    let rect = null;
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) rect = sel.getRangeAt(0).getBoundingClientRect();
    } catch (e) { /* ignore */ }
    const x = rect && rect.width ? rect.right : lastPointer.x;
    const y = rect && rect.height ? rect.top : lastPointer.y;
    const top = Math.max(4, Math.min(window.innerHeight - 44, y - 36));
    const left = Math.max(4, Math.min(window.innerWidth - 70, x - 6));
    els.bubble.style.top = top + 'px';
    els.bubble.style.left = left + 'px';
  }

  function hideBubble() {
    if (els.bubble) els.bubble.hidden = true;
  }

  /* ============================ 截图识题 ============================ */
  async function startShot() {
    if (!IS_TOP) return;
    if (isKeyless()) {
      els.panel.hidden = false;
      els.answer.innerHTML =
        '<div class="qh-err">当前是「免 Key 公共接口」，它不能读图。</div>' +
        '<div class="qh-hint">点右下角「设置」→ 服务商选「智谱 GLM（glm-4v-flash 免费，支持读图）」→ 填 Key（手机号注册即可）→ 保存，就能用截图识题了。</div>';
      setStatus('需要视觉模型');
      toast('免 Key 接口不支持读图');
      return;
    }
    closePick();
    els.panel.hidden = true;
    els.launcher.hidden = true;
    hideBubble();
    await sleep(230);

    let resp = null;
    try { resp = await send({ type: 'capture' }); } catch (e) { resp = { error: e.message }; }
    els.launcher.hidden = false;

    if (!resp || !resp.dataUrl) {
      els.panel.hidden = false;
      toast('截图失败：' + ((resp && resp.error) || '请刷新页面后重试'));
      return;
    }
    els.ta.value = '';
    showShotLayer(resp.dataUrl);
  }

  function showShotLayer(dataUrl) {
    const layer = document.createElement('div');
    layer.className = 'qh-shot-layer';
    layer.innerHTML = '<div class="qh-shot-bg"></div><div class="qh-shot-rect" hidden></div><div class="qh-shot-tip">拖动框选题目区域 · Esc 取消</div>';
    layer.querySelector('.qh-shot-bg').style.backgroundImage = 'url("' + dataUrl + '")';
    els.wrap.appendChild(layer);
    const rectEl = layer.querySelector('.qh-shot-rect');

    let sx = 0, sy = 0, dragging = false, box = null;

    const paint = (e) => {
      const x = Math.min(sx, e.clientX);
      const y = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx);
      const h = Math.abs(e.clientY - sy);
      rectEl.style.left = x + 'px';
      rectEl.style.top = y + 'px';
      rectEl.style.width = w + 'px';
      rectEl.style.height = h + 'px';
      box = { x, y, w, h };
    };

    const onDown = (e) => {
      if (e.button !== 0) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      rectEl.hidden = false;
      paint(e);
      e.preventDefault();
    };
    const onMove = (e) => { if (dragging) paint(e); };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      cleanup();
      layer.remove();
      if (!box || box.w < 14 || box.h < 14) {
        els.panel.hidden = false;
        toast('框选太小了，再试一次');
        return;
      }
      cropAndSolve(dataUrl, box);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { cleanup(); layer.remove(); els.panel.hidden = false; }
    };
    const cleanup = () => {
      layer.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      document.removeEventListener('keydown', onKey, true);
    };

    layer.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    document.addEventListener('keydown', onKey, true);
  }

  function cropAndSolve(dataUrl, box) {
    loadImage(dataUrl).then((img) => {
      const scaleX = img.naturalWidth / Math.max(1, window.innerWidth);
      const scaleY = img.naturalHeight / Math.max(1, window.innerHeight);
      const canvas = document.createElement('canvas');
      const w = Math.max(1, Math.round(box.w * scaleX));
      const h = Math.max(1, Math.round(box.h * scaleY));
      const maxW = 1600;
      const ratio = w > maxW ? maxW / w : 1;
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, box.x * scaleX, box.y * scaleY, box.w * scaleX, box.h * scaleY, 0, 0, canvas.width, canvas.height);
      const out = canvas.toDataURL('image/jpeg', 0.92);
      els.panel.hidden = false;
      els.answer.innerHTML = '<div class="qh-empty">已截取题目图片，正在识别…</div>';
      solveWith({ text: els.ta.value.trim(), image: out });
    }).catch(() => {
      els.panel.hidden = false;
      toast('截图处理失败，请重试');
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /* ============================ 点选取题 ============================ */
  function startPick() {
    if (pickCleanup) { closePick(); return; }
    els.panel.hidden = true;
    hideBubble();

    const box = document.createElement('div');
    box.className = 'qh-pick';
    els.wrap.appendChild(box);

    let target = null;

    const onMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === host || (el.closest && el.closest('#__qh_host'))) return;
      target = el;
      const r = el.getBoundingClientRect();
      box.style.left = r.left + 'px';
      box.style.top = r.top + 'px';
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
      box.style.display = 'block';
    };

    const onClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      const el = target;
      const text = el ? cleanText(el.innerText || el.textContent || '') : '';
      closePick();
      if (!text) { els.panel.hidden = false; toast('这块区域没有文字，换个地方点'); return; }
      openPanel(text);
      solveWith({ text });
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { closePick(); els.panel.hidden = false; }
    };

    pickCleanup = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
      box.remove();
      pickCleanup = null;
    };

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    toast('移动鼠标高亮题目，点一下即解答 · Esc 取消');
  }

  function closePick() { if (pickCleanup) pickCleanup(); }

  /* ============================ 自动抓题 ============================ */
  function autoGrab() {
    const sel = readSelection();
    if (sel && sel.length >= 4) { openPanel(sel); solveWith({ text: sel }); return; }

    const text = guessQuestion();
    if (!text) {
      els.panel.hidden = false;
      toast('没找到明显的题目，试试「点选取题」或「截图识题」');
      return;
    }
    openPanel(text);
    solveWith({ text });
  }

  function guessQuestion() {
    const OPT = /(^|\n)\s*[（(]?\s*[A-DＡ-Ｄa-d]\s*[)）．.、:：]/g;
    const nodes = document.body ? document.body.querySelectorAll('div,section,article,main,form,li,p,td,table,label,fieldset') : [];
    let best = '', bestScore = 0;
    let scanned = 0;

    for (const el of nodes) {
      if (++scanned > 3500) break;
      if (!isVisible(el)) continue;
      const t = cleanText(el.innerText || '');
      if (t.length < 12 || t.length > 1600) continue;

      let score = 0;
      const opts = (t.match(OPT) || []).length;
      if (opts >= 2) score += 6 + Math.min(opts, 4);
      if (/[？?]/.test(t)) score += 5;
      if (/(选择题|多选题|单选题|判断题|填空题|简答题|计算题|下列|以下|正确的是|错误的是|请选择)/.test(t)) score += 3;
      if (/\d+\s*[.、．]\s*\S/.test(t)) score += 1;
      if (t.length >= 20 && t.length <= 420) score += 3;
      else if (t.length <= 900) score += 1;

      if (score > bestScore) { bestScore = score; best = t; }
    }
    return bestScore >= 6 ? best : '';
  }

  function isVisible(el) {
    try {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    } catch (e) { return false; }
  }

  function cleanText(t) {
    return String(t)
      .replace(/\r/g, '')
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/g, '')
      .slice(0, 1800);
  }

  /* ============================ 快捷入口 ============================ */
  function jumpToSelection() {
    const sel = readSelection();
    if (!IS_TOP) {
      if (sel) send({ type: 'relay-solve', text: sel }).catch(() => {});
      return;
    }
    if (sel && sel.length >= 2) {
      openPanel(sel);
      solveWith({ text: sel });
    } else {
      openPanel();
      toast('先选中页面上的题目文字，再按 Alt+Q');
    }
  }

  /* ============================ 小工具 ============================ */
  function makeDraggable(handle, panel) {
    let dragging = false, ox = 0, oy = 0;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = panel.getBoundingClientRect();
      panel.style.left = r.left + 'px';
      panel.style.top = r.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      dragging = true;
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const left = Math.max(-40, Math.min(window.innerWidth - 120, e.clientX - ox));
      const top = Math.max(0, Math.min(window.innerHeight - 70, e.clientY - oy));
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
    });
    handle.addEventListener('pointerup', () => { dragging = false; });
    handle.addEventListener('pointercancel', () => { dragging = false; });
  }

  let toastTimer = null;
  function toast(msg) {
    if (!els.wrap) return;
    if (!els.toast) {
      els.toast = document.createElement('div');
      els.toast.className = 'qh-toast';
      els.toast.hidden = true;
      els.wrap.appendChild(els.toast);
    }
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function send(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(resp);
        });
      } catch (e) { reject(e); }
    });
  }
})();
