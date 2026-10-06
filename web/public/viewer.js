/* Public reads only: no stored credentials, HTML injection or private-share bypass. */
(() => {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const api = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://127.0.0.1:3300' : 'https://api.tardy.news';
  const el = (name) => document.getElementById(name);
  function safeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try { const url = new URL(value, location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
  }
  function render(post) {
    el('title').textContent = 'A Tardy worth sharing';
    el('caption').textContent = post.caption || '';
    el('status').textContent = '';
    document.title = `${(post.caption || 'Tardy').slice(0, 60)} · Tardy`;
    for (const media of post.media || []) {
      const url = safeUrl(media.url);
      if (!url || !['video', 'image'].includes(media.type)) continue;
      const node = document.createElement(media.type === 'video' ? 'video' : 'img');
      node.src = url;
      if (media.type === 'video') { node.controls = true; node.playsInline = true; node.preload = 'metadata'; const poster = safeUrl(media.poster_url); if (media.poster_url && poster) node.poster = poster; }
      else { node.alt = 'Tardy carousel image'; node.loading = 'lazy'; }
      node.addEventListener('error', () => { el('status').textContent = 'Media could not load. Reload to refresh its playback link.'; });
      el('player').append(node);
    }
    for (const link of post.links || []) {
      const url = safeUrl(typeof link === 'string' ? link : link.url);
      if (!url) continue;
      const node = document.createElement('a'); node.href = url; node.textContent = 'Original source ↗'; node.target = '_blank'; node.rel = 'noopener noreferrer'; el('sources').append(node);
    }
    el('share').hidden = false;
    el('share').onclick = async () => {
      const url = id ? `${location.origin}/t/${id}` : `${location.origin}/viewer.html?demo=1`;
      try { if (navigator.share) await navigator.share({ title: 'Tardy', url }); else { await navigator.clipboard.writeText(url); el('status').textContent = 'Link copied.'; } }
      catch (error) { if (error.name !== 'AbortError') el('status').textContent = 'Could not share. Copy the address from your browser.'; }
    };
  }
  if (params.get('demo') === '1' && !id) {
    el('label').textContent = 'DEMO · SAMPLE REEL';
    render({caption:'Clankercast: agents are shipping. Don’t be late.\n\nThis is a bundled demo, not a live backend post.',media:[{type:'video',url:'/app/clankercast.mp4',poster_url:'/app/clankercast.jpg'}]});
    return;
  }
  if (!uuid.test(id || '')) { el('title').textContent = 'That link isn’t valid.'; el('status').textContent = 'Ask your friend for a Tardy share link.'; return; }
  el('open').href = `tardy://posts/${id}`;
  (async () => {
    try {
      const response = await fetch(`${api}/v1/public/posts/${id}`, {credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(12000)});
      if (response.status === 404 || response.status === 403) { el('title').textContent = 'This Tardy isn’t available publicly.'; el('status').textContent = 'It may be private or removed. Open it in the app with the account it was shared with.'; return; }
      if (!response.ok) throw new Error('server unavailable');
      const post = await response.json(); render(post);
      const author = await fetch(`${api}/v1/profiles/by-id/${post.author_id}`, {credentials:'omit',signal:AbortSignal.timeout(8000)});
      if (author.ok) { const profile = await author.json(); el('title').textContent = `${profile.display_name} · @${profile.handle}`; }
    } catch { el('status').textContent = 'Tardy couldn’t connect right now. Reload to try again, or open in the app.'; if (!el('caption').textContent) el('title').textContent = 'Temporarily unavailable'; }
  })();
})();
