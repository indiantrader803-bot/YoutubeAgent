import sys
import soundfile as sf
try:
    from kokoro_onnx import Kokoro
    kokoro = Kokoro("models/kokoro/kokoro-v0_19.onnx", "models/kokoro/voices.json")
    samples, sample_rate = kokoro.create("From ancient Mayan calendars to the apocalyptic threats faced by the Avengers, humanity has always been obsessed with the end of the world—but why?

Hey everyone, welcome back to the channel!
Today, we're diving deep into The History and Science of Doomsday Prophecies.
By the end of this video, you'll understand exactly everything about The History and Science of Doomsday Prophecies.
Based on the latest research and data

Section 1: The Psychology of the Apocalypse
Explore why the human brain is naturally wired to look for patterns and definitive endings, a cognitive bias known as teleological thinking.
Explain how imagining a structured 'end' can ironically bring psychological comfort to people living through chaotic or unpredictable historical eras.

Section 2: Ancient Mysteries and Failed Prophecies
Travel back through history to examine famous doomsday predictions, from the Great Disappointment of 1844 to the global anxiety of Y2K and the 2012 Mayan calendar phenomenon.
Analyze the sociological impact of these failed predictions and how communities rationalized survival when the day after arrived.

Section 3: Pop Culture and the Modern Mythos
Bridge the gap to modern media, looking at how massive pop-culture franchises like the Avengers use cataclysmic events and characters like Thanos to mirror real-world societal anxieties.
Discuss how fictional apocalypses serve as a safe sandbox for audiences to process existential dread and explore human resilience.

Section 4: The Actual Science of Global Threats
Shift focus from mythological prophecies to what modern science actually says about existential risks, such as asteroid impacts, solar flares, and supervolcanoes.
Highlight the real-world scientific endeavors, like planetary defense systems and global monitoring, that work to keep these theoretical doomsday scenarios at bay.

So that's everything you need to know about The History and Science of Doomsday Prophecies.
We covered the key points:
- The fundamentals and why they matter
- Practical steps to get started
- Real-world applications and examples
- Tips for long-term success

Remember, The History and Science of Doomsday Prophecies is a journey, not a destination. Keep learning and improving!

If you enjoyed exploring the intersection of history, science, and pop culture, subscribe to the channel and share in the comments which historical prophecy you find the most fascinating.
Like this video if it helped.
Share your experience with The History and Science of Doomsday Prophecies in the comments.
", voice="neural_voice_1", speed=1, lang="en-us")
    sf.write(sys.argv[1], samples, sample_rate)
    print("KOKORO_SUCCESS")
except Exception as e:
    print(f"KOKORO_ERROR: {e}")
    sys.exit(1)
