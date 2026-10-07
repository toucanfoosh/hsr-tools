// Site shell: a tiny tool registry + hash router. Each tool calls HSRTools.register().
(function () {
  const tools = [];
  const CDN = 'https://cdn.jsdelivr.net/gh/Mar-7th/StarRailRes@master/';

  function register(tool) { tools.push(tool); }

  function renderTabs(activeId) {
    const nav = document.getElementById('tool-tabs');
    nav.innerHTML = tools.map((t) =>
      `<a class="tab${t.id === activeId ? ' active' : ''}" href="#/${t.id}">${t.title}</a>`
    ).join('') + '<span class="tab tab-soon" title="More tools are on the way">More soon</span>';
  }

  function route() {
    const id = (location.hash.match(/^#\/([\w-]+)/) || [])[1];
    const tool = tools.find((t) => t.id === id) || tools[0];
    renderTabs(tool.id);
    const root = document.getElementById('tool-root');
    if (root.dataset.tool !== tool.id) {
      root.dataset.tool = tool.id;
      root.innerHTML = '';
      tool.mount(root);
    }
  }

  function start() {
    window.addEventListener('hashchange', route);
    route();
    initAccountUi();
    window.HSRAccount.init();
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------- modal helper
  // Opens the shared modal with `html`; returns { el, close }. Esc / backdrop click close it.
  function openModal(html, { onClose } = {}) {
    const modal = document.getElementById('modal');
    modal.hidden = false;
    modal.innerHTML = html;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const onBackdrop = (e) => { if (e.target === modal) close(); };
    function close() {
      modal.hidden = true;
      modal.innerHTML = '';
      modal.onclick = null;
      document.removeEventListener('keydown', onKey);
      modal.removeEventListener('mousedown', onBackdrop);
      if (onClose) onClose();
    }
    document.addEventListener('keydown', onKey);
    modal.addEventListener('mousedown', onBackdrop);
    return { el: modal, close };
  }

  // ---------------------------------------------------------------- account (Reliquary Archiver)
  const ago = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(t).toLocaleDateString();
  };
  const STATUS_TEXT = {
    connected: 'Archiver connected',
    searching: 'Looking for archiver…',
    offline: 'Archiver not running',
    idle: 'Auto-connect off',
  };

  function initAccountUi() {
    const chip = document.getElementById('account-chip');
    const A = window.HSRAccount;
    const draw = () => {
      const acc = A.data;
      const st = A.status;
      chip.dataset.status = st;
      chip.innerHTML = `<span class="dot"></span><span class="acct-text">${
        acc ? `<b>${acc.export.metadata && acc.export.metadata.uid ? `UID ${acc.export.metadata.uid}` : 'Account loaded'}</b> · ${st === 'connected' ? 'live' : `saved ${ago(acc.updatedAt)}`}`
          : STATUS_TEXT[st] || 'Connect account'}</span>`;
      chip.title = acc ? `${STATUS_TEXT[st] || ''}. Click for details.` : 'Load your characters from Reliquary Archiver';
      if (openAccount.refresh) openAccount.refresh();
    };
    A.onChange(draw);
    chip.onclick = openAccount;
    setInterval(draw, 60000);
    draw();
  }

  function openAccount() {
    const A = window.HSRAccount;
    const m = openModal('<div class="card modal-box account-box" role="dialog" aria-label="Account"></div>', {
      onClose: () => { openAccount.refresh = null; },
    });
    const box = m.el.querySelector('.account-box');
    const render = () => {
      const acc = A.data;
      const s = A.settings();
      const exp = acc && acc.export;
      box.innerHTML = `
        <div class="modal-head"><div class="top"><h3>Your account</h3><button class="btn ghost" data-close>Close</button></div></div>
        <div class="account-body">
          <div class="acct-status" data-status="${A.status}"><span class="dot"></span>${STATUS_TEXT[A.status]}${A.status !== 'connected' && s.auto ? ` <span class="muted small">(ws://${esc(s.host)}:${s.port}, retrying in the background)</span>` : ''}</div>
          ${exp ? `
            <div class="acct-stats">
              <div><b>${exp.metadata && exp.metadata.uid ? exp.metadata.uid : '–'}</b><span>UID</span></div>
              <div><b>${exp.characters.length}</b><span>Characters</span></div>
              <div><b>${exp.light_cones.length}</b><span>Light cones</span></div>
              <div><b>${exp.relics.length}</b><span>Relics</span></div>
            </div>
            <p class="muted small">Updated ${ago(acc.updatedAt)} from ${acc.source === 'file' ? 'an imported file' : 'Reliquary Archiver'}. Saved in this browser, so it's still here next time.
              Picking one of your characters fills in their eidolon, light cone, relic sets and SPD.</p>`
          : `<p class="muted">No account loaded yet. Once you load one, picking a character fills in your eidolons, light cones, relics and SPD.</p>`}
          <h4>Connect Reliquary Archiver</h4>
          <ol class="steps">
            <li>On the PC you play on, download and run <a href="https://github.com/IceDynamix/reliquary-archiver/releases/latest" target="_blank" rel="noopener">Reliquary Archiver</a> (Windows or Linux).</li>
            <li>Start Honkai: Star Rail and log in. If you're already in game, go back to the login screen and log in again so the archiver can see your data.</li>
            <li>Keep this page open. It connects to the archiver's live server by itself and updates whenever your gear changes.</li>
          </ol>
          <div class="row acct-settings">
            <label class="field"><span>Host</span><input type="text" data-set="host" value="${esc(s.host)}" placeholder="localhost"></label>
            <label class="field"><span>Port</span><input type="number" data-set="port" value="${s.port}"></label>
            <label class="check"><input type="checkbox" data-set="auto" ${s.auto ? 'checked' : ''}> Auto-connect</label>
            <button class="btn" data-reconnect>Reconnect</button>
          </div>
          <p class="muted small">Running the archiver on another computer? Enter that PC's local IP (e.g. 192.168.1.20) as the host.</p>
          <h4>Or import a file</h4>
          <div class="acct-file">
            <label class="btn">Import archiver JSON…<input type="file" accept=".json,application/json" data-file hidden></label>
            ${exp ? '<button class="btn ghost danger" data-clear>Forget saved account</button>' : ''}
          </div>
          <div class="warn" data-err></div>
        </div>`;
    };
    openAccount.refresh = render;
    render();
    box.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) return m.close();
      if (e.target.closest('[data-reconnect]')) return A.connect();
      if (e.target.closest('[data-clear]') && confirm('Forget the saved account data in this browser?')) await A.clear();
    });
    box.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.dataset.file !== undefined && t.files[0]) {
        try { await A.importFile(t.files[0]); } catch (err) { box.querySelector('[data-err]').textContent = `Couldn't import: ${err.message}`; }
        return;
      }
      if (t.dataset.set === 'auto') A.saveSettings({ auto: t.checked });
      else if (t.dataset.set === 'host') A.saveSettings({ host: t.value.trim() || 'localhost' });
      else if (t.dataset.set === 'port') A.saveSettings({ port: +t.value || 23313 });
    });
  }

  window.HSRTools = { register, start, CDN, esc, openModal, openAccount };
})();
