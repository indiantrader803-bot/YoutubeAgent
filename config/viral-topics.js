// High-Engagement Gaming & Viral Culture Topic Database
// Re-engineered specifically for @BROblox audience:
// Target Audience: Gamers, GTA 6 fans, Roblox players, Streamer highlight watchers (US/CA/UK/AU)

const CATEGORIES = [
  {
    id: 'gta6-gaming',
    name: 'GTA 6 & Open World Gaming',
    contentType: 'story',
    thumbnailColors: ['#FF007F', '#00F0FF', '#FFE600'],
    thumbnailText: ['GTA 6', 'LEAKS', 'MAP', 'SECRET', 'ROCKS'],
    topics: [
      { title: 'Everything Rockstar Is Hiding in GTA 6' },
      { title: 'The Insane Map Size of GTA 6 Explained' },
      { title: 'Top 5 GTA 6 Features That Will Break the Internet' },
      { title: 'Will GTA 6 Cost 100 Dollars? The Truth' },
      { title: 'Crazy Details in GTA 6 You Completely Missed' },
      { title: 'GTA 6 Vice City Easter Eggs You Need to See' },
      { title: 'Why GTA 6 Physics Will Change Gaming Forever' },
      { title: 'The Most Dangerous Gangs in GTA 6 Vice City' },
      { title: 'Secret Weapons Confirmed for GTA 6' },
      { title: 'GTA 6 Launch Date Confirmed? What We Know' }
    ]
  },
  {
    id: 'roblox-viral',
    name: 'Roblox Mysteries & Viral Moments',
    contentType: 'story',
    thumbnailColors: ['#FF1744', '#00E676', '#FFEA00'],
    thumbnailText: ['ROBLOX', 'SCARY', 'GLITCH', 'BANNED', 'MYSTERY'],
    topics: [
      { title: 'The Darkest Unsolved Mystery in Roblox History' },
      { title: 'Roblox Games That Got Banned Instantly' },
      { title: 'The Rarest Item in Roblox Nobody Can Buy' },
      { title: 'Crazy Roblox Glitches Players Abused for Millions' },
      { title: 'Scariest Roblox Games That Feel Illegal to Play' },
      { title: 'The Richest Roblox Player of All Time' },
      { title: 'What Happened to the Most Famous Roblox Hacker?' },
      { title: 'Roblox Myths That Turned Out to Be Real' },
      { title: 'Insane Secrets Hidden in Popular Roblox Games' },
      { title: 'Why This Roblox Update Shocked Millions' }
    ]
  },
  {
    id: 'streamer-culture',
    name: 'Top Streamers & Viral Moments',
    contentType: 'explainer',
    thumbnailColors: ['#7C4DFF', '#FF0055', '#00E5FF'],
    thumbnailText: ['STREAMER', 'CLUTCH', 'FAIL', 'CAUGHT', 'INSANE'],
    topics: [
      { title: 'Funniest Streamer Fails Caught on Live Broadcast' },
      { title: 'When Streamers Got Banned for the Craziest Reasons' },
      { title: 'Top 5 Most Insane Streamer Clutches of All Time' },
      { title: 'The Biggest Donations in Live Stream History' },
      { title: 'When Streamers Regretted What They Said Instantly' },
      { title: 'Most Shocking Moments in YouTube Stream History' },
      { title: 'Streamers Who Won Impossible Bets Live' },
      { title: 'Unbelievable Gaming Records That Will Never Be Broken' },
      { title: 'When Streamers Forgot the Camera Was On' },
      { title: 'The Most Viral Gaming Moments of the Year' }
    ]
  },
  {
    id: 'gaming-myths',
    name: 'Gaming Mysteries & Urban Legends',
    contentType: 'explainer',
    thumbnailColors: ['#D500F9', '#FFD600', '#00B0FF'],
    thumbnailText: ['GAMING', 'MYTHS', 'SOLVED', 'SECRET', 'HIDDEN'],
    topics: [
      { title: 'Scariest Easter Eggs Ever Found in Video Games' },
      { title: 'Gaming Urban Legends That Actually Turned Out True' },
      { title: 'The Secret Ending Nobody Unlocked for 10 Years' },
      { title: 'Creepiest Unused Files Hidden in Video Games' },
      { title: 'Video Games That Broke the Fourth Wall Terrifyingly' },
      { title: 'Why This Game Level Was Banned Worldwide' },
      { title: 'Unsolved Video Game Mysteries That Keep Gamers Awake' },
      { title: 'The Most Feared Boss Fight in Gaming History' },
      { title: 'Secret Developer Rooms Found in Video Games' },
      { title: 'Gaming Secrets That Took Decades to Find' }
    ]
  }
];

const SHORT_ANGLES = [
  { id: 'hook-twist', label: 'Insane Twist', preview: 'A sudden shock or unexpected moment in the gameplay.' },
  { id: 'myth-bust', label: 'Myth vs Fact', preview: 'Exposing a popular gaming rumor or secret.' },
  { id: 'top-fact', label: 'Top 3 Moments', preview: 'Fast-paced countdown of the craziest events.' },
  { id: 'what-if', label: 'What If', preview: 'What happens if you break the game mechanics.' },
  { id: 'stat-shock', label: 'Mind-Blowing Stat', preview: 'An unbelievable stat that shocks every gamer.' }
];

const DAILY_PLAN = {
  longVideosPerDay: 1,
  shortsPerLong: 3
};

const UPLOAD_SCHEDULE = {
  timezone: 'America/New_York',
  longVideoHourET: 19,
  shortHoursET: [9, 13, 17]
};

const TARGET_GEOS = ['US', 'CA', 'UK', 'AU', 'IN', 'SG', 'PH', 'DE'];

module.exports = { CATEGORIES, DAILY_PLAN, SHORT_ANGLES, UPLOAD_SCHEDULE, TARGET_GEOS };
