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
const FIXED_NIGHT_ORDER: RoleId[] = ['wolf', 'seer', 'guard', 'witch'];
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
    wolfDiscussionSeconds: preset.wolfDiscussionSeconds,
    roleActionSeconds: preset.roleActionSeconds,
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
    playerNames: startFreshDraftNames(
      preset.playerCount,
      currentDraft.playerNames,
    ),
    boardId: preset.id,
    boardName: preset.name,
    discussionMinutes: preset.discussionMinutes,
    wolfDiscussionSeconds: preset.wolfDiscussionSeconds,
    roleActionSeconds: preset.roleActionSeconds,
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
    seer: clampBinary(incoming?.seer ?? 1),
    guard: clampBinary(incoming?.guard ?? 1),
    witch: clampBinary(incoming?.witch ?? 1),
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
    wolfDiscussionSeconds: draft.wolfDiscussionSeconds,
    roleActionSeconds: draft.roleActionSeconds,
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
      nightStageDurationSeconds: 0,
      nightStageRemainingSeconds: 0,
      nightStageEndsAt: null,
    },
    nightActions: [],
    votes: [],
    logs: [],
    speechEnabled: true,
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
    `狼人讨论 ${config.wolfDiscussionSeconds} 秒`,
    `其他角色 ${config.roleActionSeconds} 秒`,
  ];
}

export function getPrivateStepTargets(game: GameState, step: ActiveStep) {
  const actorCamp =
    step.roleId === 'wolf'
      ? 'wolf'
      : undefined;

  return game.players.filter((player) => {
    if (!player.isAlive) {
      return false;
    }
    if (step.playerId && player.id === step.playerId) {
      return false;
    }
    if (step.roleId === 'wolf' && actorCamp && getPlayerCamp(player) === 'wolf') {
      return false;
    }
    return true;
  });
}

