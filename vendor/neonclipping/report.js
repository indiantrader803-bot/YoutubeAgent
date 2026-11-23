// "Report a problem" (English + Hindi). Everything here is user-triggered; see report.py for what is removed from the text.
(() => {
  const css = `
  #rp-btn{position:fixed;right:14px;bottom:14px;z-index:60;background:var(--panel,#171320);color:var(--white,#fbf6ff);border:1px solid var(--line,#30263e);border-radius:999px;padding:9px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 18px #0008}
  #rp-btn:hover{border-color:var(--pink,#ff4ba5)}
  #rp-dlg{width:min(720px,94vw);max-height:90vh;overflow:auto;background:var(--panel,#171320);color:var(--white,#fbf6ff);border:1px solid var(--pink,#ff4ba5);border-radius:16px;padding:20px 22px;font:14px/1.5 system-ui,sans-serif}
  #rp-dlg::backdrop{background:#000a}
  #rp-dlg h2{margin:0 0 4px;font-size:20px}
  #rp-dlg .rp-hi{color:var(--cyan,#58e8f7)}
  #rp-dlg .rp-card{border:1px solid var(--line,#30263e);border-radius:12px;padding:12px 14px;margin:10px 0}
  #rp-dlg .rp-card b{display:block;margin-bottom:2px}
  #rp-dlg .rp-safe{border-color:var(--lime,#d4fb58)}
  #rp-dlg p{margin:4px 0;color:var(--muted,#a99db7)}
  #rp-dlg textarea{width:100%;box-sizing:border-box;background:#0b0912;color:var(--white,#fbf6ff);border:1px solid var(--line,#30263e);border-radius:8px;padding:8px;font:12px/1.4 ui-monospace,Consolas,monospace}
  #rp-dlg button,#rp-dlg a.rp-a{background:var(--pink,#ff4ba5);color:#14081a;border:0;border-radius:8px;padding:8px 14px;font:700 13px system-ui,sans-serif;cursor:pointer;text-decoration:none;display:inline-block;margin-top:6px}
  #rp-dlg button[disabled]{opacity:.4;cursor:not-allowed}
  #rp-dlg .rp-x{background:transparent;color:var(--muted,#a99db7);border:1px solid var(--line,#30263e)}
  #rp-dlg label.rp-c{display:flex;gap:8px;align-items:flex-start;margin-top:6px;color:var(--white,#fbf6ff)}
  #rp-msg{margin-top:6px;color:var(--lime,#d4fb58)}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    kids.forEach(k => n.append(k)); return n;
  };
  const en = t => el('p', { textContent: t });
  const hi = t => el('p', { textContent: t, className: 'rp-hi', lang: 'hi' });

  const btn = el('button', { id: 'rp-btn', type: 'button', textContent: '⚑ Report a problem · समस्या बताएँ' });
  const dlg = el('dialog', { id: 'rp-dlg' });
  const note = el('textarea', { rows: 2, placeholder: 'What went wrong? / क्या दिक्कत आई? (optional)' });
  const diag = el('textarea', { rows: 9, readOnly: true });
  const consent = el('input', { type: 'checkbox', id: 'rp-consent' });
  const sendBtn = el('button', { type: 'button', textContent: 'Send directly · सीधे भेजें', disabled: true });
  const issueA = el('a', { className: 'rp-a', target: '_blank', rel: 'noopener', textContent: 'Open GitHub issue · GitHub पर बताएँ' });
  const dlA = el('a', { className: 'rp-a', textContent: 'Download diagnostics · फ़ाइल डाउनलोड करें' });
  const msg = el('div', { id: 'rp-msg' });
  let canSend = false, timer = 0;

  const card = (cls, title, titleHi, ...body) => el('div', { className: 'rp-card ' + cls },
    el('b', { textContent: title }), el('b', { textContent: titleHi, className: 'rp-hi', lang: 'hi' }), ...body);

  dlg.append(
    el('h2', { textContent: 'Report a problem · समस्या की रिपोर्ट' }),
    en('Something broke? Tell me and I can fix it for everyone. You choose how much to share. Nothing is sent unless you press a button.'),
    hi('कुछ ठीक से नहीं चला? बताइए, मैं सबके लिए ठीक कर दूँगा। कितना शेयर करना है, आप तय करते हैं। बटन दबाए बिना कुछ नहीं भेजा जाता।'),
    note,
    card('rp-safe', '1 · GitHub issue (safest)', '1 · GitHub पर रिपोर्ट (सबसे सुरक्षित)',
      en('Opens a pre-filled page on GitHub. You read it, edit it, and press Submit yourself. It is public, so we remove links, user names, e-mails and IP addresses first.'),
      hi('GitHub का भरा हुआ पेज खुलता है। आप पढ़कर बदल सकते हैं और Submit खुद दबाते हैं। यह सार्वजनिक होता है, इसलिए लिंक, यूज़र नाम, ई-मेल और IP पहले ही हटा दिए जाते हैं।'),
      issueA),
    card('', '2 · Download the diagnostics file', '2 · डायग्नोस्टिक फ़ाइल डाउनलोड करें',
      en('Saves the same text as a file. Send it to me yourself (GitHub, Instagram DM, WhatsApp). Your log stays on your computer until you share it.'),
      hi('यही जानकारी एक फ़ाइल में सेव होती है। इसे आप खुद भेजें (GitHub, Instagram DM, WhatsApp)। जब तक आप शेयर नहीं करते, लॉग आपके कंप्यूटर पर ही रहता है।'),
      dlA),
    card('', '3 · Send directly to the developer (optional)', '3 · सीधे डेवलपर को भेजें (वैकल्पिक)',
      en('If you want a fix quickly, send the text below straight to me. Only technical details: versions and error messages. No personal data, no videos, no links. Used only to fix NeonClipping. If you prefer not to, use option 1 or 2.'),
      hi('अगर जल्दी समाधान चाहिए तो नीचे का टेक्स्ट सीधे मुझे भेजें। सिर्फ़ तकनीकी जानकारी: वर्शन और एरर संदेश। कोई निजी डेटा, वीडियो या लिंक नहीं। सिर्फ़ NeonClipping ठीक करने के लिए। नहीं भेजना चाहते तो ऊपर का विकल्प 1 या 2 चुनें।'),
      diag,
      el('label', { className: 'rp-c' }, consent, el('span', { textContent: 'I have read this text and allow sending it. / मैंने यह टेक्स्ट पढ़ लिया है और भेजने की अनुमति देता/देती हूँ।' })),
      sendBtn, msg),
    el('button', { className: 'rp-x', type: 'button', textContent: 'Close · बंद करें', onclick: () => dlg.close() }));
  document.body.append(btn, dlg);

  const refresh = async () => {
    try {
      const r = await fetch('/report/info?note=' + encodeURIComponent(note.value));
      const j = await r.json();
      diag.value = j.diagnostics; issueA.href = j.issue_url;
      dlA.href = '/report/download?note=' + encodeURIComponent(note.value); dlA.download = 'neonclipping-diagnostics.txt';
      canSend = !!j.can_send;
      if (!canSend) msg.textContent = 'Direct sending is not set up in this version. Use option 1 or 2. / इस वर्शन में सीधा भेजना चालू नहीं है, विकल्प 1 या 2 चुनें।';
      sendBtn.disabled = !(consent.checked && canSend);
    } catch (e) { diag.value = 'Could not read diagnostics: ' + e.message; }
  };
  btn.onclick = () => { msg.textContent = ''; dlg.showModal(); refresh(); };
  note.oninput = () => { clearTimeout(timer); timer = setTimeout(refresh, 400); };
  consent.onchange = () => { sendBtn.disabled = !(consent.checked && canSend); };
  sendBtn.onclick = async () => {
    sendBtn.disabled = true; msg.textContent = '…';
    try {
      const r = await fetch('/report/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: consent.checked, note: note.value }) });
      const j = await r.json();
      msg.textContent = j.message || j.detail || 'Done';
    } catch (e) { msg.textContent = 'Could not send: ' + e.message; }
    sendBtn.disabled = !(consent.checked && canSend);
  };

  // Errors the page itself catches are written to the local log (server removes links/paths). Never loops on its own failures.
  let logging = false;
  const logErr = (stage, error) => {
    if (logging) return; logging = true;
    fetch('/report/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage, error: String(error).slice(0, 600) }) })
      .catch(() => {}).finally(() => { logging = false; });
  };
  addEventListener('unhandledrejection', e => logErr('page', (e.reason && e.reason.message) || e.reason));
  addEventListener('error', e => logErr('page', e.message));
})();
