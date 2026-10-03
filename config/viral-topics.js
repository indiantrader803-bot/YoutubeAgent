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
      { title: 'Why You Always Pay More at Checkout' },
      { title: 'The Psychology of Waiting in Line' },
      { title: 'Why People Brag Without Shame' },
      { title: 'The Silent Way People Control You' },
      { title: 'Read a Room Like a Detective' },
      { title: 'Why Fake Experts Sound Confident' },
      { title: 'What Your Music Says About You' },
      { title: 'Why Smart People Trust the Wrong People' },
      { title: 'The Fastest Way Someone Builds Trust' },
      { title: 'Read People Before They Speak' }
    ]
  },
  {
    id: 'history-what-if',
    name: 'History & What If',
    contentType: 'story',
    thumbnailColors: ['#FF6D00', '#FFD600', '#00C853'],
    thumbnailText: ['WHAT IF', 'ROME', 'LOST', 'SECRETS', 'ANCIENT'],
    topics: [
      { title: 'If You Lived in the Roman Empire' },
      { title: 'What If Dinosaurs Never Went Extinct?' },
      { title: 'If the Internet Ended Tomorrow' },
      { title: 'The Library of Alexandria: What Was Lost?' },
      { title: 'If You Could Visit Any Century' },
      { title: 'If Aliens Found Ancient Earth' },
      { title: 'The Mystery of the Bronze Age Collapse' },
      { title: 'If Time Travel Were Real' },
      { title: 'The Lost City No One Can Explain' },
      { title: 'History\'s Biggest Unsolved Mystery' }
    ]
  },
  {
    id: 'survival',
    name: 'Survival & Challenges',
    contentType: 'story',
    thumbnailColors: ['#FF1744', '#FFD600', '#2962FF'],
    thumbnailText: ['SURVIVE', 'LOST', 'LAST', 'END', 'WARNING'],
    topics: [
      { title: 'How to Survive a Desert Island' },
      { title: 'The 3 Items You Need Most' },
      { title: 'If Animals Could Talk' },
      { title: 'What You Should Always Carry' },
      { title: 'If You Got Lost in the Forest' },
      { title: 'Seven Days Without Food' },
      { title: 'If You Were the Last Person on Earth' },
      { title: 'The Skill That Saves Lives' },
      { title: 'How to Find Water Anywhere' },
      { title: 'What to Do If a Storm Hits' }
    ]
  },
  {
    // Family-friendly kids/family animation layer — a recurring series wrapper
    // so the channel can publish "Milo's Little Adventures" educational stories
    // without duplicating the regular viral universe. Every topic is original,
    // gentle, and concept-driven (one idea per episode for tight pacing and
    // compilation-friendly episodes), which also keeps the channel on the right
    // side of "mass-produced / repetitive" review.
    id: 'milo-family',
    name: "Milo's Little Adventures (Kids & Family)",
    contentType: 'tomful-study-family',
    thumbnailColors: ['#66BB6A', '#FFEE58', '#1976D2'],
    thumbnailText: ['MILO', 'ADVENTURES', 'LEARN', 'FUN', 'FAMILY'],
    familyFriendly: true,
    copilotAgeLabel: 'madeForKids',
    topics: [
      { title: 'Milo Learns the Alphabet' },
      { title: 'Milo Counts to Ten' },
      { title: 'Milo Discovers Shapes' },
      { title: 'Milo Meets the Rainbow' },
      { title: 'Milo Finds the Colors' },
      { title: 'Milo Explores the Garden' },
      { title: 'Milo Sees the Seasons Change' },
      { title: 'Milo Learns to Share' },
      { title: 'Milo and the Friendly Stars' }
    ]
  }
];

module.exports = { CATEGORIES };
