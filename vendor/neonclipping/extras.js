// NeonClipping extras: style panel, caption animation, SRT/ASS import, facecam finder, AI parts.
// Loaded after app.js. It only adds to the page and wraps request()/exportSettings()/openSavedClip(); app.js stays as it is.
(function () {
  const $ = id => document.getElementById(id);
  const STYLE_KEYS = ['template', 'tpl_name', 'tpl_handle', 'bg_mode', 'bg_color', 'bg_color2', 'bg_image', 'bg_dim', 'bg_blur', 'padding', 'radius',
    'watermark_image', 'watermark_pos', 'watermark_size', 'watermark_opacity', 'credit', 'outro_text', 'outro_seconds',
    'music', 'music_volume', 'music_peak', 'music_riser', 'caption_anim',
    'caption_font','caption_size','caption_color','caption_active','caption_outline','caption_max_words','hook_duration','hook_background','hook_enabled','fade_inout','hook_style','cam_contrast','cam_brightness','cam_saturation','cam_clarity'];
  const BRAND_KEYS=['caption_font','caption_size','caption_color','caption_active','caption_outline','caption_max_words'];
  const assets = { bg_image: '', watermark_image: '', music: '' };

  // ---- reading / writing the style fields
  function raw() {
    const v = {
      template: $('st-template').value, tpl_name: $('st-tpl-name').value.trim(), tpl_handle: $('st-tpl-handle').value.trim(),
      bg_mode: $('st-bg-mode').value === 'none' ? '' : $('st-bg-mode').value, bg_color: $('st-bg-color').value, bg_color2: $('st-bg-color2').value,
      bg_image: assets.bg_image, bg_dim: Number($('st-bg-dim').value) / 100, padding: Number($('st-padding').value), radius: Number($('st-radius').value),
      watermark_image: assets.watermark_image, watermark_pos: $('st-wm-pos').value, watermark_size: Number($('st-wm-size').value),
      watermark_opacity: Number($('st-wm-opacity').value) / 100, credit: $('st-credit').value.trim(), outro_text: $('st-outro').value.trim(),
      outro_seconds: Number($('st-outro-sec').value), music: assets.music, music_volume: Number($('st-music-vol').value) / 100,
      music_peak: Number($('st-music-peak').value) / 100, music_riser: Number($('st-music-riser').value),
      caption_anim: $('caption-anim') ? $('caption-anim').value : 'highlight'
    };
    return v;
  }
  // only what is switched on (Make / export), so plain exports stay exactly as before
  function styleFields() {
    const v = raw(), o = {};
    if (v.template !== 'none') { o.template = v.template; o.tpl_name = v.tpl_name; o.tpl_handle = v.tpl_handle; }
    if (v.bg_mode) { o.bg_mode = v.bg_mode; o.bg_color = v.bg_color; o.bg_color2 = v.bg_color2; o.bg_dim = v.bg_dim; if (v.bg_mode === 'image' && v.bg_image) o.bg_image = v.bg_image; }
    if (v.padding > 0) { o.padding = v.padding; o.radius = v.radius; } else if (v.radius > 0 && v.bg_mode) { o.radius = v.radius; }
    if (v.watermark_image) { o.watermark_image = v.watermark_image; o.watermark_pos = v.watermark_pos; o.watermark_size = v.watermark_size; o.watermark_opacity = v.watermark_opacity; }
    if (v.credit) o.credit = v.credit;
    if (v.outro_text) { o.outro_text = v.outro_text; o.outro_seconds = v.outro_seconds; }
    if (v.music) { o.music = v.music; o.music_volume = v.music_volume; o.music_peak = v.music_peak; o.music_riser = v.music_riser; }
    if (v.caption_anim && v.caption_anim !== 'highlight') o.caption_anim = v.caption_anim;
    for(const key of BRAND_KEYS){const value=$('brand-'+key)?.value;if(value)o[key]=['caption_size','caption_max_words'].includes(key)?Number(value):value;}
    o.hook_duration=Number($('hook-duration')?.value||8);o.hook_background=$('hook-background')?.checked!==false;o.hook_enabled=$('hook-enabled')?.checked!==false;o.fade_inout=!!$('fade-inout')?.checked;o.hook_style=$('hook-style')?.value||'impact';['contrast','brightness','saturation','clarity'].forEach(k=>{const el=$('cam-'+k);if(el)o['cam_'+k]=Number(el.value);});
    return o;
  }
  // every key, '' when off: used when editing saved clips so a switched-off option really turns off
  function styleState() {
    const on = styleFields(), s = {};
    for (const k of STYLE_KEYS) s[k] = on[k] === undefined ? (k === 'template' ? 'none' : k === 'caption_anim' ? 'highlight' : '') : on[k];
    return s;
  }
  function setRange(id, outId, value, scale) { if ($(id)) $(id).value = value; if ($(outId)) $(outId).textContent = Math.round(Number($(id).value) * (scale || 1)); }
  function loadStyleFields(s) {
    s = s || {};
    $('st-template').value = s.template || 'none'; $('st-tpl-name').value = s.tpl_name || ''; $('st-tpl-handle').value = s.tpl_handle || '';
    $('st-bg-mode').value = s.bg_mode || 'none'; if (s.bg_color) $('st-bg-color').value = s.bg_color; if (s.bg_color2) $('st-bg-color2').value = s.bg_color2;
    setRange('st-padding', 'st-padding-o', s.padding || 0); setRange('st-radius', 'st-radius-o', s.radius || 0);
    setRange('st-bg-dim', 'st-dim-o', Math.round((s.bg_dim === undefined ? .25 : s.bg_dim) * 100));
    assets.bg_image = s.bg_image || ''; assets.watermark_image = s.watermark_image || ''; assets.music = s.music || '';
    $('st-bg-name').textContent = assets.bg_image ? 'image set' : ''; $('st-wm-name').textContent = assets.watermark_image ? 'logo set' : 'no logo';
    $('st-music-name').textContent = assets.music ? 'music set' : 'no music';
    $('st-wm-pos').value = s.watermark_pos || 'tr'; setRange('st-wm-size', 'st-wm-size-o', s.watermark_size || 16);
    setRange('st-wm-opacity', 'st-wm-op-o', Math.round((s.watermark_opacity === undefined ? .85 : s.watermark_opacity) * 100));
    $('st-credit').value = s.credit || ''; $('st-outro').value = s.outro_text || ''; $('st-outro-sec').value = s.outro_seconds || 3;
    setRange('st-music-vol', 'st-mv-o', Math.round((s.music_volume === undefined ? .15 : s.music_volume) * 100));
    setRange('st-music-peak', 'st-mp-o', Math.round((s.music_peak === undefined ? .85 : s.music_peak) * 100));
    $('st-music-riser').value = s.music_riser || 4;
    if ($('caption-anim')) $('caption-anim').value = s.caption_anim || 'highlight';
    for(const key of BRAND_KEYS){if($('brand-'+key))$('brand-'+key).value=s[key]||'';}
    if($('hook-duration'))$('hook-duration').value=s.hook_duration||8;
    if($('hook-background'))$('hook-background').checked=s.hook_background!==false;
    if($('hook-enabled'))$('hook-enabled').checked=s.hook_enabled!==false;
    if($('fade-inout'))$('fade-inout').checked=!!s.fade_inout;
    if($('hook-style'))$('hook-style').value=s.hook_style||'impact';
    ['contrast','brightness','saturation','clarity'].forEach(k=>{const el=$('cam-'+k);if(el&&s['cam_'+k]!==undefined&&s['cam_'+k]!==null){el.value=s['cam_'+k];el.dispatchEvent(new Event('input'));}});
  }

  // ---- uploads (logo, wallpaper, music)
  async function uploadAsset(file, kind, nameEl, key) {
    nameEl.textContent = 'uploading…';
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await fetch('/upload-asset?kind=' + kind, { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw Error(j.detail || 'Upload failed');
      assets[key] = j.id; nameEl.textContent = j.name || 'uploaded';
    } catch (e) { assets[key] = ''; nameEl.textContent = '⚠ ' + e.message; }
  }
  const hook = (id, fn) => { const el = $(id); if (el) el.addEventListener('change', fn); };
  hook('st-bg-file', e => { const f = e.target.files[0]; if (f) { uploadAsset(f, 'image', $('st-bg-name'), 'bg_image'); if ($('st-bg-mode').value === 'none') $('st-bg-mode').value = 'image'; } });
  hook('st-wm-file', e => { const f = e.target.files[0]; if (f) uploadAsset(f, 'image', $('st-wm-name'), 'watermark_image'); });
  hook('st-music-file', e => { const f = e.target.files[0]; if (f) uploadAsset(f, 'audio', $('st-music-name'), 'music'); });
  [['st-padding', 'st-padding-o', 1], ['st-radius', 'st-radius-o', 1], ['st-bg-dim', 'st-dim-o', 1], ['st-wm-size', 'st-wm-size-o', 1], ['st-wm-opacity', 'st-wm-op-o', 1], ['st-music-vol', 'st-mv-o', 1], ['st-music-peak', 'st-mp-o', 1]]
    .forEach(([i, o]) => { const el = $(i); if (el) el.addEventListener('input', () => { $(o).textContent = el.value; }); });
  if ($('st-reset')) $('st-reset').onclick = () => loadStyleFields({});

  // ---- caption animation + SRT/ASS import (added to the "Give it a voice" panel next to the language picker)
  if($('mode')){const panel=document.createElement('details');panel.className='caption-brand';panel.innerHTML='<summary>Focus the clips on a topic or campaign</summary><p class="muted">These rules use spoken words, not objects visible only on screen. A topic guides ranking. Required and excluded phrases are hard transcript filters; fewer clips may match.</p><label>Transcript focus<textarea id="focus-brief" rows="2" maxlength="800" placeholder="Funny misunderstandings, complete stories, useful editing tips…"></textarea></label><label>Must mention at least one phrase<input id="focus-include" placeholder="brand name, product name (comma-separated)"></label><label>Exclude passages mentioning<input id="focus-exclude" placeholder="sponsor, subscribe (comma-separated)"></label>';$('mode').closest('label').parentNode.append(panel);}
  const lang = $('language');
  if($('mode')){const label=document.createElement('label');label.textContent='Moment mix';const select=document.createElement('select');select.id='moment-profile';select.innerHTML='<option value="balanced">Balanced: action + dialogue + story</option><option value="action">Action / high energy</option><option value="dialogue">Dialogue, humour & insights</option>';label.append(select);$('mode').closest('label').after(label);}
  if($('hook')){const duration=document.createElement('label');duration.textContent='Opening heading duration (seconds)';const input=document.createElement('input');input.id='hook-duration';input.type='number';input.min='2';input.max='60';input.value='8';duration.append(input);$('hook').closest('label').after(duration);const backing=document.createElement('label');backing.className='check';backing.innerHTML='<input id="hook-background" type="checkbox" checked> Black backing behind opening heading';duration.after(backing);const improve=document.createElement('button');improve.textContent='Improve opening heading';improve.onclick=async()=>{try{const selected=collectWords();if(!selected?.length)throw Error('Generate or import this clip subtitles first.');improve.disabled=true;status('Writing a grounded heading with the local model…');const result=await request('/hooks/suggest',{text:selected.map(w=>w.text).join(' ')});$('hook').value=result.hook;status('Heading ready. Review the wording, then apply or export.');}catch(error){status(error.message);}finally{improve.disabled=false;}};backing.after(improve);const en=document.createElement('label');en.className='check';en.innerHTML='<input id="hook-enabled" type="checkbox" checked> Show opening heading on the clip';$('hook').closest('label').after(en);const fd=document.createElement('label');fd.className='check';fd.innerHTML='<input id="fade-inout" type="checkbox"> Fade in / out (0.3 s, picture and sound)';en.after(fd);const hs=document.createElement('label');hs.textContent='Heading look';const sel=document.createElement('select');sel.id='hook-style';[['impact','Impact (bold pop)'],['neon','Neon glow'],['banner','Banner bar'],['box','Classic box']].forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;sel.append(o);});hs.append(sel);fd.after(hs);}
  if(lang){
    const panel=document.createElement('details');panel.className='caption-brand';
    const summary=document.createElement('summary');summary.textContent='Custom caption look & saved profiles';panel.append(summary);
    const hint=document.createElement('p');hint.className='muted';hint.textContent='Leave a field blank to use the selected style. Fonts must be installed on this PC; unavailable fonts fall back. Apply or export to see the rendered result.';panel.append(hint);
    const names={caption_font:'Font family',caption_size:'Font size (1080 × 1920 reference)',caption_color:'Text colour (#RRGGBB)',caption_active:'Active word colour (#RRGGBB)',caption_outline:'Outline colour (#RRGGBB)',caption_max_words:'Maximum words per caption'};
    for(const key of BRAND_KEYS){const label=document.createElement('label');label.textContent=names[key];const input=document.createElement('input');input.id='brand-'+key;input.placeholder='Style default';if(['caption_size','caption_max_words'].includes(key)){input.type='number';input.min=key==='caption_size'?'24':'1';input.max=key==='caption_size'?'140':'12';input.step='1';}label.append(input);panel.append(label);}
    const label=document.createElement('label');label.textContent='Saved caption profile';const profiles=document.createElement('select');profiles.id='brand-profiles';label.append(profiles);panel.append(label);
    const name=document.createElement('input');name.placeholder='New profile name';name.setAttribute('aria-label','Caption profile name');panel.append(name);
    const save=document.createElement('button');save.textContent='Save caption profile';panel.append(save);
    const reset=document.createElement('button');reset.textContent='Use style defaults';reset.onclick=()=>{for(const key of BRAND_KEYS)$('brand-'+key).value='';status('Caption appearance reset. Apply or export to update the video.');};panel.append(reset);
    (lang.closest('label')||lang).parentNode.append(panel);
    let stored={};async function refresh(){const data=await request('/brands');stored=data.profiles;profiles.replaceChildren(new Option('Choose a profile',''));for(const key of Object.keys(stored))profiles.add(new Option(key,key));}
    profiles.onchange=()=>{const config=stored[profiles.value];if(config){for(const key of BRAND_KEYS)$('brand-'+key).value=config[key]||'';name.value=profiles.value;status('Caption profile loaded. Apply or export to update the video.');}};
    save.onclick=async()=>{try{const settings={};for(const key of BRAND_KEYS){const value=$('brand-'+key).value;if(value)settings[key]=value;}await request('/brands',{name:name.value,settings});await refresh();profiles.value=name.value;status('Caption profile saved on this computer.');}catch(error){status(error.message);}};
    refresh().catch(error=>status(error.message));
  }
  if (lang && !$('caption-anim')) {
    const anchor = lang.closest('label') || lang;
    const sel = document.createElement('label');
    sel.innerHTML = 'Caption animation<select id="caption-anim"><option value="highlight">Highlight (word by word)</option><option value="pop_in">Pop-in</option>' +
      '<option value="pop_in_line">Pop-in line</option><option value="one_by_one">One by one</option><option value="build_up">Build up</option><option value="full_line">Full line</option></select>';
    anchor.parentNode.insertBefore(sel, anchor.nextSibling);
    const up = document.createElement('label');
    up.className = 'upload'; up.innerHTML = '↑ Import .srt / .ass / .vtt<input id="srt-file" type="file" accept=".srt,.ass,.ssa,.vtt" hidden>';
    sel.parentNode.insertBefore(up, sel.nextSibling);const basis=document.createElement('label');basis.textContent='Imported subtitle timing';const basisSelect=document.createElement('select');basisSelect.id='caption-basis';basisSelect.innerHTML='<option value=clip>Relative to this clip</option><option value=source>Full-source timestamps</option>';basis.append(basisSelect);up.after(basis);
    async function importText(text,name){
      const absolute=$('caption-basis')?.value==='source';const j=await request('/captions/parse',{text,start:absolute?(Number($('start').value)||0):0,end:absolute?Number($('end').value):(Number($('end').value)-Number($('start').value))});
      words=j.words;wordRange=signature();renderWords();$('captions').checked=true;
      status('Imported '+j.words.length+' caption words from '+name+' ('+j.cues+' lines). Within-cue word timings are estimated; review before applying.');
    }
    const paste=document.createElement('details');paste.className='caption-brand';const title=document.createElement('summary');title.textContent='Paste subtitle text';paste.append(title);
    const text=document.createElement('textarea');text.rows=6;text.setAttribute('aria-label','Subtitle file contents');text.placeholder='Paste SRT, ASS or WebVTT contents here';paste.append(text);
    const importButton=document.createElement('button');importButton.textContent='Import pasted subtitles';importButton.onclick=async()=>{try{await importText(text.value,'pasted text');}catch(error){status(error.message);}};paste.append(importButton);basis.after(paste);
    $('srt-file').addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        await importText(await f.text(),f.name);
      } catch (err) { status(err.message); }
    });
  }

  // ---- facecam finder + "find it automatically for Make clips"
  const row = document.querySelector('.preset-row');
  if (row && !$('find-cam')) {
    const b = document.createElement('button');
    b.className = 'chip'; b.id = 'find-cam'; b.textContent = '🔎 Find my facecam';
    const none = row.querySelector('[data-preset=none]');
    row.insertBefore(b, none || null);
    const lab = document.createElement('label');
    lab.className = 'check'; lab.innerHTML = '<input id="cam-auto" type="checkbox"> Find it automatically when I press Make clips';
    row.appendChild(lab);
    b.onclick = async () => {
      if (!id) { $('preset-note').textContent = 'Add a video first (wait for it to finish loading).'; return; }
      b.disabled = true; $('preset-note').textContent = 'Looking for the facecam (a few seconds)…';
      try {
        const r = await request('/facecam/detect', { id });
        if (r.found) {
          rectEdited = true; rect = { cam: { ...r.cam }, game: { ...r.game } };
          document.querySelectorAll('[data-preset]').forEach(x => x.classList.remove('on'));
          $('preset-note').textContent = 'Facecam found (' + Math.round(r.confidence * 100) + '% sure, ' + r.method + '). Boxes set; fine-tune in step 03 if needed.';
          const stack = document.querySelector('[data-layout=stack]'); if (stack) stack.click();
        } else {
          $('preset-note').textContent = 'No facecam found: ' + (r.reason || 'nothing convincing') + '. Pick a position or draw the boxes yourself.';
        }
      } catch (e) { $('preset-note').textContent = e.message; } finally { b.disabled = false; }
    };
  }

  // ---- wrap the app.js helpers
  const baseRequest = window.request;
  window.request = function (path, body) {
    if(body&&(path==='/live/start'||path==='/creators'||/^\/creators\/[^/]+\/layout$/.test(path)))body={...styleFields(),...body};
    if (path === '/make' && body) {
      const extra = { ...styleFields(), cam_auto: !!($('cam-auto') && $('cam-auto').checked), credit_auto: !!$('st-credit-auto').checked };
      body = { ...extra, ...body, moment_profile:$('moment-profile')?.value||'balanced',focus_brief:$('focus-brief')?.value||'',include_phrases:$('focus-include')?.value||'',exclude_phrases:$('focus-exclude')?.value||'' };
      if (window.__aiMoments) { body.moments = window.__aiMoments; window.__aiMoments = null; }
    }
    if (path === '/live/start' && body && window.__liveOpts) body = { ...styleFields(), ...window.__liveOpts(), ...body };
    if (typeof path === 'string' && /^\/live\/[^/]+\/clip-now$/.test(path) && window.__liveOpts) body = { seconds: Number($('lv-len').value) || 38, ...(body || {}) };
    if (path === '/clips/reedit' && body && body.changes) body = { ...body, changes: { ...body.changes, ...styleState() } };
    const p = baseRequest(path, body);
    if (typeof path === 'string' && path.startsWith('/make/')) {
      return p.then(r => {
        if (r && r.facecam && $('preset-note')) {
          $('preset-note').textContent = r.facecam.found ? 'Facecam found automatically (' + Math.round((r.facecam.confidence || 0) * 100) + '% sure) and used for every clip.'
            : 'No facecam found automatically; your selected boxes were used.';
        }
        return r;
      });
    }
    return p;
  };
  const baseExport = window.exportSettings;
  window.exportSettings = function (...a) { return Object.assign(baseExport.apply(this, a), styleFields()); };
  const baseOpen = window.openSavedClip;
  window.openSavedClip = async function (file) {
    await baseOpen(file);
    try { const saved = await baseRequest('/clips/' + file + '/edit'); loadStyleFields(saved.settings); } catch (e) { /* the clip loaded; style fields keep their values */ }
  };


  // ---- live clipping: clip length, hook source, captions switch, chat-hype meter, phone access box
  const liveBox = $('live-box');
  if (liveBox && !$('lv-len')) {
    const opts = document.createElement('div');
    opts.className = 'controls'; opts.id = 'live-opts';
    opts.innerHTML = '<label>Clip length<select id="lv-len"><option value="10">10 s (short)</option><option value="20" selected>20 s (reel)</option><option value="30">30 s (viral)</option><option value="0">Auto (38 s)</option></select></label>' +
      '<label>Hook text<select id="lv-hook"><option value="ai">AI writes it</option><option value="title">Stream title</option><option value="custom">My own text</option></select></label>' +
      '<label id="lv-hook-wrap" hidden>Your hook<input id="lv-hook-text" type="text" maxlength="70" placeholder="Hook text on top"></label>' +
      '<label class="check"><input id="lv-caps" type="checkbox" checked> Captions on live clips (off = faster)</label>';
    liveBox.parentNode.insertBefore(opts, liveBox);
    $('lv-hook').addEventListener('change', () => { $('lv-hook-wrap').hidden = $('lv-hook').value !== 'custom'; });
    const hype = document.createElement('div');
    hype.className = 'hype';
    hype.innerHTML = '<div class="hype-top"><b>🔥 Chat hype</b><span id="lv-hype-label" class="muted">waiting…</span></div><div class="meter"><i id="lv-hype-bar"></i></div><small class="muted" id="lv-hype-info"></small>';
    liveBox.insertBefore(hype, liveBox.firstChild);
    const phoneBox = document.createElement('div');
    phoneBox.className = 'import-note'; phoneBox.id = 'phone-box'; phoneBox.textContent = 'Phone access: checking…';
    liveBox.parentNode.insertBefore(phoneBox, opts.nextSibling);
    const PRE = { 10: [7, 3], 20: [12, 8], 30: [20, 10], 0: [24, 14] };
    window.__liveOpts = () => {
      const len = Number($('lv-len').value), [before, after] = PRE[len];
      return { before, after, captions: $('lv-caps').checked, hook_mode: $('lv-hook').value, hook_text: $('lv-hook-text').value.trim() };
    };
    setInterval(async () => {
      if (typeof liveId === 'undefined' || !liveId || document.hidden) return;
      try {
        const s = await baseRequest('/live/' + liveId);
        const h = s.hype || 0;
        $('lv-hype-bar').style.width = h + '%'; $('lv-hype-label').textContent = h + '% · ' + (s.hype_label || '');
        $('lv-hype-info').textContent = (s.msgs30 || 0) + ' comments in the last 30 s (usual ' + s.baseline + ' per 10 s)' + (s.title ? ' · ' + s.title.slice(0, 60) : '');
      } catch (e) { /* the session ended or the app restarted */ }
    }, 2000);
    async function loadPhone() {
      try {
        const p = await baseRequest('/phone/status');
        if (!p.enabled) {
          phoneBox.innerHTML = '📱 <b>Phone access is off.</b> To control live clipping and watch clips on your phone, close NeonClipping and start it with the <b>NeonClipping (phone access)</b> shortcut. Windows may ask once to allow it on private networks: choose Allow.';
        } else {
          const urls = p.urls.length ? p.urls.map(u => '<b>' + u + '</b>').join(' or ') : '(no Wi-Fi address found)';
          phoneBox.innerHTML = '📱 <b>Phone access is on.</b> On a phone connected to the same Wi-Fi open ' + urls + ' and enter the PIN <b style="color:var(--lime);font-size:18px;letter-spacing:.1em">' + p.pin + '</b> <button class="secondary" id="phone-newpin" style="margin-left:8px;padding:4px 10px">New PIN</button>' +
            '<br><span class="muted">Only people on your Wi-Fi who know the PIN can open it. Uploads and file tools stay on this PC.</span>';
          $('phone-newpin').onclick = async () => { await baseRequest('/phone/newpin', {}); loadPhone(); };
        }
      } catch (e) { phoneBox.textContent = ''; }
    }
    loadPhone();
  }

  // ---- keyboard shortcuts for trimming: I = in point, O = out point, Space = play / pause
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select', 'button'].includes(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
    const vid = $('video');
    if (!vid || !id || $('editor-view').hidden) return;
    const k = e.key.toLowerCase();
    const t = Math.round(vid.currentTime * 100) / 100;
    if (k === 'i') {
      const end = Number($('end').value);
      window.setRange(t, end > t + 1 ? end : Math.min(t + 30, sourceDuration || t + 30));
      status('In point set to ' + t.toFixed(2) + ' s');
    } else if (k === 'o') {
      const start = Number($('start').value);
      if (t > start + .5) { window.setRange(start, t); status('Out point set to ' + t.toFixed(2) + ' s'); } else status('Move the video past the in point first.');
    } else if (k === ' ') { e.preventDefault(); if (vid.paused) vid.play(); else vid.pause(); }
  });
  const endBox = $('end');
  if (endBox && endBox.parentNode && !$('kbd-hint')) {
    const h = document.createElement('div'); h.id = 'kbd-hint'; h.className = 'muted'; h.textContent = 'Shortcuts: I = set start here · O = set end here · Space = play / pause';
    (endBox.closest('.controls') || endBox.parentNode).appendChild(h);
  }

  // ---- AI parts
  let aiInfo = null, aiMoments = [];
  const aiStatus = t => { $('ai-status').textContent = t; };
  async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    const old = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = old; }, 1500);
  }
  if ($('ai-split')) {
    $('ai-split').onclick = async () => {
      const url = $('ai-url').value.trim(); if (!url) { aiStatus('Paste a YouTube link first.'); return; }
      $('ai-split').disabled = true; aiStatus('Reading the video and its captions…'); $('ai-list').replaceChildren();
      try {
        const body = { url, per_part: Number($('ai-per').value) || 3 }; if ($('ai-parts').value) body.parts = Number($('ai-parts').value);
        body.min_len = Number($('minlen') ? $('minlen').value : 30); body.max_len = Number($('length') ? $('length').value : 60);
        aiInfo = await request('/ai/parts', body);
        aiStatus(aiInfo.parts.length + ' parts for “' + aiInfo.title + '”. Paste each prompt into a chatbot (one chat per part works best), then paste all answers below.');
        for (const p of aiInfo.parts) {
          const d = document.createElement('div'); d.className = 'queue-item';
          const t = document.createElement('b'); t.textContent = 'Part ' + p.index + ' · ' + p.label;
          const m = document.createElement('small'); m.textContent = p.lines + ' lines · ' + Math.round(p.chars / 1000) + 'k characters';
          const c = document.createElement('button'); c.className = 'secondary'; c.textContent = 'Copy prompt'; c.onclick = () => copyText(p.prompt, c);
          d.append(t, m, c); $('ai-list').append(d);
        }
      } catch (e) { aiStatus('⚠ ' + e.message); } finally { $('ai-split').disabled = false; }
    };
    $('ai-read').onclick = async () => {
      try {
        const r = await request('/ai/answers', { text: $('ai-answers').value, duration: aiInfo ? aiInfo.duration : null });
        aiMoments = r.moments; $('ai-moments').replaceChildren();
        r.moments.forEach((m, i) => {
          const d = document.createElement('label'); d.className = 'queue-item';
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.dataset.i = i;
          const t = document.createElement('b'); t.textContent = m.start_label + ' → ' + m.end_label + ' · ' + (m.title || 'Moment ' + (i + 1));
          d.append(cb, t); $('ai-moments').append(d);
        });
        if (r.rejected.length) { const n = document.createElement('small'); n.textContent = r.rejected.length + ' lines skipped: ' + r.rejected.slice(0, 3).map(x => x.why).join(', '); $('ai-moments').append(n); }
        $('ai-make').disabled = false; aiStatus(r.moments.length + ' moments ready.');
      } catch (e) { aiStatus('⚠ ' + e.message); $('ai-make').disabled = true; }
    };
    $('ai-make').onclick = () => {
      const picked = [...$('ai-moments').querySelectorAll('input[type=checkbox]')].filter(c => c.checked).map(c => aiMoments[Number(c.dataset.i)]);
      if (!picked.length) { aiStatus('Tick at least one moment.'); return; }
      const url = (aiInfo && aiInfo.url) || $('ai-url').value.trim();
      $('url').value = url; window.__aiMoments = picked.map(m => ({ start: m.start, end: m.end, title: m.title, hook: m.hook }));
      aiStatus('Making ' + picked.length + ' clips… watch the progress in step 01 / Make clips.');
      $('make').scrollIntoView({ behavior: 'smooth' }); $('make').click();
    };
  }
})();
