import type { BoardDefinition } from '../types';

export const BOARD_PRESETS: BoardDefinition[] = [
  {
    id: 'starter-6',
    name: '新月 6 人局',
    description: '适合快速上手的轻量板子，带预言家、守卫和女巫。',
    playerCount: 6,
    discussionMinutes: 3,
    roleCounts: {
      wolf: 2,
      seer: 1,
      guard: 1,
      witch: 1,
      villager: 7,
    },
  },
  {
    id: 'crescent-8',
    name: '弦月 8 人局',
    description: '狼队压力更平衡，白天讨论空间更大。',
    playerCount: 8,
    discussionMinutes: 4,
    roleCounts: {
      wolf: 3,
      seer: 1,
      guard: 1,
      witch: 1,
      villager: 10,
    },
  },
  {
    id: 'eclipse-10',
    name: '食相 10 人局',
    description: '更接近完整线下主持体验，适合长局。',
    playerCount: 10,
    discussionMinutes: 5,
    roleCounts: {
      wolf: 4,
      seer: 1,
      guard: 1,
      witch: 1,
      villager: 13,
    },
  },
];
