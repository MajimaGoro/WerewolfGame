import { BOARD_PRESETS } from '../data/boards';
import { ROLE_DEFINITIONS } from '../data/roles';
import type {
  ActiveStep,
  BoardPresetId,
  ChoiceOption,
  DraftConfig,
  GameConfig,
  GameLogEvent,
  GameState,
  NightAction,
  NightQueueItem,
  Player,
  PlayerId,
  PrivateChoice,
  RoleCounts,
  RoleId,
  VoteChoice,
  VoteRecord,
} from '../types';

const STORAGE_KEY = 'werewolf-game-mvp';
const SPECIAL_ROLE_IDS: Exclude<RoleId, 'villager'>[] = ['wolf', 'seer', 'guard', 'witch'];

export function getRoleDefinition(roleId: RoleId) {
  return ROLE_DEFINITIONS[roleId];
}

export function getBoardPresets() {
  return BOARD_PRESETS;
}

export function getBoardPreset(boardId: BoardPresetId) {
  return BOARD_PRESETS.find((board) => board.id === boardId);
}

export function newDraftConfig(): DraftConfig {
  const preset = BOARD_PRESETS[0];
  return {
    playerCount: preset.playerCount,
    playerNames: startFreshDraftNames(preset.playerCount),
    boardId: preset.id,
    boardName: preset.name,
    discussionMinutes: preset.discussionMinutes,
    roleCounts: { ...preset.roleCounts },
  };
}

export function applyBoardPreset(
  currentDraft: DraftConfig,
  boardId: BoardPresetId,
): DraftConfig {
  if (boardId === 'custom') {
    return {
      ...currentDraft,
      boardId,
      boardName: '自定义板子',
      playerNames: startFreshDraftNames(
        currentDraft.playerCount,
        currentDraft.playerNames,
      ),
      roleCounts: normalizeRoleCounts(
        currentDraft.playerCount,
        currentDraft.roleCounts,
      ),
    };
  }

  const preset = getBoardPreset(boardId);
  if (!preset) {
    return currentDraft;
  }

  return {
    playerCount: preset.playerCount,
    playerNames: startFreshDraftNames(preset.playerCount, currentDraft.playerNames),
    boardId: preset.id,
    boardName: preset.name,
    discussionMinutes: preset.discussionMinutes,
    roleCounts: { ...preset.roleCounts },
  };
}

export function startFreshDraftNames(
  playerCount: number,
  currentNames: string[] = [],
) {
  return Array.from({ length: playerCount }, (_, index) => {
    return currentNames[index]?.trim() || `玩家 ${index + 1}`;
  });
}

export function normalizeRoleCounts(
  playerCount: number,
  incoming?: Partial<RoleCounts>,
): RoleCounts {
  const base = {
    wolf: Math.max(1, incoming?.wolf ?? 2),
    seer: Math.max(0, incoming?.seer ?? 1),
    guard: Math.max(0, incoming?.guard ?? 1),
    witch: Math.max(0, incoming?.witch ?? 1),
    villager: 0,
  };
  const totalSpecial = base.wolf + base.seer + base.guard + base.witch;
  const villager = Math.max(playerCount * 2 - totalSpecial, 0);
  return { ...base, villager };
}

export function getDraftVillagerCount(draft: DraftConfig) {
  return normalizeRoleCounts(draft.playerCount, draft.roleCounts).villager;
}

export function getRequiredIdentityCount(playerCount: number) {
  return playerCount * 2;
}

export function isDraftValid(draft: DraftConfig) {
  const roleCounts = normalizeRoleCounts(draft.playerCount, draft.roleCounts);
  const total =
    roleCounts.wolf +
    roleCounts.seer +
    roleCounts.guard +
    roleCounts.witch +
    roleCounts.villager;

  return total === getRequiredIdentityCount(draft.playerCount) && roleCounts.wolf > 0;
}

