// learn: the league ranks, lowest first (docs/learn.md "Leagues"). Shared by the server (league.js) and the badges (ui/badges.js).
// Ten ranks; a student starts in Iron. No money is attached to any rank: a rank is a badge and a name only.
export const TIERS = Object.freeze([
  { id: 'iron', name: 'Iron' },
  { id: 'bronze', name: 'Bronze' },
  { id: 'silver', name: 'Silver' },
  { id: 'gold', name: 'Gold' },
  { id: 'platinum', name: 'Platinum' },
  { id: 'emerald', name: 'Emerald' },
  { id: 'diamond', name: 'Diamond' },
  { id: 'masters', name: 'Masters' },
  { id: 'grandmasters', name: 'Grandmasters' },
  { id: 'challenger', name: 'Challenger' },
].map(Object.freeze));
export const tierIndex = (id) => TIERS.findIndex((t) => t.id === id);
