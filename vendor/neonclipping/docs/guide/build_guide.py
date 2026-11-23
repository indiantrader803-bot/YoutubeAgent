"""Builds guide.html (then print to PDF with headless Chrome).
Keeps the agent prompt in sync with ../NEONCLIPPING-AGENT-SETUP-PROMPT.txt. Styles live in style.css next to this file."""
import html
from pathlib import Path

here = Path(__file__).parent
prompt = (here.parent / 'NEONCLIPPING-AGENT-SETUP-PROMPT.txt').read_text(encoding='utf-8').strip()
css = (here / 'style.css').read_text(encoding='utf-8')
GH = 'github.com/iamajmeena/neonclipping'


_count = [0]


def foot(_unused=None):
    _count[0] += 1          # pages are built in order, so this is the page number (the cover has none)
    return f'<div class="foot"><span>NeonClipping · by Ajay K Meena · ★ Star: {GH}</span><span>{_count[0]}</span></div>'


def both(en, hi):
    return f'<div class="cols"><div><span class="lg">EN</span>{en}</div><div class="hi"><span class="lg">हिं</span>{hi}</div></div>'


def tile(icon, title, en, hi):
    return f'<div class="tile"><div class="ic">{icon}</div><b>{title}</b><p>{en}</p><p class="hi">{hi}</p></div>'


def step(n, en, hi):
    return f'<div class="stp"><div class="num">{n}</div><div><b>{en}</b><div class="hi">{hi}</div></div></div>'


def row(a, en, hi):
    return f'<tr><td><b>{a}</b></td><td>{en}</td><td class="hi">{hi}</td></tr>'


pages = []

pages.append(f'''<section class="page cover"><div class="sun"></div><div class="grid"></div>
<div class="txt"><div class="kicker">OPEN-SOURCE CLIP ENGINE</div><h1>NEON<br><em>CLIPPING</em></h1>
<p>Paste a link. Get captioned 9:16 clips in about two minutes. Free. On your computer.<br><span class="hi">लिंक पेस्ट करो। दो मिनट में कैप्शन वाली 9:16 क्लिप पाओ। फ्री। आपके अपने कंप्यूटर पर।</span></p>
<p style="margin-top:8mm"><span class="chip">★ Star on GitHub</span><span class="chip ig">Follow @iamajmeena</span></p><p style="font-size:11pt">{GH}</p></div>
<div class="by">Made by <span>Ajay K Meena</span> · Instagram @iamajmeena · English + हिंदी guide</div></section>''')

pages.append(f'''<section class="page"><h2><span class="n">01</span>What you get <span class="hi sub">· आपको क्या मिलता है</span></h2>
<img class="shot" src="home.jpg" style="width:100%">
<div class="tiles">
{tile("⚡", "One click", "Paste a YouTube, Twitch or Kick link, press Make clips.", "लिंक पेस्ट करो, Make clips दबाओ।")}
{tile("💬", "Hinglish captions", "Hindi speech written in English letters, 2–4 words at a time, spoken word lit up.", "हिंदी बोली अंग्रेज़ी अक्षरों में, 2–4 शब्द करके, बोला जा रहा शब्द चमकता है।")}
{tile("🎮", "Facecam + gameplay", "Pick where the webcam is. Face on top, game below, ready for Reels and Shorts.", "वेबकैम कहाँ है चुनो। ऊपर चेहरा, नीचे गेम, Reels/Shorts के लिए तैयार।")}
{tile("🔒", "Free and private", "Runs on your computer. No account, no subscription, nothing uploaded.", "आपके कंप्यूटर पर चलता है। न अकाउंट, न सब्सक्रिप्शन, कुछ अपलोड नहीं।")}
</div>
<div class="note"><b>Quick:</b> 85-minute video → 3 clips in about 2 minutes (it fetches only the best parts, not the whole video). <span class="hi">85 मिनट का वीडियो → करीब 2 मिनट में 3 क्लिप (पूरा वीडियो नहीं, सिर्फ़ चुने हुए हिस्से)।</span></div>
{foot("1")}</section>''')