export function createGame(draft: DraftConfig): GameState {
  const roleCounts = normalizeRoleCounts(draft.playerCount, draft.roleCounts);
  const config: GameConfig = {
    playerCount: draft.playerCount,
    playerNames: startFreshDraftNames(draft.playerCount, draft.playerNames),
    boardId: draft.boardId,
    boardName: draft.boardName,
    discussionMinutes: draft.discussionMinutes,
    roleCounts,
  };
  const deck = shuffle(buildRoleDeck(roleCounts));
  const players = config.playerNames.map<Player>((name, index) => ({
    id: createId('player'),
    seat: index + 1,
    name,
    isAlive: true,
    identities: [
      createAssignedRole(deck[index * 2]),
      createAssignedRole(deck[index * 2 + 1]),
    ],
  }));

  const state: GameState = {
    id: createId('game'),
    config,
    players,
    flow: {
      screen: 'reveal',
      phase: 'reveal',
      day: 1,
      title: '身份发放',
      publicMessage: '请按座位顺序依次查看身份。',
      helperText: '查看后请点击确认，并把手机交给下一位玩家。',
      speechText: '请按座位顺序依次查看身份。',
      actionLabel: '下一步',
      revealIndex: 0,
      nightQueue: [],
      nightQueueIndex: 0,
      voteOrder: [],
      voteIndex: 0,
      discussionDurationSeconds: config.discussionMinutes * 60,
      discussionRemainingSeconds: config.discussionMinutes * 60,
      discussionEndsAt: null,
    },
    nightActions: [],
    votes: [],
    logs: [],
    speechEnabled: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return saveGame(
    addLog(
      state,
      'reveal',
      'public',
      '新对局已创建',
      `${config.boardName} 已装载，开始发放身份。`,
    ),
  );
}

export function loadGame() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed?.players || !parsed?.flow || !parsed?.config?.roleCounts) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function hasSavedGame() {
  return window.localStorage.getItem(STORAGE_KEY) !== null;
}

export function exportGame(game: GameState) {
  return JSON.stringify(game, null, 2);
}

export function importGame(raw: string) {
  try {
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed?.players || !parsed?.flow || !parsed?.config?.roleCounts) {
      return null;
    }
    return saveGame({ ...parsed, updatedAt: Date.now() });
  } catch {
    return null;
  }
}

export function toggleSpeech(game: GameState) {
  return saveGame({ ...game, speechEnabled: !game.speechEnabled });
}

export function getAlivePlayers(game: GameState | null) {
  if (!game) {
    return [];
  }
  return game.players.filter((player) => player.isAlive);
}

export function getPlayerCamp(player: Player) {
  return player.identities.some(
    (identity) => getRoleDefinition(identity.roleId).camp === 'wolf',
  )
    ? 'wolf'
    : 'villager';
}

export function getPlayerRoleNames(player: Player) {
  return player.identities.map((identity) => getRoleDefinition(identity.roleId).name);
}

export function getBoardSummary(config: GameConfig | DraftConfig) {
  const roleCounts = normalizeRoleCounts(config.playerCount, config.roleCounts);
  return [
    `${roleCounts.wolf} 张狼人`,
    `${roleCounts.seer} 张预言家`,
    `${roleCounts.guard} 张守卫`,
    `${roleCounts.witch} 张女巫`,
    `${roleCounts.villager} 张村民`,
  ];
}

export function getPrivateStepTargets(game: GameState, step: ActiveStep) {
  const selfId = step.playerId;
  const roleId = step.roleId;

  if (roleId === 'witch') {
    const witchRole = getAssignedRole(game.players, selfId, 'witch');
    const poisonAvailable = Boolean(witchRole?.resources?.poisonAvailable);
    if (!poisonAvailable) {
      return [];
    }
  }

  return game.players.filter((player) => player.isAlive && player.id !== selfId);
}

export function getPrivateStepChoices(game: GameState): ChoiceOption[] {
  const step = game.flow.activeStep;
  if (!step || step.kind !== 'nightAction') {
    return [];
  }

  if (step.roleId !== 'witch') {
    return [];
  }

  const witchRole = getAssignedRole(game.players, step.playerId, 'witch');
  const context = getWitchContext(game, step.playerId);
  const options: ChoiceOption[] = [];

  if (context.attackedPlayerId && witchRole?.resources?.saveAvailable) {
    const attacked = game.players.find(
      (player) => player.id === context.attackedPlayerId,
    );
    if (attacked) {
      options.push({
        id: 'save',
        label: `使用解药救 ${attacked.seat} 号`,
        description: `${attacked.name} 是今晚狼人票数最高的目标。`,
      });
    }
  }

  options.push({
    id: 'skip',
    label: '跳过本夜',
    description: '不使用药剂，直接结束女巫回合。',
  });

  return options;
}

