import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
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
  syncDiscussionTimer,
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

  const speak = useEffectEvent((text: string) => {
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
  });

  useEffect(() => {
    if (!game?.speechEnabled) {
      return;
    }

    speak(game.flow.speechText);
  }, [game?.flow.speechText, game?.speechEnabled, speak]);

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

  const currentPrivatePlayer =
    game?.flow.screen === 'private' && game.flow.activeStep?.kind === 'nightAction'
      ? game.players.find((player) => player.id === game.flow.activeStep?.playerId)
      : undefined;

  const currentVotePlayer =
    game?.flow.screen === 'vote'
      ? game.players.find(
          (player) => player.id === game.flow.voteOrder[game.flow.voteIndex],
        )
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
    return (showPrivateLogs ? game.logs : game.logs.filter((log) => log.visibility === 'public')).slice().reverse();
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

  const updateCustomRoleCount = (roleId: Exclude<RoleId, 'villager'>, value: number) => {
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
      boardId: current.boardId === 'custom' ? 'custom' : current.boardId,
      discussionMinutes: minutes,
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

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
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
            单手机、无人类 DM、带语音播报、带复盘日志的线下主持网页。
          </p>
        </section>

        <section className="setup-layout">
          <section className="card setup-card">
            <div className="section-title">板子选择</div>
            <div className="preset-grid">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={`preset-card ${
                    draft.boardId === preset.id ? 'selected' : ''
                  }`}
                  onClick={() => handlePresetChange(preset.id)}
                >
                  <strong>{preset.name}</strong>
                  <span>{preset.description}</span>
                  <small>{preset.playerCount} 人 / {preset.discussionMinutes} 分钟讨论</small>
                </button>
              ))}

              <button
                className={`preset-card ${draft.boardId === 'custom' ? 'selected' : ''}`}
                onClick={() => handlePresetChange('custom')}
              >
                <strong>自定义板子</strong>
                <span>手动设置玩家人数和各类身份数量。</span>
                <small>适合自己调规则</small>
              </button>
            </div>

            <div className="field-row">
              <label className="field">
                <span>玩家人数</span>
                <select
                  value={draft.playerCount}
                  onChange={(event) =>
                    handlePlayerCountChange(Number(event.target.value))
                  }
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
                    onChange={(event) =>
                      updatePlayerName(index, event.target.value)
                    }
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
              <button
                className="ghost"
                onClick={() => fileInputRef.current?.click()}
              >
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
              <strong>当前版本可用角色</strong>
              <p>狼人、预言家、守卫、女巫、村民</p>
            </div>

            <div className="info-block">
              <strong>女巫规则</strong>
              <p>本版女巫每晚只能在“救人 / 毒人 / 跳过”里三选一，更适合单手机操作。</p>
            </div>

            <div className="info-block">
              <strong>阵营判定</strong>
              <p>任一身份为狼人，则该玩家整体按狼人阵营结算。</p>
            </div>
          </aside>
        </section>

        <section className="release-grid">
          <article className="card release-card">
            <div className="section-title">三步开始</div>
            <div className="release-steps">
              <div className="info-block">
                <strong>1. 选板子并填玩家</strong>
                <p>可直接用预设板子，也可以切到自定义板子手调角色数量。</p>
              </div>
              <div className="info-block">
                <strong>2. 按座位依次看身份</strong>
                <p>每位玩家拿到手机只看自己的双身份，确认后立刻交给下一位。</p>
              </div>
              <div className="info-block">
                <strong>3. 网页自动主持整局</strong>
                <p>网页负责夜晚唤醒、白天计时、投票结算、语音播报与赛后复盘。</p>
              </div>
            </div>
          </article>

          <article className="card release-card">
            <div className="section-title">安装与离线</div>
            <div className="info-block">
              <strong>建议安装成桌面应用</strong>
              <p>在 Chrome 或 Edge 打开网页后，可使用“安装应用”或“添加到主屏幕”。安装后更像原生主持工具。</p>
            </div>
            <div className="info-block">
              <strong>首次联网打开一次</strong>
              <p>浏览器会缓存主界面和静态资源。之后即使现场网络不稳定，也能继续打开并恢复本地存档。</p>
            </div>
            <div className="info-block">
              <strong>语音播报提示</strong>
              <p>大多数浏览器需要你先点一次按钮才允许播放语音，所以开局前建议先手动点击“开启语音”。</p>
            </div>
          </article>
        </section>
      </main>
    );
  }

  const timerRunning = Boolean(game.flow.discussionEndsAt);
  const boardSummary = getBoardSummary(game.config);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <div className="eyebrow">
            {game.config.boardName} / 第 {game.flow.day} 天
          </div>
          <h1>{game.flow.title}</h1>
          <p className="helper-text top-helper">{game.flow.publicMessage}</p>
        </div>

        <div className="top-actions">
          <button
            className="ghost"
            onClick={() =>
              setGame((current) => (current ? toggleSpeech(current) : current))
            }
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
          <PlayerCard
            key={player.id}
            player={player}
            revealRoles={game.flow.screen === 'result'}
          />
        ))}
      </section>

      {game.flow.screen === 'reveal' && currentRevealPlayer ? (
        <section className="card reveal-card">
          <div className="section-title">身份发放</div>
          <p className="lead-tight">
            请 {currentRevealPlayer.seat} 号玩家
            <strong> {currentRevealPlayer.name}</strong> 拿到手机查看身份。
          </p>
          <div className="identity-stack">
            {currentRevealPlayer.identities.map((identity, index) => (
              <div
                className="identity-card"
                key={`${currentRevealPlayer.id}-${index}`}
              >
                <div className="identity-label">身份 {index + 1}</div>
                <div className="identity-name">
                  {identity.exposed
                    ? getRoleDefinition(identity.roleId).name
                    : '点击按钮后显示'}
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
            {!currentRevealPlayer.identities.every((identity) => identity.exposed) ? (
              <button
                className="primary"
                onClick={() =>
                  setGame((current) => (current ? submitReveal(current, false) : current))
                }
              >
                显示本人的双身份
              </button>
            ) : (
              <button
                className="primary"
                onClick={() =>
                  setGame((current) => (current ? submitReveal(current, true) : current))
                }
              >
                身份确认完毕
              </button>
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
            <div className="button-row">
              <button
                className="primary"
                onClick={() =>
                  setGame((current) => (current ? startNextPublicStep(current) : current))
                }
              >
                {game.flow.actionLabel}
              </button>
            </div>
          </section>

          {game.flow.phase === 'day' ? (
            <aside className="card timer-card">
              <div className="section-title">讨论计时</div>
              <div className="timer-display">
                {formatSeconds(game.flow.discussionRemainingSeconds)}
              </div>
              <p className="helper-text">
                {timerRunning ? '计时进行中' : '计时暂停中'}
              </p>
              <div className="button-row">
                {timerRunning ? (
                  <button
                    className="secondary"
                    onClick={() =>
                      setGame((current) => (current ? pauseDiscussionTimer(current) : current))
                    }
                  >
                    暂停
                  </button>
                ) : (
                  <button
                    className="secondary"
                    onClick={() =>
                      setGame((current) => (current ? startDiscussionTimer(current) : current))
                    }
                  >
                    开始
                  </button>
                )}

                <button
                  className="ghost"
                  onClick={() =>
                    setGame((current) => (current ? resetDiscussionTimer(current) : current))
                  }
                >
                  重置
                </button>
              </div>
            </aside>
          ) : (
            <aside className="card info-card">
              <div className="section-title">主持提示</div>
              <p className="helper-text">
                夜晚流程会依次唤醒有技能的身份。每步提交后，页面会立刻隐藏私密信息。
              </p>
            </aside>
          )}
        </section>
      ) : null}

      {game.flow.screen === 'private' &&
      game.flow.activeStep?.kind === 'nightAction' &&
      currentPrivatePlayer ? (
        <section className="card private-card">
          <div className="section-title">私密操作</div>
          <p className="lead-tight">{game.flow.publicMessage}</p>

          {game.flow.privateResult ? (
            <>
              <div className="result-banner">{game.flow.privateResult}</div>
              <div className="button-row">
                <button
                  className="primary"
                  onClick={() =>
                    setGame((current) =>
                      current
                        ? submitPrivateStep(current, current.flow.activeStep!)
                        : current,
                    )
                  }
                >
                  完成并交回手机
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="private-role">
                <div className="identity-label">当前身份</div>
                <div className="identity-name">
                  {getRoleDefinition(game.flow.activeStep.roleId).name}
                </div>
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
                            ? submitPrivateStep(
                                current,
                                current.flow.activeStep!,
                                choice.id,
                              )
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
                            ? submitPrivateStep(
                                current,
                                current.flow.activeStep!,
                                target.id,
                              )
                            : current,
                        )
                      }
                    >
                      <span>{target.seat} 号</span>
                      <strong>
                        {game.flow.activeStep?.roleId === 'witch'
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

      {game.flow.screen === 'vote' && currentVotePlayer ? (
        <section className="card vote-card">
          <div className="section-title">依次投票</div>
          <p className="lead-tight">
            请 {currentVotePlayer.seat} 号玩家 <strong>{currentVotePlayer.name}</strong>{' '}
            投票。
          </p>
          <div className="target-grid">
            {alivePlayers
              .filter((player) => player.id !== currentVotePlayer.id)
              .map((player) => (
                <button
                  key={player.id}
                  className="target-button"
                  onClick={() =>
                    setGame((current) =>
                      current ? submitVote(current, currentVotePlayer.id, player.id) : current,
                    )
                  }
                >
                  <span>{player.seat} 号</span>
                  <strong>{player.name}</strong>
                </button>
              ))}
            <button
              className="target-button abstain-button"
              onClick={() =>
                setGame((current) =>
                  current ? submitVote(current, currentVotePlayer.id, 'abstain') : current,
                )
              }
            >
              <span>本轮选择</span>
              <strong>弃票</strong>
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
                  <div className="identity-name">
                    {getPlayerRoleNames(player).join(' / ')}
                  </div>
                  <p>
                    阵营：{getPlayerCamp(player) === 'wolf' ? '狼人' : '好人'} | 状态：
                    {player.isAlive ? '存活' : '出局'}
                  </p>
                </div>
              ))}
            </div>

            <div className="button-row">
              <button className="primary" onClick={() => setGame(null)}>
                回到首页
              </button>
              <button
                className="ghost"
                onClick={() => setShowPrivateLogs((current) => !current)}
              >
                {showPrivateLogs ? '只看公开日志' : '显示隐藏日志'}
              </button>
            </div>
          </section>

          <aside className="card recap-card">
            <div className="section-title">复盘日志</div>
            <p className="helper-text">
              {showPrivateLogs
                ? '当前显示完整日志，包含夜间私密记录。'
                : '当前显示公开日志，适合赛后回顾白天流程。'}
            </p>
            <div className="log-list">
              {visibleLogs.map((event) => (
                <div className="log-item" key={event.id}>
                  <div>
                    <span className="log-pill">
                      第 {event.day} 天 / {event.phase}
                    </span>
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
        <span>{player.isAlive ? '存活' : '出局'}</span>
        <span>
          {revealRoles ? getPlayerRoleNames(player).join(' / ') : '身份未公开'}
        </span>
        {revealRoles ? <span>{camp === 'wolf' ? '狼人阵营' : '好人阵营'}</span> : null}
      </div>
    </article>
  );
}

export default App;