pages.append(f'''<section class="page"><h2><span class="n">02</span>Set up in one paste <span class="hi sub">· एक पेस्ट में सेटअप</span></h2>
<p class="lead">Don't install anything by hand. An AI agent does it all. <span class="hi">खुद कुछ इंस्टॉल मत करो। AI agent सब कर देगा।</span></p>
<div class="steps">
{step(1, "Open an AI agent that can run commands on your computer: Claude Code, OpenAI Codex, Google Antigravity or Cursor.", "ऐसा AI agent खोलो जो आपके कंप्यूटर पर कमांड चला सके: Claude Code, OpenAI Codex, Google Antigravity या Cursor।")}
{step(2, "Copy the prompt on the next page and paste it. Press Enter.", "अगले पन्ने का prompt कॉपी करके पेस्ट करो। Enter दबाओ।")}
{step(3, "Say yes when it asks. It checks your computer, installs what is missing, starts NeonClipping and opens it in Chrome.", "जब पूछे तो yes बोलो। वह आपका कंप्यूटर जाँचेगा, जो कम है वो इंस्टॉल करेगा, NeonClipping चालू करके Chrome में खोल देगा।")}
{step(4, "It then explains in simple Hindi how to use it. Done.", "फिर वह आसान हिंदी में बताएगा कि इस्तेमाल कैसे करना है। बस।")}
</div>
<div class="tiles small">
{tile("🖥️", "It checks", "Windows / Mac / Linux, disk space, GPU.", "Windows / Mac / Linux, डिस्क, GPU देखता है।")}
{tile("📦", "It installs", "Python, FFmpeg, Git, the app. Asks before big downloads.", "Python, FFmpeg, Git, ऐप। बड़े डाउनलोड से पहले पूछता है।")}
{tile("🧠", "Optional AI", "Ollama (2 GB) for smart titles. It asks first.", "स्मार्ट टाइटल के लिए Ollama (2 GB)। पहले पूछता है।")}
{tile("🌐", "It opens it", "http://127.0.0.1:8770 in your Chrome.", "आपके Chrome में http://127.0.0.1:8770 खुलता है।")}
</div>
<div class="note warn"><b>Safe:</b> no passwords, no API keys, no security settings touched. <span class="hi">सुरक्षित: कोई पासवर्ड/API key नहीं, सिक्योरिटी सेटिंग को हाथ नहीं लगाता।</span></div>
{foot("2")}</section>''')

cut = prompt.index('STEP 4.')
prompt_a, prompt_b = prompt[:cut].rstrip(), prompt[cut:]
pages.append(f'''<section class="page"><h2><span class="n">03</span>The prompt, part 1 <span class="hi sub">· यह prompt कॉपी करो (1/2)</span></h2>
<p class="lead">Copy everything in both boxes (this page and the next) and paste it into your AI agent. <span class="hi">दोनों पन्नों का पूरा टेक्स्ट कॉपी करके अपने AI agent में पेस्ट करो। वही फ़ाइल GitHub पर भी है: docs/NEONCLIPPING-AGENT-SETUP-PROMPT.txt</span></p>
<pre class="pr">{html.escape(prompt_a)}</pre>
{foot("3")}</section>''')
pages.append(f'''<section class="page"><h2><span class="n">03</span>The prompt, part 2 <span class="hi sub">· prompt (2/2)</span></h2>
<pre class="pr">{html.escape(prompt_b)}</pre>
{foot("4")}</section>''')

pages.append(f'''<section class="page"><h2><span class="n">04</span>Make your first clips <span class="hi sub">· पहली क्लिप बनाओ</span></h2>
<div class="steps">
{step(1, "Paste a video link (or Upload video).", "वीडियो लिंक पेस्ट करो (या Upload video)।")}
{step(2, "Pick the facecam position, or draw the face and game boxes in step 03.", "Facecam position चुनो, या स्टेप 03 में चेहरे और गेम के बॉक्स खुद बनाओ।")}
{step(3, "Press ⚡ Make clips. Clips appear one by one.", "⚡ Make clips दबाओ। क्लिप एक-एक करके आती हैं।")}
{step(4, "Preview, then Download MP4. All clips also stay in My clips.", "प्रीव्यू देखो, फिर Download MP4। सारी क्लिप My clips में भी रहती हैं।")}
</div>
<img class="shot" src="results.jpg" style="width:60%;display:block;margin:3mm auto">
<img class="shot" src="format.jpg" style="width:80%;display:block;margin:3mm auto">
{foot("4")}</section>''')

