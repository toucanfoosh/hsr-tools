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
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  window.HSRTools = { register, start, CDN, esc };
})();
