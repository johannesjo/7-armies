import { Renderer } from './renderer';
import { GameEngine } from './game';
import { generateObstacles, generateElevationZones } from './battlefield';
import { BattleResult, TurnPhase, ReplayData } from './types';
import { BATTALION_SIZE, ARMY_COMPOSITION } from './constants';
import { createArmyBattalions } from './battalion';
import { ReplayPlayer } from './replay';
import { DAY_THEME, NIGHT_THEME } from './theme';
import { ChargeMode, ChargeResult } from './charge/mode';

// DOM elements
const promptScreen = document.getElementById('prompt-screen')!;
const battleScreen = document.getElementById('battle-screen')!;
const resultScreen = document.getElementById('result-screen')!;

const battleBtn = document.getElementById('battle-btn')!;
const aiBtn = document.getElementById('ai-btn')!;
const chargeBtn = document.getElementById('charge-btn')!;

const battleHud = document.getElementById('battle-hud')!;
const blueCountEl = document.getElementById('blue-count')!;
const redCountEl = document.getElementById('red-count')!;
const roundTimerEl = document.getElementById('round-timer')!;
const speedToggle = document.getElementById('speed-toggle') as HTMLButtonElement;

const planningOverlay = document.getElementById('planning-overlay')!;
const planningLabel = document.getElementById('planning-label')!;
const planningInstructions = document.getElementById('planning-instructions')!;
const confirmBtn = document.getElementById('confirm-btn')!;
const leaveBattleBtn = document.getElementById('leave-battle-btn')!;
const coverScreen = document.getElementById('cover-screen')!;
const roundCounterEl = document.getElementById('round-counter')!;

const winnerTextEl = document.getElementById('winner-text')!;
const resultStatsEl = document.getElementById('result-stats')!;
const rematchBtn = document.getElementById('rematch-btn')!;
const newBattleBtn = document.getElementById('new-battle-btn')!;
const replayBtn = document.getElementById('replay-btn')!;
const reloadBtn = document.getElementById('reload-btn')!;

const dayModeCb = document.getElementById('day-mode-cb') as HTMLInputElement;
const pixiContainer = document.getElementById('pixi-container')!;

// Replay controls
const replayOverlay = document.getElementById('replay-overlay')!;
const replayRestartBtn = document.getElementById('replay-restart-btn')!;
const replayPauseBtn = document.getElementById('replay-pause-btn')!;
const replayExitBtn = document.getElementById('replay-exit-btn')!;
const replayProgress = document.getElementById('replay-progress')!;
const replaySpeedToggle = document.getElementById('replay-speed-toggle') as HTMLButtonElement;

// State
let renderer: Renderer | null = null;
let rendererReady: Promise<void> | null = null;
let engine: GameEngine | null = null;
let aiMode = false;
let gameFailed = false;
let lastMode: 'tactics' | 'charge' = 'tactics';
let chargeMode: ChargeMode | null = null;

// Replay state
let replayPlayer: ReplayPlayer | null = null;
let lastReplayData: ReplayData | null = null;

const totalPerSide = ARMY_COMPOSITION.reduce((s, c) => s + c.count * BATTALION_SIZE[c.type], 0);

function showScreen(screen: 'prompt' | 'battle' | 'result') {
  promptScreen.classList.toggle('active', screen === 'prompt');
  battleScreen.classList.add('active'); // always visible once initialized
  battleScreen.inert = screen !== 'battle';
  resultScreen.classList.toggle('active', screen === 'result');
  leaveBattleBtn.classList.toggle('active', screen === 'battle');
  if (screen !== 'battle') battleHud.style.display = 'none';
}

function showGameError(): void {
  if (gameFailed) return;
  gameFailed = true;

  // Keep recovery in the DOM so it works even when the renderer has failed.
  winnerTextEl.textContent = 'Game interrupted';
  winnerTextEl.style.color = '';
  resultStatsEl.textContent = 'Reload the game to start a new battle.';
  rematchBtn.style.display = 'none';
  newBattleBtn.style.display = 'none';
  replayBtn.style.display = 'none';
  reloadBtn.hidden = false;
  planningOverlay.classList.remove('active');
  confirmBtn.classList.remove('active');
  coverScreen.classList.remove('active');
  replayOverlay.classList.remove('active');
  battleHud.style.display = 'none';
  showScreen('result');
  reloadBtn.focus();

  renderer?.ticker?.stop();
  chargeMode?.stop();
}

