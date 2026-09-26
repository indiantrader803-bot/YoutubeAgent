// Language roster shared by the content matrix and TTS providers.
// Each code maps to: google-tts-api voice lang, ElevenLabs language_code,
// and the script-writing AI prompt language.

const DEFAULT_LANGUAGES = [
  { code: 'en', name: 'English',            google: 'en', elevenlabs: 'en', openai: 'en' },
  { code: 'hi', name: 'Hindi',              google: 'hi', elevenlabs: 'hi', openai: 'hi' },
  { code: 'es', name: 'Spanish',            google: 'es', elevenlabs: 'es', openai: 'es' },
  { code: 'pt', name: 'Portuguese (Brazil)', google: 'pt', elevenlabs: 'pt', openai: 'pt' },
  { code: 'ar', name: 'Arabic',             google: 'ar', elevenlabs: 'ar', openai: 'ar' },
  { code: 'id', name: 'Indonesian',         google: 'id', elevenlabs: 'id', openai: 'id' }
];

module.exports = { DEFAULT_LANGUAGES };
