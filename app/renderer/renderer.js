// WorkBuddy 注入工具 —— 渲染进程逻辑
// 标签切换、主题切换、检查结果渲染、启动/刷新/复制操作
'use strict';

(function () {
  const $ = (sel) => document.querySelector(sel);

  // 状态 → 视觉映射
  const STATUS_MAP = {
    ok: { dot: 'dot-ok', pill: 'status-ok', ring: 'var(--ok)', text: 'var(--ok-text)', label: '正常' },
    warn: { dot: 'dot-warn', pill: 'status-warn', ring: 'var(--warn)', text: 'var(--warn-text)', label: '提示' },
    bad: { dot: 'dot-bad', pill: 'status-bad', ring: 'var(--bad)', text: 'var(--bad-text)', label: '异常' }
  };

  let lastStatus = null;

  // ── Toast ─────────────────────────────────────────────
  let toastTimer = null;
  function showToast(msg) {
    $('#toast-text').textContent = msg;
    $('#toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2400);
  }

  // ── 标签切换 ───────────────────────────────────────────
  const labels = {
    overview: { title: '概览', sub: '运行条件检查与启动' },
    about: { title: '关于', sub: '工具介绍' }
  };
  function setTab(id) {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === id));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === id));
    $('#appbar-title').textContent = labels[id].title;
    $('#appbar-sub').textContent = labels[id].sub;
    try { localStorage.setItem('wb-tab', id); } catch (_) {}
  }
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => setTab(b.getAttribute('data-tab'))));
  try {
    const saved = localStorage.getItem('wb-tab');
    if (saved && document.getElementById(saved)) setTab(saved);
  } catch (_) {}

  // ── 主题切换 ───────────────────────────────────────────
  function currentTheme() {
    let saved = null;
    try { saved = localStorage.getItem('wb-theme'); } catch (_) {}
    if (saved === 'light' || saved === 'dark') return saved;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  function applyTheme() {
    const dark = currentTheme() === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    $('.icon-moon').style.display = dark ? 'none' : '';
    $('.icon-sun').style.display = dark ? '' : 'none';
    $('#theme-toggle').setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
  }
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    try { localStorage.setItem('wb-theme', next); } catch (_) {}
    applyTheme();
  });
  applyTheme();

  // ── 渲染 ──────────────────────────────────────────────
  function render(status) {
    lastStatus = status;
    const map = STATUS_MAP[status.overall] || STATUS_MAP.ok;
    const ratio = status.checksTotal > 0 ? status.checksPassed / status.checksTotal : 0;

    // 健康圆环
    $('#ring-fill').style.stroke = map.ring;
    $('#ring-fill').style.strokeDashoffset = String(327 * (1 - ratio));
    $('#ring-label').textContent = map.label;
    $('#ring-label').style.color = map.text;

    // hero 状态
    const heroDot = $('#hero-dot');
    heroDot.className = 'dot ' + map.dot + (status.overall === 'ok' ? ' live' : '');
    $('#hero-status').textContent = status.overall === 'ok' ? '运行条件就绪' : status.overall === 'warn' ? '部分条件需注意' : '运行条件未就绪';
    $('#hero-title').textContent = status.overall === 'ok' ? '所有检查均已通过' : status.overall === 'warn' ? '存在提示项，建议处理' : '存在异常项，需要处理';
    $('#hero-lead').textContent = status.overall === 'ok'
      ? 'WorkBuddy 与注入脚本均就绪，可点击「启动 WorkBuddy」带注入启动。'
      : '请根据下方标注的异常项排查后重试。';

    // metrics
    $('#metric-version').textContent = 'v' + status.version;
    $('#metric-checks').textContent = status.checksPassed + '/' + status.checksTotal;
    $('#metric-scripts').textContent = status.scriptsAvailable + '/' + status.scriptsTotal;

    // 顶栏 chip
    const appbarDot = $('#appbar-dot');
    appbarDot.className = 'dot ' + map.dot;
    $('#appbar-chip').textContent = status.overall === 'ok' ? '条件就绪' : status.overall === 'warn' ? '有提示项' : '有异常项';

    // 健康检查项网格
    const grid = $('#health-grid');
    grid.innerHTML = '';
    status.healthItems.forEach((item) => {
      const m = STATUS_MAP[item.status] || STATUS_MAP.ok;
      const cell = document.createElement('div');
      cell.className = 'card health-item';
      const valueCls = item.valueType === 'number' ? 'health-value num' : 'health-value';
      cell.innerHTML = '<div class="top"><span class="meta"></span><span class="dot ' + m.dot + '" aria-hidden="true"></span></div>' +
        '<div class="' + valueCls + '"></div>' +
        '<p class="health-note"></p>';
      cell.querySelector('.meta').textContent = item.label;
      cell.querySelector('.health-value').textContent = item.value;
      cell.querySelector('.health-note').textContent = item.note;
      grid.appendChild(cell);
    });

    // 脚本表
    const tbody = $('#script-tbody');
    tbody.innerHTML = '';
    status.scripts.forEach((s) => {
      const m = STATUS_MAP[s.status] || STATUS_MAP.ok;
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="script-name"></td><td class="script-desc"></td>' +
        '<td><span class="status-pill ' + m.pill + '"><span class="dot ' + m.dot + '" aria-hidden="true"></span><span></span></span></td>';
      tr.querySelector('.script-name').textContent = s.name;
      tr.querySelector('.script-desc').textContent = s.purpose;
      const pillSpan = tr.querySelector('.status-pill span:last-child');
      pillSpan.textContent = s.statusLabel || (s.status === 'ok' ? '可用' : s.status === 'warn' ? '受限' : '缺失');
      tbody.appendChild(tr);
    });

    // 脚本计数
    const scriptDot = $('#script-dot');
    scriptDot.className = 'dot ' + (status.scriptsAvailable === status.scriptsTotal ? 'dot-ok' : status.scriptsAvailable === 0 ? 'dot-bad' : 'dot-warn');
    $('#script-count-text').textContent = status.scriptsAvailable + '/' + status.scriptsTotal + ' 可用';

    // 部署按钮：有缺失时强调「部署脚本」，否则是「重新部署」
    const deployLabel = $('#deploy-hooks .btn-label');
    if (deployLabel) {
      const missing = status.scriptsAvailable < status.scriptsTotal;
      deployLabel.textContent = missing ? '部署脚本' : '重新部署';
      $('#deploy-hooks').classList.toggle('btn-primary', missing);
      $('#deploy-hooks').classList.toggle('btn-secondary', !missing);
    }
  }

  // ── 检查 + 渲染 ────────────────────────────────────────
  async function refresh() {
    try {
      const status = await window.api.checkStatus();
      render(status);
      return status;
    } catch (e) {
      showToast('检查失败：' + (e && e.message || e));
      return null;
    }
  }

  // ── 启动 WorkBuddy ─────────────────────────────────────
  async function startWorkbuddy() {
    const btn = $('#start-workbuddy');
    btn.classList.add('is-busy');
    btn.disabled = true;
    try {
      const r = await window.api.startWorkbuddy();
      if (r && r.ok) {
        showToast(r.message || '已触发启动');
      } else {
        showToast('启动失败：' + ((r && r.error) || '未知错误'));
      }
    } catch (e) {
      showToast('启动失败：' + (e && e.message || e));
    }
    // 启动后稍等再刷新状态（脚本会退出+重启 WorkBuddy）
    setTimeout(() => {
      btn.classList.remove('is-busy');
      btn.disabled = false;
      refresh();
    }, 1500);
  }

  // ── 复制诊断报告 ───────────────────────────────────────
  function buildReport() {
    if (!lastStatus) return '';
    const lines = [
      'Workbuddy Plus 诊断报告',
      '生成时间：' + new Date().toLocaleString('zh-CN'),
      '',
      '[运行条件]',
      '- 总体状态：' + (lastStatus.overall === 'ok' ? '正常' : lastStatus.overall === 'warn' ? '提示' : '异常'),
      '- WorkBuddy 版本：v' + lastStatus.version,
      '- WorkBuddy 路径：' + lastStatus.wbPath,
      '- 运行状态：' + (lastStatus.running ? '运行中' : '未运行')
    ];
    lastStatus.healthItems.forEach((h) => {
      lines.push('- ' + h.label + '：' + h.value + '（' + h.note + '）');
    });
    lines.push('', '[注入脚本] ' + lastStatus.scriptsAvailable + '/' + lastStatus.scriptsTotal + ' 可用');
    lastStatus.scripts.forEach((s) => {
      lines.push('- ' + s.name + '  ' + s.purpose + '  ' + (s.statusLabel || s.status));
    });
    return lines.join('\n');
  }

  $('#copy-report').addEventListener('click', () => {
    const text = buildReport();
    const done = () => showToast('已复制到剪贴板');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      done();
    }
  });

  $('#refresh-health').addEventListener('click', () => {
    const btn = $('#refresh-health');
    btn.classList.add('is-busy');
    refresh().finally(() => {
      btn.classList.remove('is-busy');
      showToast('状态已刷新');
    });
  });

  // ── 部署注入脚本 ───────────────────────────────────────
  async function deployHooks() {
    const btn = $('#deploy-hooks');
    btn.classList.add('is-busy');
    btn.disabled = true;
    try {
      const r = await window.api.deployHooks();
      if (r && r.ok) {
        const parts = [];
        if (r.deployed.length) parts.push('新增 ' + r.deployed.length + ' 个');
        if (r.updated.length) parts.push('更新 ' + r.updated.length + ' 个');
        if (r.fixed && r.fixed.length) parts.push('修正权限 ' + r.fixed.length + ' 个');
        showToast('脚本部署完成：' + (parts.length ? parts.join('，') : '已是最新'));
      } else {
        showToast('部署失败：' + ((r && r.errors && r.errors[0]) || (r && r.error) || '未知错误'));
      }
    } catch (e) {
      showToast('部署失败：' + (e && e.message || e));
    }
    await refresh();
    btn.classList.remove('is-busy');
    btn.disabled = false;
  }
  $('#deploy-hooks').addEventListener('click', deployHooks);

  $('#start-workbuddy').addEventListener('click', startWorkbuddy);

  // 初始加载：先检查一次；若结果异常（可能是 WorkBuddy 重启中的 transient 误报），延迟自动重试一次确认
  (async function initialLoad() {
    const status = await refresh();
    if (status && status.overall !== 'ok') {
      setTimeout(() => { refresh(); }, 2000);
    }
  })();
})();