export function getPrivateStepChoices(game: GameState): ChoiceOption[] {
  const step = game.flow.activeStep;
  if (!step || step.kind !== 'nightAction' || step.roleId !== 'witch') {
    return [];
  }

  const witchRole = getAssignedRole(game.players, step.playerId, 'witch');
  const attackedPlayerId = getNightKillTarget(game, game.flow.day);
  const attacked = attackedPlayerId
    ? game.players.find((player) => player.id === attackedPlayerId)
    : undefined;
  const options: ChoiceOption[] = [];

  if (attacked && witchRole?.resources?.saveAvailable) {
    options.push({
      id: 'save',
      label: `使用解药救 ${attacked.seat} 号`,
      description: `${attacked.name} 是本夜记录的击杀目标。`,
    });
  }

  options.push({
    id: 'skip',
    label: '跳过本夜',
    description: '本夜不使用药剂，等待阶段结束。',
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
    return beginManualVote(syncDiscussionTimer(game));
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
      helperText: '讨论计时进行中。线下统计投票后，在页面录入出局玩家。',
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
      helperText: '讨论计时已暂停。你可以继续讨论或直接录入投票结果。',
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
          ? '讨论时间到。线下确认票型后，在页面录入出局玩家。'
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

export function syncNightStageTimer(game: GameState) {
  if (
    game.flow.screen !== 'private' ||
    !game.flow.nightStageEndsAt ||
    !game.flow.activeStep
  ) {
    return game;
  }

  const remainingSeconds = Math.max(
    0,
    Math.ceil((game.flow.nightStageEndsAt - Date.now()) / 1000),
  );

  if (remainingSeconds === game.flow.nightStageRemainingSeconds) {
    return game;
  }

  const withTick = saveGame({
    ...game,
    flow: {
      ...game.flow,
      nightStageRemainingSeconds: remainingSeconds,
      nightStageEndsAt: remainingSeconds === 0 ? null : game.flow.nightStageEndsAt,
    },
    updatedAt: Date.now(),
  });

  if (remainingSeconds === 0) {
    return continueAfterPrivateStep(withTick);
  }

  return withTick;
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
  if (step.kind !== 'nightAction' || !choice) {
    return game;
  }

  if (game.flow.privateResult) {
    return game;
  }

  if (step.roleId === 'witch') {
    return submitWitchAction(game, step, choice);
  }

  if (choice === 'abstain' || choice === 'skip' || choice === 'save') {
    return game;
  }

  const role = getRoleDefinition(step.roleId);
  if (!role.ability) {
    return game;
  }

  const nextActions = replaceNightAction(game.nightActions, {
    night: game.flow.day,
    actorPlayerId: step.playerId ?? 'stage',
    roleId: step.roleId,
    effectType: role.ability.effectType,
    targetId: choice,
  });

  const targetPlayer = game.players.find((player) => player.id === choice);
  const privateResult =
    step.roleId === 'seer' && targetPlayer
      ? `查验结果：${targetPlayer.seat} 号 ${targetPlayer.name} 属于${
          getPlayerCamp(targetPlayer) === 'wolf' ? '狼人' : '好人'
        }阵营。`
      : '操作已记录，请放回手机并继续闭眼等待。';

  return saveGame(
    addLog(
      {
        ...game,
        nightActions: nextActions,
        flow: {
          ...game.flow,
          privateResult,
          speechText: getStageSpeech(step.roleId),
        },
        updatedAt: Date.now(),
      },
      'night',
      'private',
      `${role.name} 记录完成`,
      `${role.name} 已记录本夜目标。`,
    ),
  );
}

export function submitVote(game: GameState, choice: VoteChoice) {
  const vote: VoteRecord = {
    day: game.flow.day,
    voterId: 'manual',
    type: choice === 'abstain' ? 'abstain' : 'normal',
    targetId: choice === 'abstain' ? undefined : choice,
  };

  let players = game.players;
  let publicMessage = '白天结束，本轮无人出局。';

  if (choice !== 'abstain') {
    players = players.map((player) =>
      player.id === choice ? { ...player, isAlive: false } : player,
    );
    const target = players.find((player) => player.id === choice);
    if (target) {
      publicMessage = `白天结束，${target.seat} 号 ${target.name} 出局。`;
    }
  }

  const resolved = addLog(
    {
      ...game,
      players,
      votes: [...game.votes, vote],
      flow: {
        ...game.flow,
        screen: 'public',
        phase: 'vote',
        title: `第 ${game.flow.day} 天结算`,
        publicMessage,
        helperText: '如果游戏未结束，点击进入下一夜。',
        speechText: '白天结束。',
        actionLabel: '开始下一夜',
        discussionEndsAt: null,
      },
      updatedAt: Date.now(),
    },
    'vote',
    'public',
    '白天结果已录入',
    publicMessage,
  );

  const winner = checkWinner(resolved);
  return saveGame(winner ?? resolved);
}

function submitWitchAction(
  game: GameState,
  step: ActiveStep,
  choice: PrivateChoice,
) {
  const witchRole = getAssignedRole(game.players, step.playerId, 'witch');
  if (!witchRole) {
    return saveGame({
      ...game,
      flow: {
        ...game.flow,
        privateResult: '当前没有可用的女巫身份。',
      },
    });
  }

  if (choice === 'save') {
    const attackedPlayerId = getNightKillTarget(game, game.flow.day);
    if (!attackedPlayerId || !witchRole.resources?.saveAvailable) {
      return saveGame({
        ...game,
        flow: {
          ...game.flow,
          privateResult: '当前没有可救的击杀目标，或解药已用尽。',
        },
      });
    }

    const nextGame = updateRoleResources(game, step.playerId, 'witch', {
      saveAvailable: false,
    });
    const savedPlayer = nextGame.players.find(
      (player) => player.id === attackedPlayerId,
    );

    return saveGame(
      addLog(
        {
          ...nextGame,
          nightActions: replaceNightAction(nextGame.nightActions, {
            night: nextGame.flow.day,
            actorPlayerId: step.playerId ?? 'stage',
            roleId: 'witch',
            effectType: 'save',
            targetId: attackedPlayerId,
          }),
          flow: {
            ...nextGame.flow,
            privateResult: savedPlayer
              ? `已使用解药，${savedPlayer.seat} 号 ${savedPlayer.name} 将不会因今晚击杀出局。`
              : '已使用解药。',
            speechText: getStageSpeech('witch'),
          },
          updatedAt: Date.now(),
        },
        'night',
        'private',
        '女巫使用解药',
        '女巫记录了解药目标。',
      ),
    );
  }

  if (choice === 'skip') {
    return saveGame(
      addLog(
        {
          ...game,
          nightActions: removeNightActionsForRole(
            game.nightActions,
            game.flow.day,
            'witch',
          ),
          flow: {
            ...game.flow,
            privateResult: '你选择跳过本夜，请继续闭眼等待阶段结束。',
            speechText: getStageSpeech('witch'),
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

  if (choice !== 'abstain' && choice !== 'save' && witchRole.resources?.poisonAvailable) {
    const nextGame = updateRoleResources(game, step.playerId, 'witch', {
      poisonAvailable: false,
    });
    const poisonedPlayer = nextGame.players.find((player) => player.id === choice);

    return saveGame(
      addLog(
        {
          ...nextGame,
          nightActions: replaceNightAction(nextGame.nightActions, {
            night: nextGame.flow.day,
            actorPlayerId: step.playerId ?? 'stage',
            roleId: 'witch',
            effectType: 'poison',
            targetId: choice,
          }),
          flow: {
            ...nextGame.flow,
            privateResult: poisonedPlayer
              ? `已使用毒药，目标为 ${poisonedPlayer.seat} 号 ${poisonedPlayer.name}。`
              : '已使用毒药。',
            speechText: getStageSpeech('witch'),
          },
          updatedAt: Date.now(),
        },
        'night',
        'private',
        '女巫使用毒药',
        '女巫记录了毒药目标。',
      ),
    );
  }

  return saveGame({
    ...game,
    flow: {
      ...game.flow,
      privateResult: '毒药已用尽，请继续闭眼等待阶段结束。',
      speechText: getStageSpeech('witch'),
    },
    updatedAt: Date.now(),
  });
}

function beginNightActions(game: GameState) {
  const nightQueue = buildNightQueue(game.players);
  return startNightStage({
    ...game,
    flow: {
      ...game.flow,
      nightQueue,
      nightQueueIndex: 0,
    },
  });
}

function continueAfterPrivateStep(game: GameState) {
  const nextIndex = game.flow.nightQueueIndex + 1;
  if (nextIndex < game.flow.nightQueue.length) {
    return startNightStage({
      ...game,
      flow: {
        ...game.flow,
        nightQueueIndex: nextIndex,
      },
    });
  }

  return resolveNight(game);
}

function startNightStage(game: GameState) {
  const current = game.flow.nightQueue[game.flow.nightQueueIndex];
  if (!current) {
    return resolveNight(game);
  }

  const durationSeconds =
    current.roleId === 'wolf'
      ? game.config.wolfDiscussionSeconds
      : game.config.roleActionSeconds;
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
      activeStep: {
        kind: 'nightAction',
        playerId: current.playerId,
        roleId: current.roleId,
      },
      privateResult: undefined,
      nightStageDurationSeconds: durationSeconds,
      nightStageRemainingSeconds: durationSeconds,
      nightStageEndsAt: Date.now() + durationSeconds * 1000,
    },
    updatedAt: Date.now(),
  });
}

function resolveNight(game: GameState) {
  const tonight = game.nightActions.filter((action) => action.night === game.flow.day);
  const killTarget = getNightKillTarget(game, game.flow.day);
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

  const publicMessage = buildNightPublicMessage(nextPlayers, deathIds);

  const resolved = addLog(
    {
      ...game,
      players: nextPlayers,
      flow: {
        ...game.flow,
        screen: 'public',
        phase: 'day',
        title: `第 ${game.flow.day} 天`,
        publicMessage,
        helperText: '白天讨论开始。你可以使用计时器控场，线下统计票型后再录入出局玩家。',
        speechText: '天亮了，请睁眼。',
        actionLabel: '录入白天结果',
        activeStep: undefined,
        privateResult: undefined,
        discussionRemainingSeconds: game.flow.discussionDurationSeconds,
        discussionEndsAt: null,
        nightStageDurationSeconds: 0,
        nightStageRemainingSeconds: 0,
        nightStageEndsAt: null,
      },
      updatedAt: Date.now(),
    },
    'day',
    'public',
    `第 ${game.flow.day} 天亮`,
    publicMessage,
  );

  return checkWinner(saveGame(resolved)) ?? saveGame(resolved);
}

function beginManualVote(game: GameState) {
  return saveGame({
    ...game,
    flow: {
      ...game.flow,
      screen: 'vote',
      phase: 'vote',
      title: `第 ${game.flow.day} 天录入结果`,
      publicMessage: '请线下统计投票结果后，在页面上选择最终出局玩家。',
      helperText: '如果本轮平票或无人出局，请选择“无人出局”。',
      speechText: '请录入白天结果。',
      actionLabel: '开始下一夜',
      discussionEndsAt: null,
    },
    updatedAt: Date.now(),
  });
}

function startNightIntro(game: GameState) {
  return saveGame({
    ...game,
    flow: {
      ...game.flow,
      screen: 'public',
      phase: 'night',
      title: `第 ${game.flow.day} 夜`,
      publicMessage: '天黑请闭眼。系统会按固定顺序依次进入狼人、预言家、守卫、女巫阶段。',
      helperText: '每个阶段都会按预设倒计时执行，不会因为场上没有该角色而跳过。',
      speechText: '天黑请闭眼。',
      actionLabel: '开始夜晚流程',
      activeStep: undefined,
      privateResult: undefined,
      nightQueue: [],
      nightQueueIndex: 0,
      voteOrder: [],
      voteIndex: 0,
      discussionRemainingSeconds: game.flow.discussionDurationSeconds,
      discussionEndsAt: null,
      nightStageDurationSeconds: 0,
      nightStageRemainingSeconds: 0,
      nightStageEndsAt: null,
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
          speechText: '游戏结束。',
          actionLabel: '回到首页',
          discussionEndsAt: null,
          nightStageEndsAt: null,
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
  playerId: PlayerId | undefined,
  roleId: RoleId,
  resources: NonNullable<Player['identities'][number]['resources']>,
) {
  if (!playerId) {
    return game;
  }

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

function getAssignedRole(
  players: Player[],
  playerId: PlayerId | undefined,
  roleId: RoleId,
) {
  const player = players.find((entry) => entry.id === playerId);
  return player?.identities.find((identity) => identity.roleId === roleId);
}

function buildNightQueue(players: Player[]) {
  return FIXED_NIGHT_ORDER.map((roleId) => ({
    roleId,
    playerId: findFirstAliveRoleHolder(players, roleId),
  }));
}

function getNightPrompt(game: GameState, queueItem: NightQueueItem) {
  const role = getRoleDefinition(queueItem.roleId);
  if (queueItem.roleId !== 'witch') {
    return {
      publicMessage:
        role.speechPrompt ?? '请当前阶段对应身份的玩家接过手机。',
      helperText:
        queueItem.roleId === 'wolf'
          ? '狼人阶段内由狼人线下讨论后，在手机上直接选择本夜击杀目标。'
          : role.ability?.prompt ?? '请在本阶段完成操作。',
      speechText: getStageSpeech(queueItem.roleId),
    };
  }

  const attackedPlayerId = getNightKillTarget(game, game.flow.day);
  const attacked = attackedPlayerId
    ? game.players.find((player) => player.id === attackedPlayerId)
    : undefined;
  const witchRole = getAssignedRole(game.players, queueItem.playerId, 'witch');
  const saveText =
    attacked && witchRole?.resources?.saveAvailable
      ? `本夜被击杀目标为 ${attacked.seat} 号 ${attacked.name}，你可以选择是否使用解药。`
      : '当前没有可救目标，或解药已用尽。';
  const poisonText = witchRole?.resources?.poisonAvailable
    ? '若要使用毒药，可在下方直接选择一名其他存活玩家。'
    : '你的毒药已经使用过，本夜无法毒人。';

  return {
    publicMessage: role.speechPrompt ?? '女巫请睁眼。',
    helperText: `${saveText} ${poisonText}`,
    speechText: getStageSpeech('witch'),
  };
}

function getStageSpeech(roleId: RoleId) {
  switch (roleId) {
    case 'wolf':
      return '狼人请睁眼。';
    case 'seer':
      return '预言家请睁眼。';
    case 'guard':
      return '守卫请睁眼。';
    case 'witch':
      return '女巫请睁眼。';
    default:
      return '';
  }
}

function getNightKillTarget(game: GameState, night: number) {
  return game.nightActions.find(
    (action) =>
      action.night === night &&
      action.roleId === 'wolf' &&
      action.effectType === 'kill' &&
      action.targetId,
  )?.targetId;
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

function buildNightPublicMessage(players: Player[], deathIds: Set<PlayerId>) {
  if (deathIds.size === 0) {
    return '天亮了。昨夜没有玩家出局。';
  }

  const diedPlayers = players.filter((player) => deathIds.has(player.id));
  const labels = diedPlayers.map((player) => `${player.seat} 号 ${player.name}`);
  return `天亮了。昨夜出局玩家：${labels.join('、')}。`;
}

function replaceNightAction(actions: NightAction[], nextAction: NightAction) {
  return [
    ...actions.filter(
      (action) =>
        !(
          action.night === nextAction.night &&
          action.roleId === nextAction.roleId &&
          action.effectType === nextAction.effectType
        ),
    ),
    nextAction,
  ];
}

function removeNightActionsForRole(
  actions: NightAction[],
  night: number,
  roleId: RoleId,
) {
  return actions.filter(
    (action) => !(action.night === night && action.roleId === roleId),
  );
}

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function findFirstAliveRoleHolder(players: Player[], roleId: RoleId) {
  return players.find(
    (player) =>
      player.isAlive && player.identities.some((identity) => identity.roleId === roleId),
  )?.id;
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

function clampBinary(value: number) {
  if (value <= 0) {
    return 0;
  }
  return 1;
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