function updateCounts(): void {
  const counts = engine?.getAliveCount() ?? { blue: totalPerSide, red: totalPerSide };
  blueCountEl.textContent = `Blue: ${counts.blue}/${totalPerSide}`;
  redCountEl.textContent = `Red: ${counts.red}/${totalPerSide}`;
}

function updateSpeedControl(button: HTMLButtonElement, speed: number): void {
  button.dataset.speed = String(speed);
  button.classList.toggle('active', speed !== 1);
  button.textContent = `${speed}×`;
  button.title = speed === 1 ? 'Switch to 3× speed' : 'Switch to normal speed';
}

function updateReplayPauseControl(paused: boolean): void {
  replayPauseBtn.textContent = paused ? '\u25B6' : '\u23F8';
  replayPauseBtn.title = paused ? 'Play replay' : 'Pause replay';
  replayPauseBtn.setAttribute('aria-label', replayPauseBtn.title);
}

function onPhaseChange(phase: TurnPhase, round: number): void {
  const planning = phase === 'blue-planning' || phase === 'red-planning';

  battleHud.style.display = planning ? 'none' : '';
  updateCounts();

  // Planning overlay
  if (planning) {
    const team = phase === 'blue-planning' ? 'Blue' : 'Red';
    const isDayMode = dayModeCb.checked;
    const color = phase === 'blue-planning'
      ? (isDayMode ? '#2266aa' : '#4a9eff')
      : (isDayMode ? '#aa3333' : '#ff4a4a');
    planningLabel.textContent = `${team} Planning`;
    planningLabel.style.color = color;
    planningInstructions.textContent = `Round ${round} · Drag to draw a route.`;
    planningOverlay.classList.add('active');
    confirmBtn.classList.add('active');
    roundTimerEl.textContent = '';
  } else {
    planningOverlay.classList.remove('active');
    confirmBtn.classList.remove('active');
  }

  // Cover screen
  coverScreen.classList.toggle('active', phase === 'cover');
  battleScreen.inert = phase === 'cover';
  if (phase === 'cover') coverScreen.focus();
  else if (planning) confirmBtn.focus();
}

function captureReplayData(): void {
  lastReplayData = engine?.getReplayData() ?? null;
}

function onGameEvent(
  event: 'update' | 'end' | 'phase-change',
  data?: BattleResult | { phase: TurnPhase; timeLeft?: number; round?: number },
) {
  if (gameFailed) return;

  if (event === 'phase-change' && data && 'phase' in data) {
    onPhaseChange(data.phase, data.round ?? 1);
    if (data.round !== undefined) {
      roundCounterEl.textContent = `Round ${data.round}`;
    }
    return;
  }

  if (event === 'update' && engine) {
    updateCounts();

    if (data && 'timeLeft' in data && data.timeLeft !== undefined) {
      const timeLeft = data.timeLeft;
      roundTimerEl.textContent = `${Math.ceil(timeLeft)}s`;

      if (timeLeft <= 3) {
        roundTimerEl.style.color = dayModeCb.checked ? '#aa3333' : '#ff4444';
        const pulse = 1 + 0.1 * Math.sin(Date.now() / 150);
        roundTimerEl.style.transform = `scale(${pulse})`;
      } else {
        roundTimerEl.style.color = '';
        roundTimerEl.style.transform = '';
      }
    }
  }

  if (event === 'end' && data && 'winner' in data) {
    captureReplayData();
    const result = data as BattleResult;

    const color = result.winner === 'blue'
      ? (dayModeCb.checked ? '#2266aa' : '#4a9eff')
      : (dayModeCb.checked ? '#aa3333' : '#ff4a4a');
    winnerTextEl.innerHTML = `${result.winner === 'blue' ? 'Blue' : 'Red'} Wins!<br><span style="font-size:0.5em;opacity:0.7">Elimination!</span>`;
    winnerTextEl.style.color = color;

    const stats = [
      `Duration: ${result.duration.toFixed(1)}s`,
      `Blue survivors: ${result.blueAlive}/${totalPerSide}`,
      `Red survivors: ${result.redAlive}/${totalPerSide}`,
    ];
    if (!lastReplayData) stats.push('Replay unavailable for this long battle.');
    resultStatsEl.innerHTML = stats.join('<br>');

    rematchBtn.textContent = 'Rematch';
    newBattleBtn.textContent = 'Back';
    replayBtn.style.display = lastReplayData ? '' : 'none';

    showScreen('result');
    rematchBtn.focus();
  }
}

