"""Caption languages. Whisper (the local speech model) understands about 99 languages; this is the list shown in the menu.

'hinglish' is not a Whisper language: it means Hindi speech written in English letters and is handled in captions.py.
Captions are burned in with the fonts installed on your computer, so scripts your system has no font for (some Indic, Arabic, Thai,
CJK) may show empty boxes; right-to-left languages (Arabic, Persian, Hebrew, Urdu) get basic support only.
"""
SPECIAL = {'hinglish': 'Hinglish (Hindi in English letters)'}
# (code, name as spoken, English name)
MORE = [
    ('ur', 'اردو', 'Urdu'), ('bn', 'বাংলা', 'Bengali'), ('ta', 'தமிழ்', 'Tamil'), ('te', 'తెలుగు', 'Telugu'), ('mr', 'मराठी', 'Marathi'),
    ('gu', 'ગુજરાતી', 'Gujarati'), ('kn', 'ಕನ್ನಡ', 'Kannada'), ('ml', 'മലയാളം', 'Malayalam'), ('pa', 'ਪੰਜਾਬੀ', 'Punjabi'),
    ('ne', 'नेपाली', 'Nepali'), ('si', 'සිංහල', 'Sinhala'), ('ar', 'العربية', 'Arabic'), ('fa', 'فارسی', 'Persian'),
    ('he', 'עברית', 'Hebrew'), ('tr', 'Türkçe', 'Turkish'), ('ru', 'Русский', 'Russian'), ('uk', 'Українська', 'Ukrainian'),
    ('pl', 'Polski', 'Polish'), ('cs', 'Čeština', 'Czech'), ('sk', 'Slovenčina', 'Slovak'), ('hu', 'Magyar', 'Hungarian'),
    ('ro', 'Română', 'Romanian'), ('bg', 'Български', 'Bulgarian'), ('sr', 'Српски', 'Serbian'), ('hr', 'Hrvatski', 'Croatian'),
    ('el', 'Ελληνικά', 'Greek'), ('de', 'Deutsch', 'German'), ('fr', 'Français', 'French'), ('es', 'Español', 'Spanish'),
    ('pt', 'Português', 'Portuguese'), ('it', 'Italiano', 'Italian'), ('nl', 'Nederlands', 'Dutch'), ('ca', 'Català', 'Catalan'),
    ('sv', 'Svenska', 'Swedish'), ('da', 'Dansk', 'Danish'), ('no', 'Norsk', 'Norwegian'), ('fi', 'Suomi', 'Finnish'),
    ('is', 'Íslenska', 'Icelandic'), ('id', 'Bahasa Indonesia', 'Indonesian'), ('ms', 'Bahasa Melayu', 'Malay'),
    ('tl', 'Tagalog', 'Filipino'), ('vi', 'Tiếng Việt', 'Vietnamese'), ('th', 'ไทย', 'Thai'), ('zh', '中文', 'Chinese'),
    ('ja', '日本語', 'Japanese'), ('ko', '한국어', 'Korean'), ('sw', 'Kiswahili', 'Swahili'), ('af', 'Afrikaans', 'Afrikaans'),
    ('am', 'አማርኛ', 'Amharic'), ('az', 'Azərbaycan', 'Azerbaijani'),
]
BASE = ('hi', 'en')                              # shown first in the menu
ALL = set(BASE) | {c for c, _, _ in MORE} | set(SPECIAL)


def valid(code):
    """None / '' (auto) or a supported code."""
    return not code or code in ALL


def label(code, spoken, english):
    return f'{english} · {spoken}'