export function submitReveal(game: GameState, confirmed: boolean) {
  const player = game.players[game.flow.revealIndex];
  if (!player) {
    return game;
  }

  if (!confirmed) {
    return saveGame({
      ...game,
      players: game.players.map((current) =>
        current.id === player.id
          ? {
              ...current,
              identities: current.identities.map((identity) => ({
                ...identity,
                exposed: true,
              })) as Player['identities'],
            }
          : current,
      ),
      updatedAt: Date.now(),
    });
  }

  const revealIndex = game.flow.revealIndex + 1;
  if (revealIndex >= game.players.length) {
    return startNightIntro(
      addLog(
        game,
        'reveal',
        'public',
        '身份发放完成',
        '所有玩家已完成身份查看。',
      ),
    );
  }

  return saveGame({
    ...game,
    flow: {
      ...game.flow,
      revealIndex,
      speechText: `请 ${revealIndex + 1} 号玩家查看身份。`,
    },
    updatedAt: Date.now(),
  });
}

export function startNextPublicStep(game: GameState) {
  if (game.flow.phase === 'night') {
    return beginNightActions(game);
  }

  if (game.flow.phase === 'day') {
    return beginVoting(syncDiscussionTimer(game));
  }

  if (game.flow.phase === 'vote') {
    return checkWinner(game) ?? startNightIntro(nextDay(game));
  }

  return game;
}

export function startDiscussionTimer(game: GameState) {
  const synced = syncDiscussionTimer(game);
  if (synced.flow.phase !== 'day' || synced.flow.discussionEndsAt) {
    return synced;
  }

  return saveGame({
    ...synced,
    flow: {
      ...synced.flow,
      discussionEndsAt:
        Date.now() + synced.flow.discussionRemainingSeconds * 1000,
      helperText: '讨论计时进行中。你可以暂停、重置，或随时进入投票。',
    },
    updatedAt: Date.now(),
  });
}

export function pauseDiscussionTimer(game: GameState) {
  const synced = syncDiscussionTimer(game);
  if (!synced.flow.discussionEndsAt) {
    return synced;
  }

  return saveGame({
    ...synced,
    flow: {
      ...synced.flow,
      discussionEndsAt: null,
      helperText: '讨论计时已暂停。你可以继续讨论或直接进入投票。',
    },
    updatedAt: Date.now(),
  });
}

export function resetDiscussionTimer(game: GameState) {
  if (game.flow.phase !== 'day') {
    return game;
  }

  return saveGame({
    ...game,
    flow: {
      ...game.flow,
      discussionEndsAt: null,
      discussionRemainingSeconds: game.flow.discussionDurationSeconds,
      helperText: '讨论计时已重置。准备好后可以重新开始。',
    },
    updatedAt: Date.now(),
  });
}

export function syncDiscussionTimer(game: GameState) {
  if (!game.flow.discussionEndsAt) {
    return game;
  }

  const remainingSeconds = Math.max(
    0,
    Math.ceil((game.flow.discussionEndsAt - Date.now()) / 1000),
  );

  if (remainingSeconds === game.flow.discussionRemainingSeconds) {
    return game;
  }

  const next = {
    ...game,
    flow: {
      ...game.flow,
      discussionRemainingSeconds: remainingSeconds,
      discussionEndsAt: remainingSeconds === 0 ? null : game.flow.discussionEndsAt,
      helperText:
        remainingSeconds === 0
          ? '讨论时间到。你可以继续讨论，也可以直接进入投票。'
          : game.flow.helperText,
    },
    updatedAt: Date.now(),
  };

  if (remainingSeconds === 0) {
    return saveGame(
      addLog(next, 'day', 'public', '讨论计时结束', '本轮讨论计时已归零。'),
    );
  }

  return saveGame(next);
}