async function initRenderer(): Promise<void> {
  if (rendererReady) return rendererReady;
  battleScreen.classList.add('active'); // visible before init so container has dimensions
  const nextRenderer = new Renderer();
  rendererReady = nextRenderer.init(pixiContainer).then(() => {
    renderer = nextRenderer;
    renderer.canvas.addEventListener('webglcontextlost', showGameError);
    window.addEventListener('resize', () => {
      if (!gameFailed) renderer?.resize(pixiContainer.clientWidth, pixiContainer.clientHeight);
    });
  });
  return rendererReady;
}

function showPreview(): void {
  if (!renderer) return;
  renderer.clearUnits();
  renderer.renderElevationZones(generateElevationZones());
  renderer.renderObstacles(generateObstacles());
  const blue = createArmyBattalions('blue');
  const red = createArmyBattalions('red');
  renderer.renderUnits([...blue.units, ...red.units]);
}

function startGame(): void {
  if (gameFailed) return;
  lastMode = 'tactics';
  lastReplayData = null;
  engine?.stop();
  document.body.classList.toggle('day-mode', dayModeCb.checked);
  renderer!.setTheme(dayModeCb.checked ? DAY_THEME : NIGHT_THEME);
  engine = new GameEngine(renderer!, onGameEvent, {
    aiMode,
  });
  showScreen('battle');
  updateSpeedControl(speedToggle, 1);
  roundTimerEl.textContent = '';
  roundTimerEl.style.color = '';
  roundTimerEl.style.transform = '';
  roundCounterEl.textContent = 'Round 1';
  engine.startBattle();
}

// --- Replay functions ---

function startReplay(data: ReplayData): void {
  replayPlayer?.stop();
  // Hide other overlays
  resultScreen.classList.remove('active');
  planningOverlay.classList.remove('active');
  confirmBtn.classList.remove('active');
  battleHud.style.display = 'none';

  showScreen('battle');
  leaveBattleBtn.classList.remove('active');
  replayOverlay.classList.add('active');
  updateReplayPauseControl(false);
  updateSpeedControl(replaySpeedToggle, 1);

  replayPlayer = new ReplayPlayer(renderer!, data, (event, eventData) => {
    if (event === 'frame' && eventData) {
      replayProgress.textContent = `${eventData.time.toFixed(1)}s / ${eventData.duration.toFixed(1)}s`;
    }
    if (event === 'end') {
      updateReplayPauseControl(true);
    }
  });
  replayPlayer.start();
  replayPauseBtn.focus();
}

function stopReplay(): void {
  replayPlayer?.stop();
  replayPlayer = null;
  replayOverlay.classList.remove('active');
  showScreen('result');
  replayBtn.focus();
}

function returnToMenu(): void {
  if (chargeMode?.active || lastMode === 'charge') {
    chargeMode?.stop();
    renderer?.ticker.start();
  }
  rematchBtn.style.display = '';
  replayPlayer?.stop();
  replayPlayer = null;
  engine?.stop();
  engine = null;
  planningOverlay.classList.remove('active');
  confirmBtn.classList.remove('active');
  coverScreen.classList.remove('active');
  replayOverlay.classList.remove('active');
  roundTimerEl.textContent = '';
  lastReplayData = null;
  renderer?.renderProjectiles([]);

  showPreview();
  showScreen('prompt');
  chargeBtn.focus();
}

// --- Cavalry Charge mode ---

