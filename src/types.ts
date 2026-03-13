export type Camp = 'villager' | 'wolf';
export type Phase = 'setup' | 'reveal' | 'night' | 'day' | 'vote' | 'result';
export type Screen = 'reveal' | 'public' | 'private' | 'vote' | 'result';
export type RoleId = 'villager' | 'wolf' | 'seer' | 'guard' | 'witch';
export type BoardPresetId = 'starter-6' | 'crescent-8' | 'eclipse-10' | 'custom';
export type PlayerId = string;
export type PrivateChoice = PlayerId | 'abstain' | 'skip' | 'save';
export type VoteChoice = PlayerId | 'abstain';

export interface AbilityDefinition {
  id: string;
  prompt: string;
  effectType: 'kill' | 'inspect' | 'protect' | 'save' | 'poison';
  targetRule: 'alive-other' | 'none';
}

export interface RoleDefinition {
  id: RoleId;
  name: string;
  camp: Camp;
  description: string;
  priority: number;
  speechPrompt?: string;
  ability?: AbilityDefinition;
}

export interface AssignedRole {
  roleId: RoleId;
  enabled: boolean;
  exposed: boolean;
  resources?: {
    saveAvailable?: boolean;
    poisonAvailable?: boolean;
  };
}

export interface Player {
  id: PlayerId;
  seat: number;
  name: string;
  isAlive: boolean;
  identities: [AssignedRole, AssignedRole];
}

export interface NightAction {
  night: number;
  actorPlayerId: PlayerId;
  roleId: RoleId;
  effectType: 'kill' | 'inspect' | 'protect' | 'save' | 'poison';
  targetId?: PlayerId;
  note?: string;
}

export interface VoteRecord {
  day: number;
  voterId: PlayerId;
  targetId?: PlayerId;
  type: 'normal' | 'abstain';
}

export interface GameLogEvent {
  id: string;
  day: number;
  phase: Phase;
  visibility: 'public' | 'private';
  title: string;
  message: string;
  timestamp: number;
}

export interface NightQueueItem {
  playerId: PlayerId;
  roleId: RoleId;
}

export type ActiveStep =
  | { kind: 'nightAction'; playerId: PlayerId; roleId: RoleId };

export interface FlowState {
  screen: Screen;
  phase: Phase;
  day: number;
  title: string;
  publicMessage: string;
  helperText: string;
  speechText: string;
  actionLabel: string;
  revealIndex: number;
  nightQueue: NightQueueItem[];
  nightQueueIndex: number;
  activeStep?: ActiveStep;
  privateResult?: string;
  voteOrder: PlayerId[];
  voteIndex: number;
  discussionDurationSeconds: number;
  discussionRemainingSeconds: number;
  discussionEndsAt: number | null;
}

export interface RoleCounts {
  wolf: number;
  seer: number;
  guard: number;
  witch: number;
  villager: number;
}

export interface BoardDefinition {
  id: BoardPresetId;
  name: string;
  description: string;
  playerCount: number;
  discussionMinutes: number;
  roleCounts: RoleCounts;
}

export interface GameConfig {
  playerCount: number;
  playerNames: string[];
  boardId: BoardPresetId;
  boardName: string;
  discussionMinutes: number;
  roleCounts: RoleCounts;
}

export interface DraftConfig {
  playerCount: number;
  playerNames: string[];
  boardId: BoardPresetId;
  boardName: string;
  discussionMinutes: number;
  roleCounts: RoleCounts;
}

export interface ChoiceOption {
  id: PrivateChoice;
  label: string;
  description: string;
}

export interface GameState {
  id: string;
  config: GameConfig;
  players: Player[];
  flow: FlowState;
  nightActions: NightAction[];
  votes: VoteRecord[];
  logs: GameLogEvent[];
  speechEnabled: boolean;
  winner?: Camp;
  createdAt: number;
  updatedAt: number;
}