export function formatSeconds(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function submitPrivateStep(
  game: GameState,
  step: ActiveStep,
  choice?: PrivateChoice,
) {
  if (game.flow.privateResult) {
    return continueAfterPrivateStep(game);
  }

  if (step.kind !== 'nightAction') {
    return game;
  }

  const role = getRoleDefinition(step.roleId);
  if (!role.ability) {
    return continueAfterPrivateStep(game);
  }

  if (step.roleId === 'witch') {
    return submitWitchAction(game, step, choice);
  }

  if (!choice || choice === 'abstain' || choice === 'skip' || choice === 'save') {
    return game;
  }

  const action: NightAction = {
    night: game.flow.day,
    actorPlayerId: step.playerId,
    roleId: step.roleId,
    effectType: role.ability.effectType,
    targetId: choice,
  };

  const targetPlayer = game.players.find((player) => player.id === choice);
  const privateResult =
    action.effectType === 'inspect' && targetPlayer
      ? `${targetPlayer.seat} 号 ${targetPlayer.name} 属于${
          getPlayerCamp(targetPlayer) === 'wolf' ? '狼人' : '好人'
        }阵营。`
      : '操作已记录，请把手机交回桌面。';

  return saveGame(
    addLog(
      {
        ...game,
        nightActions: [...game.nightActions, action],
        flow: {
          ...game.flow,
          privateResult,
          speechText: privateResult,
        },
        updatedAt: Date.now(),
      },
      'night',
      'private',
      `${role.name} 完成操作`,
      `${role.name} 已提交夜间操作。`,
    ),
  );
}

export function submitVote(
  game: GameState,
  voterId: PlayerId,
  choice: VoteChoice,
) {
  const vote: VoteRecord = {
    day: game.flow.day,
    voterId,
    type: choice === 'abstain' ? 'abstain' : 'normal',
    targetId: choice === 'abstain' ? undefined : choice,
  };

  const votes = [...game.votes, vote];
  const voteIndex = game.flow.voteIndex + 1;
  if (voteIndex < game.flow.voteOrder.length) {
    return saveGame({
      ...game,
      votes,
      flow: {
        ...game.flow,
        voteIndex,
        speechText: `请下一位存活玩家完成投票。`,
      },
      updatedAt: Date.now(),
    });
  }

  const resolved = resolveVote({
    ...game,
    votes,
    updatedAt: Date.now(),
  });
  const winner = checkWinner(resolved);
  return saveGame(winner ?? resolved);
}

function submitWitchAction(
  game: GameState,
  step: ActiveStep,
  choice?: PrivateChoice,
) {
  const witchContext = getWitchContext(game, step.playerId);
  const witchRole = getAssignedRole(game.players, step.playerId, 'witch');
  if (!witchRole) {
    return continueAfterPrivateStep(game);
  }

  if (choice === 'save' && witchContext.attackedPlayerId && witchRole.resources?.saveAvailable) {
    const savedPlayer = game.players.find(
      (player) => player.id === witchContext.attackedPlayerId,
    );
    const nextGame = updateRoleResources(game, step.playerId, 'witch', {
      saveAvailable: false,
    });
    return saveGame(
      addLog(
        {
          ...nextGame,
          nightActions: [
            ...nextGame.nightActions,
            {
              night: nextGame.flow.day,
              actorPlayerId: step.playerId,
              roleId: 'witch',
              effectType: 'save',
              targetId: witchContext.attackedPlayerId,
            },
          ],
          flow: {
            ...nextGame.flow,
            privateResult: savedPlayer
              ? `你使用了解药，${savedPlayer.seat} 号 ${savedPlayer.name} 将尝试存活到天亮。`
              : '你使用了解药。',
            speechText: '女巫已使用解药。',
          },
          updatedAt: Date.now(),
        },
        'night',
        'private',
        '女巫使用解药',
        '女巫选择了救人。',
      ),
    );
  }

  if (choice && choice !== 'skip' && choice !== 'save' && choice !== 'abstain' && witchRole.resources?.poisonAvailable) {
    const poisoned = game.players.find((player) => player.id === choice);
    const nextGame = updateRoleResources(game, step.playerId, 'witch', {
      poisonAvailable: false,
    });
    return saveGame(
      addLog(
        {
          ...nextGame,
          nightActions: [
            ...nextGame.nightActions,
            {
              night: nextGame.flow.day,
              actorPlayerId: step.playerId,
              roleId: 'witch',
              effectType: 'poison',
              targetId: choice,
            },
          ],
          flow: {
            ...nextGame.flow,
            privateResult: poisoned
              ? `你使用了毒药，目标锁定为 ${poisoned.seat} 号 ${poisoned.name}。`
              : '你使用了毒药。',
            speechText: '女巫已使用毒药。',
          },
          updatedAt: Date.now(),
        },
        'night',
        'private',
        '女巫使用毒药',
        '女巫选择了毒人。',
      ),
    );
  }

  return saveGame(
    addLog(
      {
        ...game,
        flow: {
          ...game.flow,
          privateResult: '你选择跳过本夜，不使用药剂。',
          speechText: '女巫选择跳过本夜。',
        },
        updatedAt: Date.now(),
      },
      'night',
      'private',
      '女巫跳过本夜',
      '女巫没有使用药剂。',
    ),
  );
}

function beginNightActions(game: GameState) {
  const nightQueue = buildNightQueue(game.players);
  if (nightQueue.length === 0) {
    return resolveNight(game);
  }

  const current = nightQueue[0];
  const prompt = getNightPrompt(game, current);

  return saveGame({
    ...game,
    flow: {
      ...game.flow,
      screen: 'private',
      phase: 'night',
      title: `第 ${game.flow.day} 夜`,
      publicMessage: prompt.publicMessage,
      helperText: prompt.helperText,
      speechText: prompt.speechText,
      nightQueue,
      nightQueueIndex: 0,
      activeStep: {
        kind: 'nightAction',
        playerId: current.playerId,
        roleId: current.roleId,
      },
      privateResult: undefined,
    },
    updatedAt: Date.now(),
  });
}

function continueAfterPrivateStep(game: GameState) {
  const nextIndex = game.flow.nightQueueIndex + 1;
  if (nextIndex < game.flow.nightQueue.length) {
    const current = game.flow.nightQueue[nextIndex];
    const prompt = getNightPrompt(game, current);

    return saveGame({
      ...game,
      flow: {
        ...game.flow,
        screen: 'private',
        nightQueueIndex: nextIndex,
        activeStep: {
          kind: 'nightAction',
          playerId: current.playerId,
          roleId: current.roleId,
        },
        publicMessage: prompt.publicMessage,
        helperText: prompt.helperText,
        speechText: prompt.speechText,
        privateResult: undefined,
      },
      updatedAt: Date.now(),
    });
  }

  return resolveNight(game);
}

function resolveNight(game: GameState) {
  const tonight = game.nightActions.filter((action) => action.night === game.flow.day);
  const protectedIds = new Set(
    tonight
      .filter((action) => action.effectType === 'protect' && action.targetId)
      .map((action) => action.targetId!),
  );
  const savedIds = new Set(
    tonight
      .filter((action) => action.effectType === 'save' && action.targetId)
      .map((action) => action.targetId!),
  );
  const poisonedIds = tonight
    .filter((action) => action.effectType === 'poison' && action.targetId)
    .map((action) => action.targetId!);
  const wolfVotes = tonight.filter(
    (action) => action.effectType === 'kill' && action.targetId,
  ) as Array<NightAction & { targetId: PlayerId }>;
  const killTarget = selectMostVotedTarget(wolfVotes);

  const deathIds = new Set<PlayerId>();
  if (killTarget && !protectedIds.has(killTarget) && !savedIds.has(killTarget)) {
    deathIds.add(killTarget);
  }
  for (const poisonedId of poisonedIds) {
    deathIds.add(poisonedId);
  }

  const nextPlayers = game.players.map((player) =>
    deathIds.has(player.id) ? { ...player, isAlive: false } : player,
  );

  const publicNotes = buildNightPublicNotes(
    game.players,
    nextPlayers,
    deathIds,
    killTarget,
    protectedIds,
    savedIds,
    wolfVotes.length,
  );

  const resolved = addLog(
    {
      ...game,
      players: nextPlayers,
      flow: {
        ...game.flow,
        screen: 'public',
        phase: 'day',
        title: `第 ${game.flow.day} 天`,
        publicMessage: publicNotes.join(' '),
        helperText: '白天讨论开始。你可以使用计时器控场，准备好后进入投票。',
        speechText: publicNotes.join(' '),
        actionLabel: '进入投票',
        activeStep: undefined,
        privateResult: undefined,
        discussionRemainingSeconds: game.flow.discussionDurationSeconds,
        discussionEndsAt: null,
      },
      updatedAt: Date.now(),
    },
    'day',
    'public',
    '天亮结果',
    publicNotes.join(' '),
  );

  return checkWinner(saveGame(resolved)) ?? saveGame(resolved);
}

function beginVoting(game: GameState) {
  const voteOrder = game.players.filter((player) => player.isAlive).map((player) => player.id);
  if (voteOrder.length === 0) {
    return checkWinner(game) ?? game;
  }

  return saveGame({
    ...game,
    flow: {
      ...game.flow,
      screen: 'vote',
      phase: 'vote',
      title: `第 ${game.flow.day} 天投票`,
      publicMessage: '请依次完成白天投票。',
      helperText: '每位存活玩家依次在手机上完成一次投票。',
      speechText: '请依次完成白天投票。',
      actionLabel: '开始下一夜',
      voteOrder,
      voteIndex: 0,
      discussionEndsAt: null,
    },
    updatedAt: Date.now(),
  });
}

function resolveVote(game: GameState) {
  const todayVotes = game.votes.filter((vote) => vote.day === game.flow.day);
  const targetId = selectMostVotedTarget(
    todayVotes
      .filter((vote) => vote.type === 'normal' && vote.targetId)
      .map((vote) => ({ targetId: vote.targetId! })),
  );

  let players = game.players;
  let publicMessage = '投票结束，本轮无人出局。';

  if (targetId) {
    players = players.map((player) =>
      player.id === targetId ? { ...player, isAlive: false } : player,
    );
    const target = players.find((player) => player.id === targetId);
    if (target) {
      publicMessage = `投票结束，${target.seat} 号 ${target.name} 被放逐出局。`;
    }
  }

  return addLog(
    {
      ...game,
      players,
      flow: {
        ...game.flow,
        screen: 'public',
        phase: 'vote',
        title: `第 ${game.flow.day} 天结算`,
        publicMessage,
        helperText: '如果游戏未结束，点击进入下一夜。',
        speechText: publicMessage,
        actionLabel: '开始下一夜',
      },
      updatedAt: Date.now(),
    },
    'vote',
    'public',
    '白天投票结果',
    publicMessage,
  );
}

function startNightIntro(game: GameState) {
  return saveGame({
    ...game,
    flow: {
      ...game.flow,
      screen: 'public',
      phase: 'night',
      title: `第 ${game.flow.day} 夜`,
      publicMessage: '天黑请闭眼。点击后系统会依次唤醒拥有夜间技能的玩家。',
      helperText: '同一玩家若拥有多个夜间身份，系统会按顺序逐个提示。',
      speechText: '天黑请闭眼。系统将依次唤醒拥有夜间技能的玩家。',
      actionLabel: '进入夜晚行动',
      activeStep: undefined,
      privateResult: undefined,
      nightQueue: [],
      nightQueueIndex: 0,
      voteOrder: [],
      voteIndex: 0,
      discussionRemainingSeconds: game.flow.discussionDurationSeconds,
      discussionEndsAt: null,
    },
    updatedAt: Date.now(),
  });
}

function nextDay(game: GameState) {
  return saveGame({
    ...game,
    flow: {
      ...game.flow,
      day: game.flow.day + 1,
    },
    updatedAt: Date.now(),
  });
}

function checkWinner(game: GameState) {
  const alivePlayers = game.players.filter((player) => player.isAlive);
  const wolfCount = alivePlayers.filter((player) => getPlayerCamp(player) === 'wolf').length;
  const villagerCount = alivePlayers.length - wolfCount;

  if (wolfCount === 0) {
    return finishGame(game, 'villager', '好人阵营获胜。所有狼人身份玩家都已出局。');
  }

  if (wolfCount >= villagerCount) {
    return finishGame(game, 'wolf', '狼人阵营获胜。当前存活狼人不少于其他玩家。');
  }

  return undefined;
}

function finishGame(
  game: GameState,
  winner: 'villager' | 'wolf',
  message: string,
) {
  return saveGame(
    addLog(
      {
        ...game,
        winner,
        flow: {
          ...game.flow,
          screen: 'result',
          phase: 'result',
          title: '游戏结束',
          publicMessage: message,
          helperText: '你可以查看完整公开日志和隐藏夜晚日志进行复盘。',
          speechText: message,
          actionLabel: '回到首页',
          discussionEndsAt: null,
        },
        updatedAt: Date.now(),
      },
      'result',
      'public',
      '胜负已判定',
      message,
    ),
  );
}

function createAssignedRole(roleId: RoleId) {
  if (roleId === 'witch') {
    return {
      roleId,
      enabled: true,
      exposed: false,
      resources: {
        saveAvailable: true,
        poisonAvailable: true,
      },
    };
  }

  return {
    roleId,
    enabled: true,
    exposed: false,
  };
}

function updateRoleResources(
  game: GameState,
  playerId: PlayerId,
  roleId: RoleId,
  resources: NonNullable<Player['identities'][number]['resources']>,
) {
  return {
    ...game,
    players: game.players.map((player) => {
      if (player.id !== playerId) {
        return player;
      }

      return {
        ...player,
        identities: player.identities.map((identity) =>
          identity.roleId === roleId
            ? {
                ...identity,
                resources: {
                  ...identity.resources,
                  ...resources,
                },
              }
            : identity,
        ) as Player['identities'],
      };
    }),
  };
}

function getAssignedRole(players: Player[], playerId: PlayerId, roleId: RoleId) {
  const player = players.find((entry) => entry.id === playerId);
  return player?.identities.find((identity) => identity.roleId === roleId);
}

function getWitchContext(game: GameState, witchPlayerId: PlayerId) {
  const tonight = game.nightActions.filter((action) => action.night === game.flow.day);
  const wolfVotes = tonight.filter(
    (action) => action.effectType === 'kill' && action.targetId,
  ) as Array<NightAction & { targetId: PlayerId }>;
  const attackedPlayerId = selectMostVotedTarget(wolfVotes);

  return {
    attackedPlayerId,
    witchRole: getAssignedRole(game.players, witchPlayerId, 'witch'),
  };
}

function buildNightQueue(players: Player[]) {
  const queue: NightQueueItem[] = [];

  players
    .filter((player) => player.isAlive)
    .forEach((player) => {
      player.identities.forEach((identity) => {
        const role = getRoleDefinition(identity.roleId);
        if (!identity.enabled || !role.ability) {
          return;
        }

        if (
          identity.roleId === 'witch' &&
          !identity.resources?.saveAvailable &&
          !identity.resources?.poisonAvailable
        ) {
          return;
        }

        queue.push({
          playerId: player.id,
          roleId: identity.roleId,
        });
      });
    });

  return queue.sort((left, right) => {
    const leftRole = getRoleDefinition(left.roleId);
    const rightRole = getRoleDefinition(right.roleId);
    if (leftRole.priority === rightRole.priority) {
      const leftPlayer = players.find((player) => player.id === left.playerId);
      const rightPlayer = players.find((player) => player.id === right.playerId);
      return (leftPlayer?.seat ?? 0) - (rightPlayer?.seat ?? 0);
    }
    return leftRole.priority - rightRole.priority;
  });
}

function getNightPrompt(game: GameState, queueItem: NightQueueItem) {
  const role = getRoleDefinition(queueItem.roleId);
  if (queueItem.roleId !== 'witch') {
    return {
      publicMessage:
        role.speechPrompt ?? '请当前被系统唤醒的玩家接过手机。',
      helperText: role.ability?.prompt ?? '完成你的夜间动作。',
      speechText: role.speechPrompt ?? '请当前被系统唤醒的玩家接过手机。',
    };
  }

  const context = getWitchContext(game, queueItem.playerId);
  const witchRole = getAssignedRole(game.players, queueItem.playerId, 'witch');
  const attackedPlayer = context.attackedPlayerId
    ? game.players.find((player) => player.id === context.attackedPlayerId)
    : undefined;
  const saveText =
    attackedPlayer && witchRole?.resources?.saveAvailable
      ? `今晚狼人票数最高的目标是 ${attackedPlayer.seat} 号 ${attackedPlayer.name}。`
      : '今晚没有明确的狼人目标，或解药已用尽。';
  const poisonText = witchRole?.resources?.poisonAvailable
    ? '你仍然拥有毒药，可以选择任意其他存活玩家。'
    : '你的毒药已经使用过，本夜无法毒人。';

  return {
    publicMessage: role.speechPrompt ?? '请拥有女巫身份的玩家接过手机。',
    helperText: `${saveText} ${poisonText}`,
    speechText: role.speechPrompt ?? '请拥有女巫身份的玩家接过手机。',
  };
}

function buildRoleDeck(roleCounts: RoleCounts) {
  const deck: RoleId[] = [];

  for (const roleId of SPECIAL_ROLE_IDS) {
    const count = roleCounts[roleId];
    for (let index = 0; index < count; index += 1) {
      deck.push(roleId);
    }
  }

  for (let index = 0; index < roleCounts.villager; index += 1) {
    deck.push('villager');
  }

  return deck;
}

function buildNightPublicNotes(
  previousPlayers: Player[],
  nextPlayers: Player[],
  deathIds: Set<PlayerId>,
  killTarget: PlayerId | undefined,
  protectedIds: Set<PlayerId>,
  savedIds: Set<PlayerId>,
  wolfVoteCount: number,
) {
  const notes: string[] = ['天亮了。'];

  if (deathIds.size === 0) {
    if (!killTarget && wolfVoteCount > 1) {
      notes.push('昨夜狼人意见不统一，没有造成伤亡。');
    } else if (killTarget && (protectedIds.has(killTarget) || savedIds.has(killTarget))) {
      notes.push('昨夜有人遭遇袭击，但最终无人出局。');
    } else {
      notes.push('昨夜是平安夜，没有玩家出局。');
    }
    return notes;
  }

  const diedPlayers = nextPlayers.filter((player) => deathIds.has(player.id));
  const labels = diedPlayers.map((player) => `${player.seat} 号 ${player.name}`);
  notes.push(`昨夜出局的玩家为：${labels.join('、')}。`);

  const poisonedOnly = diedPlayers.filter((player) => player.id !== killTarget);
  if (poisonedOnly.length > 0) {
    const poisonNames = poisonedOnly.map((player) => `${player.seat} 号`).join('、');
    notes.push(`其中 ${poisonNames} 的出局可能与女巫毒药有关。`);
  }

  const revived = previousPlayers.find(
    (player) => player.id === killTarget && player.isAlive && !deathIds.has(player.id),
  );
  if (revived && savedIds.has(revived.id)) {
    notes.push('夜间也可能有人被救回。');
  }

  return notes;
}

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function selectMostVotedTarget<T extends { targetId: PlayerId }>(entries: T[]) {
  if (entries.length === 0) {
    return undefined;
  }

  const counts = new Map<PlayerId, number>();
  for (const entry of entries) {
    counts.set(entry.targetId, (counts.get(entry.targetId) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((left, right) => {
    if (right[1] === left[1]) {
      return left[0].localeCompare(right[0]);
    }
    return right[1] - left[1];
  });

  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
    return undefined;
  }

  return sorted[0][0];
}

function addLog(
  game: GameState,
  phase: GameLogEvent['phase'],
  visibility: GameLogEvent['visibility'],
  title: string,
  message: string,
) {
  return {
    ...game,
    logs: [
      ...game.logs,
      {
        id: createId('log'),
        day: game.flow.day,
        phase,
        visibility,
        title,
        message,
        timestamp: Date.now(),
      },
    ],
  };
}

function saveGame(game: GameState) {
  const next = {
    ...game,
    updatedAt: Date.now(),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