function onChargeEnd(result: ChargeResult): void {
  if (gameFailed) return;
  const day = dayModeCb.checked;
  const won = result.outcome === 'victory';
  winnerTextEl.innerHTML = `${won ? 'Victory!' : 'Defeat'}<br><span style="font-size:0.4em;opacity:0.7;letter-spacing:1px">${result.reason}</span>`;
  winnerTextEl.style.color = won ? (day ? '#2266aa' : '#4a9eff') : (day ? '#aa3333' : '#ff4a4a');
  const mins = Math.floor(result.time / 60);
  const secs = String(Math.floor(result.time % 60)).padStart(2, '0');
  resultStatsEl.innerHTML = [
    `<b style="font-size:1.4em">Score ${result.score.toLocaleString()}</b>`,
    `Enemies ridden down: ${result.kills}`,
    `Battalions routed by your charges: ${result.routs}`,
    `Best trample combo: ${result.bestCombo}`,
    `Riders recruited: ${result.joined} · lost: ${result.ridersLost}`,
    `Time: ${mins}:${secs}`,
    result.newBest ? '<b>New best score!</b>' : `Best: ${result.best.toLocaleString()}`,
  ].join('<br>');
  rematchBtn.textContent = 'Ride again';
  rematchBtn.style.display = '';
  newBattleBtn.textContent = 'Back';
  replayBtn.style.display = 'none';
  showScreen('result');
  rematchBtn.focus();
}

async function startCharge(): Promise<void> {
  if (gameFailed) return;
  lastMode = 'charge';
  engine?.stop();
  engine = null;
  replayPlayer?.stop();
  replayPlayer = null;
  document.body.classList.toggle('day-mode', dayModeCb.checked);
  // The tactics canvas sits hidden underneath; stop it rendering while we ride.
  renderer?.ticker.stop();
  showScreen('battle');
  battleScreen.inert = true;
  leaveBattleBtn.classList.remove('active');
  chargeMode ??= new ChargeMode({
    onEnd: onChargeEnd,
    onQuit: returnToMenu,
  });
  await chargeMode.start(dayModeCb.checked ? DAY_THEME : NIGHT_THEME);
}

dayModeCb.addEventListener('change', () => {
  document.body.classList.toggle('day-mode', dayModeCb.checked);
  if (renderer) {
    renderer.setTheme(dayModeCb.checked ? DAY_THEME : NIGHT_THEME);
    showPreview();
  }
});

// --- Event listeners ---
window.addEventListener('error', showGameError);
window.addEventListener('unhandledrejection', showGameError);
reloadBtn.addEventListener('click', () => window.location.reload());

battleBtn.addEventListener('click', async () => {
  aiMode = false;
  await initRenderer();
  startGame();
});

aiBtn.addEventListener('click', async () => {
  aiMode = true;
  await initRenderer();
  startGame();
});

confirmBtn.addEventListener('click', () => {
  engine?.confirmPlan();
});

coverScreen.addEventListener('click', () => {
  engine?.skipCover();
});

speedToggle.addEventListener('click', () => {
  const isfast = speedToggle.dataset.speed === '3';
  const newSpeed = isfast ? 1 : 3;
  updateSpeedControl(speedToggle, newSpeed);
  engine?.setSpeed(newSpeed);
});

rematchBtn.addEventListener('click', async () => {
  await initRenderer();
  if (lastMode === 'charge') {
    resultScreen.classList.remove('active');
    await startCharge();
    return;
  }
  startGame();
});

chargeBtn.addEventListener('click', async () => {
  await initRenderer();
  await startCharge();
});

newBattleBtn.addEventListener('click', returnToMenu);
leaveBattleBtn.addEventListener('click', () => {
  if (window.confirm('Leave this battle and return to the menu?')) returnToMenu();
});

// Replay button on result screen
replayBtn.addEventListener('click', () => {
  if (lastReplayData) {
    startReplay(lastReplayData);
  }
});

// Replay control buttons
replayRestartBtn.addEventListener('click', () => {
  replayPlayer?.restart();
  updateReplayPauseControl(false);
});

replayPauseBtn.addEventListener('click', () => {
  if (!replayPlayer) return;
  replayPlayer.togglePause();
  updateReplayPauseControl(replayPlayer.isPaused);
});

replayExitBtn.addEventListener('click', () => {
  stopReplay();
});

replaySpeedToggle.addEventListener('click', () => {
  const speed = replaySpeedToggle.dataset.speed === '3' ? 1 : 3;
  replayPlayer?.setSpeed(speed);
  updateSpeedControl(replaySpeedToggle, speed);
});

// Initialize renderer and show battlefield preview behind start screen
(async () => {
  await initRenderer();
  if (gameFailed) return;
  document.body.classList.toggle('day-mode', dayModeCb.checked);
  if (dayModeCb.checked) renderer!.setTheme(DAY_THEME);
  showPreview();
  showScreen('prompt');
})();
