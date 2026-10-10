(() => {
  const $ = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => [...el.querySelectorAll(s)];

  const state = {
    index: [],
    day: null,
    date: null,
    previewOn: localStorage.getItem('vfx_preview') !== '0',
    model: '全部',
    q: '',
    sort: 'heat',
    current: null,
    observer: null,
  };

  const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n);

  async function loadIndex() {
    const r = await fetch('data/index.json');
    state.index = await r.json();
    renderDates();
    const params = new URLSearchParams(location.search);
    const hash = location.hash.replace(/^#/, '');
    let date = params.get('date') || (hash.startsWith('date=') ? hash.slice(5) : null);
    if (!date && state.index.length) date = state.index[0].date;
    if (date) await loadDay(date);
  }

  function renderDates() {
    const box = $('#dateList');
    box.innerHTML = state.index.map(d => `
      <button class="date-btn ${d.date===state.date?'active':''}" data-date="${d.date}">
        <div class="d">${d.date}</div>
        <div class="m">${d.count} 条 · ${fmt(d.total_views)} 浏览</div>
      </button>`).join('');
    $$('.date-btn', box).forEach(b => b.onclick = () => loadDay(b.dataset.date));
  }

  async function loadDay(date) {
    state.date = date;
    history.replaceState(null, '', `?date=${date}`);
    renderDates();
    const r = await fetch(`data/${date}.json`);
    state.day = await r.json();
    $('#title').textContent = `X AI 顶级视效日报 · ${date}`;
    $('#subtitle').textContent = `${state.day.window} · 生成于 ${state.day.generated_at}（北京时间）`;
    const models = new Map();
    state.day.items.forEach(it => (it.models||[]).forEach(m => models.set(m, (models.get(m)||0)+1)));
    const sel = $('#modelFilter');
    const cur = state.model;
    sel.innerHTML = '<option value="全部">全部模型</option>' +
      [...models.entries()].sort((a,b)=>b[1]-a[1]).map(([m,c]) => `<option value="${m}">${m} (${c})</option>`).join('');
    sel.value = [...sel.options].some(o=>o.value===cur) ? cur : '全部';
    state.model = sel.value;
    renderStats();
    renderGrid();
    setupPreviewObserver();
  }

  function renderStats() {
    const items = filtered();
    const likes = items.reduce((s,i)=>s+i.metrics.likes,0);
    const views = items.reduce((s,i)=>s+i.metrics.views,0);
    $('#stats').innerHTML = `
      <div class="stat"><b>${items.length}</b><span>入选</span></div>
      <div class="stat"><b>${fmt(likes)}</b><span>总点赞</span></div>
      <div class="stat"><b>${fmt(views)}</b><span>总浏览</span></div>
      <div class="stat"><b>${items.filter(i=>i.prompt).length}</b><span>公开提示词</span></div>`;
  }

  function filtered() {
    let items = [...(state.day?.items||[])];
    if (state.model !== '全部') items = items.filter(i => (i.models||[]).includes(state.model));
    if (state.q) {
      const q = state.q.toLowerCase();
      items = items.filter(i =>
        (i.title+i.visual_summary+i.author_handle+(i.models||[]).join(' ')+(i.prompt||'')).toLowerCase().includes(q)
      );
    }
    const key = {
      heat: i => -i.heat_score,
      views: i => -i.metrics.views,
      likes: i => -i.metrics.likes,
      time: i => -Date.parse(i.created_at_bj.replace(' ','T')+'+08:00'),
    }[state.sort];
    items.sort((a,b)=> key(a)-key(b) || a.rank-b.rank);
    return items;
  }

  function renderGrid() {
    const items = filtered();
    const grid = $('#grid');
    if (!items.length) { grid.innerHTML = '<div class="empty">没有匹配内容</div>'; return; }
    grid.innerHTML = items.map(it => {
      const cover = it.cover_local || it.cover_url || '';
      const preview = it.preview_local || it.mp4_preview_url || it.mp4_url || '';
      return `<article class="card" data-id="${it.id}">
        <div class="media" data-open="${it.id}">
          <img class="cover" src="${cover}" alt="" loading="lazy"/>
          <video class="preview" muted loop playsinline preload="none" data-src="${preview}" poster="${cover}"></video>
          <div class="rank">#${it.rank}</div>
          <div class="dur">${it.duration_s||'?'}s</div>
          <div class="playhint"><span>▶</span></div>
        </div>
        <div class="body">
          <h3>${escapeHtml(it.title)}</h3>
          <div class="meta"><span>${escapeHtml(it.author_handle)}</span><span>${it.created_at_bj}</span><span>热度 ${it.heat_score}</span></div>
          <div class="chips">${(it.models||[]).map(m=>`<span class="chip">${escapeHtml(m)}</span>`).join('')}</div>
          <div class="metrics">
            <span>❤ <b>${fmt(it.metrics.likes)}</b></span>
            <span>↻ <b>${fmt(it.metrics.reposts)}</b></span>
            <span>👁 <b>${fmt(it.metrics.views)}</b></span>
          </div>
        </div>
      </article>`;
    }).join('');
    $$('.media', grid).forEach(m => m.onclick = () => openModal(m.dataset.open));
    applyPreviewMode();
    setupPreviewObserver();
  }

  function escapeHtml(s) {
    return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function applyPreviewMode() {
    const on = state.previewOn;
    $('#previewToggle').className = 'toggle ' + (on ? 'on' : 'off');
    $('#previewToggle').textContent = on ? '预览：开' : '预览：关';
    $$('.card .preview').forEach(v => {
      if (!on) { v.pause(); v.removeAttribute('src'); v.load?.(); v.style.display='none'; }
      else { v.style.display='block'; }
    });
    $$('.card .cover').forEach(img => { img.style.display = on ? 'none' : 'block'; });
    // when on, cover hidden only after video can play — keep cover until playing
    if (on) {
      $$('.card').forEach(card => {
        const img = $('.cover', card); const v = $('.preview', card);
        img.style.display = 'block';
        v.style.display = 'block';
        v.style.opacity = '0';
        v.style.position = 'absolute'; v.style.inset='0';
        img.style.position='absolute'; img.style.inset='0'; img.style.width='100%'; img.style.height='100%'; img.style.objectFit='cover';
      });
    }
  }

  function setupPreviewObserver() {
    state.observer?.disconnect();
    if (!state.previewOn) return;
    state.observer = new IntersectionObserver(entries => {
      entries.forEach(en => {
        const card = en.target;
        const v = $('.preview', card);
        const img = $('.cover', card);
        if (!v) return;
        if (en.isIntersecting && state.previewOn) {
          if (!v.getAttribute('src')) {
            const src = v.dataset.src;
            if (src) { v.src = src; }
          }
          v.play().then(() => { v.style.opacity='1'; if(img) img.style.opacity='0'; }).catch(()=>{});
        } else {
          v.pause();
        }
      });
    }, { threshold: 0.55 });
    $$('.card').forEach(c => state.observer.observe(c));
  }

  function openModal(id) {
    const it = state.day.items.find(x => x.id === id);
    if (!it) return;
    state.current = it;
    // pause previews
    $$('.preview').forEach(v => v.pause());
    $('#modalTitle').textContent = it.title;
    const full = it.mp4_url || it.mp4_preview_url || it.preview_local;
    const player = $('#modalPlayer');
    player.src = full;
    player.poster = it.cover_local || it.cover_url || '';
    player.load();
    player.play().catch(()=>{});
    $('#modalMeta').innerHTML = `
      <div class="meta" style="margin:0 0 8px">${escapeHtml(it.author_handle)} · ${it.created_at_bj} · 热度 ${it.heat_score}</div>
      <div class="chips">${(it.models||[]).map(m=>`<span class="chip">${escapeHtml(m)}</span>`).join('')}</div>
      <div class="metrics" style="margin-top:8px">
        <span>❤ <b>${fmt(it.metrics.likes)}</b></span>
        <span>↻ <b>${fmt(it.metrics.reposts)}</b></span>
        <span>💬 <b>${fmt(it.metrics.quotes)}</b></span>
        <span>🔖 <b>${fmt(it.metrics.bookmarks)}</b></span>
        <span>👁 <b>${fmt(it.metrics.views)}</b></span>
      </div>`;
    $('#modalVisual').textContent = it.visual_summary || '';
    $('#modalPromptStatus').textContent = it.prompt_status || (it.prompt ? '已公开' : '未公开');
    const pre = $('#modalPrompt');
    pre.textContent = it.prompt || '未公开';
    $('#copyPrompt').disabled = !it.prompt;
    $('#openX').href = it.post_url;
    $('#modal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    $('#modal').classList.remove('open');
    const player = $('#modalPlayer');
    player.pause(); player.removeAttribute('src'); player.load();
    document.body.style.overflow = '';
    if (state.previewOn) setupPreviewObserver();
  }

  $('#previewToggle').onclick = () => {
    state.previewOn = !state.previewOn;
    localStorage.setItem('vfx_preview', state.previewOn ? '1' : '0');
    applyPreviewMode();
    setupPreviewObserver();
  };
  $('#modelFilter').onchange = e => { state.model = e.target.value; renderStats(); renderGrid(); };
  $('#sortFilter').onchange = e => { state.sort = e.target.value; renderGrid(); };
  $('#search').oninput = e => { state.q = e.target.value.trim(); renderStats(); renderGrid(); };
  $('#modalClose').onclick = closeModal;
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  $('#copyPrompt').onclick = async () => {
    if (!state.current?.prompt) return;
    await navigator.clipboard.writeText(state.current.prompt);
    const b = $('#copyPrompt'); const t = b.textContent; b.textContent = '已复制';
    setTimeout(()=>b.textContent=t, 1200);
  };

  loadIndex();
})();
