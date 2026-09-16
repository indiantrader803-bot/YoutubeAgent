import sys
import soundfile as sf
try:
    from kokoro_onnx import Kokoro
    kokoro = Kokoro("models/kokoro/kokoro-v0_19.onnx", "models/kokoro/voices.json")
    text_content = """School mein jab principal bolte hain ki aaj do ghante ki extra class hogi! Bhai puri class ka chehra dekhne layak tha! Lekin backbencher pehle hi lunch box khol ke baith gaya! Channel subscribe karo!"""
    samples, sample_rate = kokoro.create(text_content, voice="af_heart", speed=1, lang="en-us")
    sf.write(sys.argv[1], samples, sample_rate)
    print("KOKORO_SUCCESS")
except Exception as e:
    print(f"KOKORO_ERROR: {e}")
    sys.exit(1)
