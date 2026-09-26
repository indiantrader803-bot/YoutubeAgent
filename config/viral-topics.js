// Viral topic database — 50 topics across 5 high-RPM categories, targeting US/CA/UK/AU/DE/SG
// audiences (highest YouTube RPM markets for English content).

const CATEGORIES = [
  {
    id: 'future-ai',
    name: 'Future & AI',
    contentType: 'explainer',
    thumbnailColors: ['#FFD600', '#FF3D00', '#2979FF'],
    thumbnailText: ['2050', 'IS HERE', 'AI', 'TAKES OVER', 'TOMORROW'],
    topics: [
      { title: 'What Happens If AI Takes Every Job?' },
      { title: 'A Day in 2050' },
      { title: 'Would You Trust Robot Police?' },
      { title: 'School in 2040' },
      { title: 'The Brain Chip Revolution' },
      { title: 'Flying Cars Explained' },
      { title: 'Can AI Replace Doctors?' },
      { title: 'Living on Mars' },
      { title: "The World's First Robot Army" },
      { title: 'What If AI Controlled Earth?' }
    ]
  },
  {
    id: 'space',
    name: 'Space',
    contentType: 'explainer',
    thumbnailColors: ['#2979FF', '#FFD600', '#FF3D00'],
    thumbnailText: ['INSIDE', 'THE VOID', 'BLACK HOLE', 'SPACE', 'GALAXY'],
    topics: [
      { title: 'What Happens Inside a Black Hole?' },
      { title: 'Can Humans Survive on Mars?' },
      { title: 'If the Moon Disappeared' },
      { title: 'If the Sun Exploded' },
      { title: 'The Scariest Planet' },
      { title: "NASA's Biggest Mission" },
      { title: "James Webb's Biggest Discovery" },
      { title: 'What If Earth Spun Faster?' },
      { title: "Inside Jupiter's Storm" },
      { title: 'When Two Galaxies Collide' }
    ]
  },
  {
    id: 'dark-psychology',
    name: 'Dark Psychology',
    contentType: 'explainer',
    thumbnailColors: ['#D500F9', '#FFD600', '#FF1744'],
    thumbnailText: ['YOUR BRAIN', 'LIES', 'MIND', 'TRICKS', 'SECRETS'],
    topics: [
      { title: 'Why People Lie' },
      { title: 'How Manipulation Works' },
      { title: 'Hidden Body Language Secrets' },
      { title: 'Your Brain Tricks You' },
      { title: 'Why Fear Controls Us' },
      { title: 'Introverts vs Extroverts' },
      { title: 'How We Make Decisions' },
      { title: 'Why We Dream' },
      { title: 'The Science of Habits' },
      { title: 'Dopamine Explained' }
    ]
  },
  {
    id: 'history-what-if',
    name: 'History & What If',
    contentType: 'story',
    thumbnailColors: ['#FF6D00', '#FFD600', '#00C853'],
    thumbnailText: ['WHAT IF', 'ROME', 'LOST', 'SECRETS', 'ANCIENT'],
    topics: [
      { title: 'What If Rome Never Fell?' },
      { title: 'If Dinosaurs Returned' },
      { title: 'If Titanic Never Sank' },
      { title: 'The Secret of the Pyramids' },
      { title: 'The Last Viking' },
      { title: "The World's Largest Empire" },
      { title: "Leonardo's Lost Inventions" },
      { title: "Napoleon's Biggest Mistake" },
      { title: 'Life in Ancient Rome' },
      { title: 'A Day in the Middle Ages' }
    ]
  },
  {
    id: 'survival',
    name: 'Survival',
    contentType: 'story',
    thumbnailColors: ['#FF1744', '#FFD600', '#2962FF'],
    thumbnailText: ['SURVIVE', 'LOST', 'LAST', 'END', 'WARNING'],
    topics: [
      { title: 'If You Were Lost at Sea' },
      { title: 'If Yellowstone Erupted' },
      { title: 'Surviving a Zombie Apocalypse' },
      { title: 'If Earth Stopped Spinning' },
      { title: 'An Asteroid Is Coming' },
      { title: 'Trapped in the Deep Ocean' },
      { title: 'Lost in the Desert' },
      { title: 'One Week in Antarctica' },
      { title: 'Inside a Nuclear Bunker' },
      { title: 'If the World Flooded' }
    ]
  }
];

// Daily production plan (env-tunable):
//   1 long-form video + 3 Shorts cut from it + community-post prompts
const DAILY_PLAN = {
  longVideosPerDay: 1,
  shortsPerLong: 3,
  communityPostsPerWeek: 2,
  shortDurationSeconds: [30, 45],
  longDurationMinutes: [8, 12]
};

// Shorts are derived from the long-form script using these proven angles —
// each angle produces a self-contained Short that funnels viewers to the long video.
const SHORT_ANGLES = [
  {
    id: 'hook-twist',
    label: 'The Hook + Twist',
    instruction: 'Take the most shocking claim from the full script and build a 30-45s Short: open with the twist as a bold statement, then reveal the context that makes it true, end with a cliffhanger question driving viewers to the full video.'
  },
  {
    id: 'myth-bust',
    label: 'Myth vs Reality',
    instruction: 'Pick the biggest misconception the full script debunks. Open with "You believe X. Here is what actually happens." Deliver the real explanation in 3 fast beats, end asking which side viewers are on.'
  },
  {
    id: 'top-fact',
    label: 'Top 3 Facts Countdown',
    instruction: 'Extract the 3 most surprising facts from the full script into a countdown Short: #3 builds, #2 escalates, #1 is the payoff. End: "Full story on the channel."'
  },
  {
    id: 'what-if',
    label: 'What-If Minute',
    instruction: 'Isolate the script central "what if" scenario into one relentless 35s chain of consequences: "If X happened, then Y, then Z..." End with the impossible-to-answer question.'
  },
  {
    id: 'stat-shock',
    label: 'Stat Shock',
    instruction: 'Lead with the single most jaw-dropping number from the script ("99% of people..."). Explain why that number matters in 3 beats, then challenge viewers: "Did you know this? Comment YES or NO."'
  }
];

// US prime-time upload schedule (all times US Eastern). Long-form premieres at
// the evening peak; Shorts are staggered through the day.
const UPLOAD_SCHEDULE = {
  timezone: 'America/New_York',
  longVideoHourET: 19,        // 7 PM ET
  shortHoursET: [9, 13, 17],  // 9 AM, 1 PM, 5 PM ET
  communityPostsPerWeek: 2
};

// Highest-RPM geo targets (used for SEO language targeting + publish scheduling)
const TARGET_GEOS = ['US', 'CA', 'UK', 'AU', 'DE', 'SG'];

module.exports = {
  CATEGORIES,
  DAILY_PLAN,
  SHORT_ANGLES,
  UPLOAD_SCHEDULE,
  TARGET_GEOS
};
