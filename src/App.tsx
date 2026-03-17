import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import './App.css';
import {
  applyBoardPreset,
  createGame,
  exportGame,
  formatSeconds,
  getAlivePlayers,
  getBoardPresets,
  getBoardSummary,
  getDraftVillagerCount,
  getIdentityLifeSummary,
  getPlayerCamp,
  getPlayerRoleNames,
  getPrivateStepChoices,
  getPrivateStepTargets,
  getRoleDefinition,
  hasSavedGame,
  importGame,
  isDraftValid,
  loadGame,
  newDraftConfig,
  normalizeRoleCounts,
  pauseDiscussionTimer,
  resetDiscussionTimer,
  startDiscussionTimer,
  startFreshDraftNames,
  startNextPublicStep,
  submitPrivateStep,
  submitReveal,
  submitVote,
  swapCurrentRevealIdentities,
  syncDiscussionTimer,
  syncNightStageTimer,
  toggleSpeech,
} from './lib/game';
import type { BoardPresetId, DraftConfig, GameState, Player, RoleId } from './types';

const SAVE_FILE_NAME = 'werewolf-mvp-save.json';
const PRESETS = getBoardPresets();

function App() {
  const [game, setGame] = useState<GameState | null>(() => loadGame());
  const [draft, setDraft] = useState<DraftConfig>(() => newDraftConfig());
  const [importError, setImportError] = useState('');
  const [showPrivateLogs, setShowPrivateLogs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const speak = useCallback((text: string) => {
    if (!text || !window.speechSynthesis) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1;

    const preferredVoice = window.speechSynthesis
      .getVoices()
      .find((voice) => voice.lang.toLowerCase().includes('zh'));

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    window.speechSynthesis.speak(utterance);
  }, []);

  useEffect(() => {
    if (!game) {
      return;
    }

    if (!game.speechEnabled && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, [game?.speechEnabled, game]);

  useEffect(() => {
    if (!game?.speechEnabled) {
      return;
    }

    speak(game.flow.speechText);
  }, [game?.flow.speechNonce, game?.flow.speechText, game?.speechEnabled, speak]);

  useEffect(() => {
    if (!game?.flow.discussionEndsAt) {
      return;
    }

    const timerId = window.setInterval(() => {
      setGame((current) => (current ? syncDiscussionTimer(current) : current));
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [game?.flow.discussionEndsAt]);

  useEffect(() => {
    if (!game?.flow.nightStageEndsAt) {
      return;
    }

    const timerId = window.setInterval(() => {
      setGame((current) => (current ? syncNightStageTimer(current) : current));
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [game?.flow.nightStageEndsAt]);

  useEffect(() => {
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const alivePlayers = useMemo(() => getAlivePlayers(game), [game]);
  const draftIsValid = isDraftValid(draft);
  const draftRoleCounts = normalizeRoleCounts(draft.playerCount, draft.roleCounts);
  const draftSummary = getBoardSummary({
    ...draft,
    roleCounts: draftRoleCounts,
  });

  const currentRevealPlayer =
    game?.flow.screen === 'reveal'
      ? game.players[game.flow.revealIndex]
      : undefined;

  const currentTargets = useMemo(() => {
    if (!game?.flow.activeStep || game.flow.screen !== 'private') {
      return [];
    }
    return getPrivateStepTargets(game, game.flow.activeStep);
  }, [game]);

  const privateChoices = useMemo(() => {
    if (!game || game.flow.screen !== 'private') {
      return [];
    }
    return getPrivateStepChoices(game);
  }, [game]);

  const visibleLogs = useMemo(() => {
    if (!game) {
      return [];
    }
    return showPrivateLogs
      ? game.logs
      : game.logs.filter((log) => log.visibility === 'public');
  }, [game, showPrivateLogs]);

  const updatePlayerName = (index: number, name: string) => {
    setDraft((current) => {
      const nextNames = [...current.playerNames];
      nextNames[index] = name;
      return { ...current, playerNames: nextNames };
    });
  };

  const handlePresetChange = (boardId: BoardPresetId) => {
    setDraft((current) => applyBoardPreset(current, boardId));
  };

  const handlePlayerCountChange = (value: number) => {
    setDraft((current) => ({
      ...current,
      boardId: 'custom',
      boardName: '自定义板子',
      playerCount: value,
      playerNames: startFreshDraftNames(value, current.playerNames),
      roleCounts: normalizeRoleCounts(value, current.roleCounts),
    }));
  };

  const updateCustomRoleCount = (
    roleId: Exclude<RoleId, 'villager'>,
    value: number,
  ) => {
    setDraft((current) => ({
      ...current,
      boardId: 'custom',
      boardName: '自定义板子',
      roleCounts: normalizeRoleCounts(current.playerCount, {
        ...current.roleCounts,
        [roleId]: Math.max(0, value),
      }),
    }));
  };

  const handleDiscussionMinutesChange = (minutes: number) => {
    setDraft((current) => ({
      ...current,
      discussionMinutes: minutes,
    }));
  };

  const handleNightSecondsChange = (
    key:
      | 'wolfDiscussionSeconds'
      | 'roleActionSeconds'
      | 'nightIntroSeconds'
      | 'roleTransitionSeconds',
    value: number,
  ) => {
    const minValue =
      key === 'nightIntroSeconds' || key === 'roleTransitionSeconds' ? 1 : 5;

    setDraft((current) => ({
      ...current,
      boardId: 'custom',
      boardName: '自定义板子',
      [key]: Math.max(minValue, value),
    }));
  };

  const handleStartGame = () => {
    if (!draftIsValid) {
      return;
    }
    setGame(createGame(draft));
    setImportError('');
    setShowPrivateLogs(false);
  };

  const handleContinue = () => {
    const saved = loadGame();
    if (saved) {
      setGame(saved);
      setImportError('');
    }
  };

  const handleExport = () => {
    if (!game) {
      return;
    }

    const blob = new Blob([exportGame(game)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = SAVE_FILE_NAME;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    const imported = importGame(text);
    if (!imported) {
      setImportError('导入失败，请确认文件来自这个应用。');
      event.target.value = '';
      return;
    }

    setGame(imported);
    setImportError('');
    setShowPrivateLogs(false);
    event.target.value = '';
  };

  if (!game) {
    return (
      <main className="app-shell">
        <section className="hero-panel">
          <div className="eyebrow">Single Device Host</div>
          <h1>双身份狼人杀自动主持</h1>
          <p className="lead">
            单手机、无真人 DM、固定语音播报与夜晚缓冲可配置的线下主持网页。
          </p>
        </section>

        <section className="setup-layout">
          <section className="card setup-card">
            <div className="section-title">板子选择</div>
            <div className="preset-grid">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={`preset-card ${draft.boardId === preset.id ? 'selected' : ''}`}
                  onClick={() => handlePresetChange(preset.id)}
                >
                  <strong>{preset.name}</strong>
                  <span>{preset.description}</span>
                  <small>
                    {preset.playerCount} 人 / {preset.discussionMinutes} 分钟讨论
                  </small>
                </button>
              ))}

              <button
                className={`preset-card ${draft.boardId === 'custom' ? 'selected' : ''}`}
                onClick={() => handlePresetChange('custom')}
              >
                <strong>自定义板子</strong>
                <span>手动调整玩家人数、夜晚阶段时长和身份数量。</span>
                <small>适合按你们线下习惯微调流程</small>
              </button>
            </div>

            <div className="field-row">
              <label className="field">
                <span>玩家人数</span>
                <select
                  value={draft.playerCount}
                  onChange={(event) => handlePlayerCountChange(Number(event.target.value))}
                >
                  {[6, 7, 8, 9, 10].map((count) => (
                    <option key={count} value={count}>
                      {count} 人
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>讨论时长</span>
                <select
                  value={draft.discussionMinutes}
                  onChange={(event) =>
                    handleDiscussionMinutesChange(Number(event.target.value))
                  }
                >
                  {[2, 3, 4, 5, 6, 8].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} 分钟
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>狼人讨论时间</span>
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={draft.wolfDiscussionSeconds}
                  onChange={(event) =>
                    handleNightSecondsChange(
                      'wolfDiscussionSeconds',
                      Number(event.target.value),
                    )
                  }
                />
              </label>

              <label className="field">
                <span>其他角色时间</span>
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={draft.roleActionSeconds}
                  onChange={(event) =>
                    handleNightSecondsChange(
                      'roleActionSeconds',
                      Number(event.target.value),
                    )
                  }
                />
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>入夜等待时间</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={draft.nightIntroSeconds}
                  onChange={(event) =>
                    handleNightSecondsChange(
                      'nightIntroSeconds',
                      Number(event.target.value),
                    )
                  }
                />
              </label>

              <label className="field">
                <span>角色切换等待</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={draft.roleTransitionSeconds}
                  onChange={(event) =>
                    handleNightSecondsChange(
                      'roleTransitionSeconds',
                      Number(event.target.value),
                    )
                  }
                />
              </label>
            </div>

            {draft.boardId === 'custom' ? (
              <div className="custom-grid">
                {([
                  ['wolf', '狼人'],
                  ['seer', '预言家'],
                  ['guard', '守卫'],
                  ['witch', '女巫'],
                ] as const).map(([roleId, label]) => (
                  <label className="field" key={roleId}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min={roleId === 'wolf' ? 1 : 0}
                      max={roleId === 'wolf' ? draft.playerCount * 2 : 1}
                      value={draft.roleCounts[roleId]}
                      onChange={(event) =>
                        updateCustomRoleCount(roleId, Number(event.target.value))
                      }
                    />
                  </label>
                ))}

                <div className="summary-chip">
                  <span>自动补足</span>
                  <strong>{getDraftVillagerCount(draft)} 张村民</strong>
                </div>
              </div>
            ) : null}

            <div className="name-grid">
              {draft.playerNames.map((name, index) => (
                <label className="field" key={index}>
                  <span>{index + 1} 号玩家</span>
                  <input
                    type="text"
                    value={name}
                    placeholder={`玩家 ${index + 1}`}
                    onChange={(event) => updatePlayerName(index, event.target.value)}
                  />
                </label>
              ))}
            </div>

            <div className="button-row">
              <button className="primary" disabled={!draftIsValid} onClick={handleStartGame}>
                开始新对局
              </button>
              {hasSavedGame() ? (
                <button className="secondary" onClick={handleContinue}>
                  继续上次对局
                </button>
              ) : null}
              <button className="ghost" onClick={() => fileInputRef.current?.click()}>
                导入存档
              </button>
              <input
                ref={fileInputRef}
                hidden
                type="file"
                accept="application/json"
                onChange={handleImport}
              />
            </div>

            {importError ? <p className="error-text">{importError}</p> : null}
          </section>

          <aside className="card setup-side">
            <div className="section-title">当前板子摘要</div>
            <h2>{draft.boardName}</h2>
            <p className="helper-text">
              双身份总数需要正好等于 {draft.playerCount * 2}。当前配置会自动用村民补足缺口。
            </p>
            <div className="summary-list">
              {draftSummary.map((item) => (
                <div className="summary-chip" key={item}>
                  {item}
                </div>
              ))}
            </div>

            <div className="info-block">
              <strong>当前可用角色</strong>
              <p>狼人、预言家、守卫、女巫、村民</p>
            </div>

            <div className="info-block">
              <strong>主持模式</strong>
              <p>网页负责固定顺序播报、阶段倒计时和结果记录，白天票型仍由线下自行统计。</p>
            </div>

            <div className="info-block">
              <strong>双身份规则</strong>
              <p>玩家每次只会失去一个身份。两个身份都死亡后才算真正出局，不能再发言或投票。</p>
            </div>

            <div className="info-block">
              <strong>夜晚节奏</strong>
              <p>点击开始夜晚流程后才会播报“天黑请闭眼”，并且角色闭眼与下一位睁眼之间会自动保留可配置缓冲时间。</p>
            </div>

            <div className="info-block">
              <strong>当前角色规则</strong>
              <p>狼人可自刀，守卫可自守，女巫只有一瓶毒药且用完后不再显示毒人选项。</p>
            </div>
          </aside>
        </section>
      </main>
    );
  }

  const discussionTimerRunning = Boolean(game.flow.discussionEndsAt);
  const nightTimerRunning = Boolean(game.flow.nightStageEndsAt);
  const boardSummary = getBoardSummary(game.config);
  const revealReady = currentRevealPlayer?.identities.every((identity) => identity.exposed);
  const waitingNightStage =
    game.flow.screen === 'private' &&
    (game.flow.nightStageMode === 'closing' ||
      game.flow.nightStageMode === 'transition');
  const nightIntroRunning =
    game.flow.screen === 'public' &&
    game.flow.phase === 'night' &&
    game.flow.nightStageMode === 'intro' &&
    nightTimerRunning;

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <div className="eyebrow">
            {game.config.boardName} / 第 {game.flow.day} {game.flow.phase === 'night' ? '夜' : '天'}
          </div>
          <h1>{game.flow.title}</h1>
          <p className="helper-text top-helper">{game.flow.publicMessage}</p>
        </div>

        <div className="top-actions">
          <button
            className="ghost"
            onClick={() => setGame((current) => (current ? toggleSpeech(current) : current))}
          >
            {game.speechEnabled ? '关闭语音' : '开启语音'}
          </button>
          <button className="ghost" onClick={() => speak(game.flow.speechText)}>
            重播语音
          </button>
          <button className="ghost" onClick={handleExport}>
            导出存档
          </button>
          <button className="danger" onClick={() => setGame(null)}>
            返回首页
          </button>
        </div>
      </header>

      <section className="board-ribbon">
        {boardSummary.map((item) => (
          <span className="summary-chip" key={item}>
            {item}
          </span>
        ))}
      </section>

      <section className="status-grid">
        {game.players.map((player) => (
          <PlayerCard key={player.id} player={player} revealRoles={game.flow.screen === 'result'} />
        ))}
      </section>

      {game.flow.screen === 'reveal' && currentRevealPlayer ? (
        <section className="card reveal-card">
          <div className="section-title">身份发放</div>
          <p className="lead-tight">
            请 {currentRevealPlayer.seat} 号玩家 <strong>{currentRevealPlayer.name}</strong> 拿到手机查看身份。
          </p>
          <p className="helper-text">默认上身份会先失去。若你希望先保留下方身份，可以先交换顺序再确认。</p>
          <div className="identity-stack">
            {currentRevealPlayer.identities.map((identity, index) => (
              <div className="identity-card" key={`${currentRevealPlayer.id}-${index}`}>
                <div className="identity-label">{index === 0 ? '上身份' : '下身份'}</div>
                <div className="identity-name">
                  {identity.exposed ? getRoleDefinition(identity.roleId).name : '点击按钮后显示'}
                </div>
                <p>
                  {identity.exposed
                    ? getRoleDefinition(identity.roleId).description
                    : '其余玩家请回避视线。'}
                </p>
              </div>
            ))}
          </div>
          <div className="button-row">
            {!revealReady ? (
              <button
                className="primary"
                onClick={() => setGame((current) => (current ? submitReveal(current, false) : current))}
              >
                显示本人的双身份
              </button>
            ) : (
              <>
                <button
                  className="secondary"
                  onClick={() =>
                    setGame((current) =>
                      current ? swapCurrentRevealIdentities(current) : current,
                    )
                  }
                >
                  交换上 / 下身份
                </button>
                <button
                  className="primary"
                  onClick={() => setGame((current) => (current ? submitReveal(current, true) : current))}
                >
                  身份确认完毕
                </button>
              </>
            )}
          </div>
        </section>
      ) : null}

      {game.flow.screen === 'public' ? (
        <section className="flow-layout">
          <section className="card public-card">
            <div className="section-title">
              {game.flow.phase === 'night' ? '公共播报' : '白天广播'}
            </div>
            <p className="broadcast-text">{game.flow.publicMessage}</p>
            <p className="helper-text">{game.flow.helperText}</p>
            {nightIntroRunning ? (
              <div className="timer-display compact">
                {formatSeconds(game.flow.nightStageRemainingSeconds)}
              </div>
            ) : null}
            <div className="button-row">
              {nightIntroRunning ? null : (
                <button
                  className="primary"
                  onClick={() => setGame((current) => (current ? startNextPublicStep(current) : current))}
                >
                  {game.flow.actionLabel}
                </button>
              )}
            </div>
          </section>

          {game.flow.phase === 'day' ? (
            <aside className="card timer-card">
              <div className="section-title">讨论计时</div>
              <div className="timer-display">{formatSeconds(game.flow.discussionRemainingSeconds)}</div>
              <p className="helper-text">{discussionTimerRunning ? '计时进行中' : '计时暂停中'}</p>
              <div className="button-row">
                {discussionTimerRunning ? (
                  <button
                    className="secondary"
                    onClick={() => setGame((current) => (current ? pauseDiscussionTimer(current) : current))}
                  >
                    暂停
                  </button>
                ) : (
                  <button
                    className="secondary"
                    onClick={() => setGame((current) => (current ? startDiscussionTimer(current) : current))}
                  >
                    开始
                  </button>
                )}
                <button
                  className="ghost"
                  onClick={() => setGame((current) => (current ? resetDiscussionTimer(current) : current))}
                >
                  重置
                </button>
              </div>
            </aside>
          ) : (
            <aside className="card info-card">
              <div className="section-title">主持提示</div>
              <p className="helper-text">
                夜晚会按固定角色顺序执行，每个阶段使用固定时长，避免通过跳过环节判断场上有没有某个角色。
              </p>
            </aside>
          )}
        </section>
      ) : null}

      {game.flow.screen === 'private' && game.flow.activeStep ? (
        <section className="card private-card">
          <div className="section-title">夜晚阶段</div>
          <p className="lead-tight">{game.flow.publicMessage}</p>
          <div className="timer-display compact">{formatSeconds(game.flow.nightStageRemainingSeconds)}</div>
          <p className="helper-text">
            {waitingNightStage
              ? '本阶段已截止，系统会在闭眼播报后自动进入下一步。'
              : nightTimerRunning
                ? '本阶段按倒计时自动结束，不会因为是否有人操作而提前跳过。'
                : '系统即将进入下一步。'}
          </p>

          {waitingNightStage ? (
            <div className="result-banner">{game.flow.privateResult ?? '请闭眼等待下一步。'}</div>
          ) : game.flow.privateResult ? (
            <div className="result-banner">{game.flow.privateResult}</div>
          ) : !game.flow.activeStep.playerId ? (
            <div className="private-role">
              <div className="identity-label">当前阶段</div>
              <div className="identity-name">{getRoleDefinition(game.flow.activeStep.roleId).name}</div>
              <p>本阶段无人需要操作，请保持闭眼等待倒计时结束。</p>
            </div>
          ) : (
            <>
              <div className="private-role">
                <div className="identity-label">当前阶段</div>
                <div className="identity-name">{getRoleDefinition(game.flow.activeStep.roleId).name}</div>
                <p>{game.flow.helperText}</p>
              </div>

              {privateChoices.length > 0 ? (
                <div className="choice-grid">
                  {privateChoices.map((choice) => (
                    <button
                      key={choice.id}
                      className="choice-card"
                      onClick={() =>
                        setGame((current) =>
                          current
                            ? submitPrivateStep(current, current.flow.activeStep!, choice.id)
                            : current,
                        )
                      }
                    >
                      <strong>{choice.label}</strong>
                      <span>{choice.description}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {currentTargets.length > 0 ? (
                <div className="target-grid">
                  {currentTargets.map((target) => (
                    <button
                      key={target.id}
                      className="target-button"
                      onClick={() =>
                        setGame((current) =>
                          current
                            ? submitPrivateStep(current, current.flow.activeStep!, target.id)
                            : current,
                        )
                      }
                    >
                      <span>{target.seat} 号</span>
                      <strong>
                        {game.flow.activeStep?.roleId === 'wolf'
                          ? `击杀 ${target.name}`
                          : game.flow.activeStep?.roleId === 'witch'
                            ? `毒 ${target.name}`
                            : target.name}
                      </strong>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {game.flow.screen === 'vote' ? (
        <section className="card vote-card">
          <div className="section-title">录入白天结果</div>
          <p className="lead-tight">{game.flow.publicMessage}</p>
          <p className="helper-text">{game.flow.helperText}</p>
          <div className="target-grid">
            {alivePlayers.map((player) => (
              <button
                key={player.id}
                className="target-button"
                onClick={() => setGame((current) => (current ? submitVote(current, player.id) : current))}
              >
                <span>{player.seat} 号</span>
                <strong>{player.name}</strong>
              </button>
            ))}
            <button
              className="target-button abstain-button"
              onClick={() => setGame((current) => (current ? submitVote(current, 'abstain') : current))}
            >
              <span>本轮结果</span>
              <strong>无人出局</strong>
            </button>
          </div>
        </section>
      ) : null}

      {game.flow.screen === 'result' ? (
        <section className="result-layout">
          <section className="card result-card">
            <div className="section-title">对局结束</div>
            <p className="broadcast-text">{game.flow.publicMessage}</p>
            <div className="identity-stack">
              {game.players.map((player) => (
                <div className="identity-card" key={player.id}>
                  <div className="identity-label">
                    {player.seat} 号 {player.name}
                  </div>
                  <div className="identity-name">{getIdentityLifeSummary(player)}</div>
                  <p>
                    上身份：{getRoleDefinition(player.identities[0].roleId).name}
                    {player.identities[0].isAlive ? '（存活）' : '（已失去）'}
                  </p>
                  <p>
                    下身份：{getRoleDefinition(player.identities[1].roleId).name}
                    {player.identities[1].isAlive ? '（存活）' : '（已失去）'}
                  </p>
                  <p>当前阵营：{getPlayerCamp(player) === 'wolf' ? '狼人' : '好人'}</p>
                </div>
              ))}
            </div>

            <div className="button-row">
              <button className="primary" onClick={() => setGame(null)}>
                回到首页
              </button>
              <button className="ghost" onClick={() => setShowPrivateLogs((current) => !current)}>
                {showPrivateLogs ? '只看公开日志' : '显示隐藏日志'}
              </button>
            </div>
          </section>

          <aside className="card recap-card">
            <div className="section-title">复盘日志</div>
            <p className="helper-text">
              {showPrivateLogs
                ? '当前显示完整日志，包含夜晚私密记录。'
                : '当前显示公开日志，按第一夜、第一天、第二夜这样的顺序展示。'}
            </p>
            <div className="log-list">
              {visibleLogs.map((event) => (
                <div className="log-item" key={event.id}>
                  <div>
                    <span className="log-pill">{formatLogPhase(event.day, event.phase)}</span>
                    <strong>{event.title}</strong>
                  </div>
                  <p>{event.message}</p>
                </div>
              ))}
            </div>
          </aside>
        </section>
      ) : null}
    </main>
  );
}

function formatLogPhase(day: number, phase: GameState['logs'][number]['phase']) {
  if (phase === 'night') {
    return `第 ${day} 夜`;
  }
  if (phase === 'day' || phase === 'vote') {
    return `第 ${day} 天`;
  }
  if (phase === 'reveal') {
    return '发身份';
  }
  return '结算';
}

function PlayerCard({
  player,
  revealRoles,
}: {
  player: Player;
  revealRoles: boolean;
}) {
  const camp = getPlayerCamp(player);
  return (
    <article className={`player-card ${player.isAlive ? 'alive' : 'dead'}`}>
      <div className="player-card-top">
        <span>{player.seat} 号</span>
        <strong>{player.name}</strong>
      </div>
      <div className="player-card-bottom">
        <span>{getIdentityLifeSummary(player)}</span>
        <span>{revealRoles ? getPlayerRoleNames(player).join(' / ') : '身份未公开'}</span>
        {revealRoles ? <span>{camp === 'wolf' ? '狼人阵营' : '好人阵营'}</span> : null}
      </div>
    </article>
  );
}

export default App;