pages.append(f'''<section class="page"><h2><span class="n">05</span>Settings in one glance <span class="hi sub">· सेटिंग एक नज़र में</span></h2>
<table><tr><th>Setting</th><th>English</th><th>हिंदी</th></tr>
{row("Mode", "Fast (default, ~2 min) or Deep (slower, smarter).", "Fast (डिफ़ॉल्ट, ~2 मिनट) या Deep (धीमा, ज़्यादा समझदार)।")}
{row("Clips", "How many clips (1–12).", "कितनी क्लिप (1–12)।")}
{row("Min / Max length", "e.g. 30 and 60, or 30 and 80 seconds.", "जैसे 30 और 60, या 30 और 80 सेकंड।")}
{row("Facecam position", "Top-left, top-right, bottom-left, bottom-right, bottom-centre, none. Or draw your own boxes.", "Top-left, top-right, bottom-left, bottom-right, bottom-centre, none। या बॉक्स खुद बनाओ।")}
{row("Caption style", "GTA Neon, Hormozi, MrBeast, Impact, Clean.", "GTA Neon, Hormozi, MrBeast, Impact, Clean।")}
{row("Caption language", "Auto (Hindi → Hinglish), Hinglish, हिंदी, English.", "Auto (हिंदी → Hinglish), Hinglish, हिंदी, English।")}
{row("Caption accuracy", "Accurate (default) · Fast · Best Hindi (most correct Hindi, slow).", "Accurate (डिफ़ॉल्ट) · Fast · Best Hindi (सबसे सही हिंदी, धीमा)।")}
</table>
<div class="note"><b>Draw your own boxes:</b> in step 03 press Facecam area and drag around the webcam, then Gameplay area and drag over the game. Make clips uses exactly your boxes. <span class="hi">स्टेप 03 में Facecam area दबाकर वेबकैम पर ड्रैग करो, फिर Gameplay area दबाकर गेम पर। Make clips ठीक आपके बॉक्स इस्तेमाल करता है।</span></div>
{foot("5")}</section>''')

pages.append(f'''<section class="page"><h2><span class="n">06</span>Tips and fixes <span class="hi sub">· टिप्स और हल</span></h2>
{both("<b>Best results</b><ul><li>Pick videos where the creator talks and reacts: streams, podcasts, interviews.</li><li>YouTube links are the fastest.</li><li>Always watch a clip before posting.</li><li>Pick the facecam corner that matches the video.</li></ul>", "<b>बेहतर नतीजे</b><ul><li>ऐसे वीडियो चुनो जिनमें क्रिएटर बोलता/रिएक्ट करता हो: स्ट्रीम, पॉडकास्ट, इंटरव्यू।</li><li>YouTube लिंक सबसे तेज़ हैं।</li><li>पोस्ट से पहले क्लिप ज़रूर देखो।</li><li>वीडियो के हिसाब से सही facecam कोना चुनो।</li></ul>")}
<table><tr><th>Problem</th><th>Fix</th></tr>
<tr><td>No AI titles</td><td>Ollama is off. Start it, run <code>ollama pull llama3.2:3b</code>. <span class="hi">Ollama बंद है; चालू करके यह कमांड चलाओ।</span></td></tr>
<tr><td>Wrong caption words</td><td>Caption accuracy → Best Hindi, or edit the words in step 04. <span class="hi">Best Hindi चुनो या स्टेप 04 में शब्द ठीक करो।</span></td></tr>
<tr><td>Twitch / MP4 is slower</td><td>Speech must be recognised on your PC. Ask for fewer clips. <span class="hi">आपके PC पर आवाज़ पहचानी जाती है; कम क्लिप माँगो।</span></td></tr>
<tr><td>Link fails</td><td>Use the original MP4 with Upload video. <span class="hi">ओरिजिनल MP4 Upload video से डालो।</span></td></tr>
<tr><td>Can't set it up</td><td>Paste the prompt into an AI agent again and tell it the error. <span class="hi">Prompt दोबारा AI agent को दो और एरर बताओ।</span></td></tr></table>
<div class="cta"><h3>Liked it? Please star it ★ / पसंद आया? स्टार ज़रूर करें ★</h3>
<p><b>Every star tells me this is useful and helps me keep making NeonClipping better. <span class="hi">हर स्टार मुझे बताता है कि यह काम का है और इसे आगे बेहतर बनाने में मदद करता है।</span></b><br><br>
★ <a href="https://github.com/iamajmeena/neonclipping">{GH}</a><br>♥ Optional support (UPI / cards): <a href="https://rzp.io/rzp/JN41CpW">rzp.io/rzp/JN41CpW</a><br>📷 Instagram: <a href="https://www.instagram.com/iamajmeena/">@iamajmeena</a> · Made by <b>Ajay K Meena</b></p></div>
{foot("6")}</section>''')

doc = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>NeonClipping Guide · English + हिंदी</title>\n'
       f'<style>{css}</style></head><body>\n' + '\n'.join(pages) + '\n</body></html>')
(here / 'guide.html').write_text(doc, encoding='utf-8')
print('pages', len(pages), 'bytes', len(doc))
