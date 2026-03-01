import { Renderer } from './renderer';
import { GameEngine } from './game';
import { generateObstacles, generateElevationZones } from './battlefield';
import { BattleResult, TurnPhase, ReplayData } from './types';
import { BATTALION_SIZE, ARMY_COMPOSITION } from './constants';
import { createArmyBattalions } from './battalion';
import { ReplayPlayer } from './replay';
import { DAY_THEME, NIGHT_THEME } from './theme';

// DOM elements
const promptScreen = document.getElementById('prompt-screen')!;
const battleScreen = document.getElementById('battle-screen')!;
const resultScreen = document.getElementById('result-screen')!;

const battleBtn = document.getElementById('battle-btn')!;
const aiBtn = document.getElementById('ai-btn')!;

const battleHud = document.getElementById('battle-hud')!;
const blueCountEl = document.getElementById('blue-count')!;
const redCountEl = document.getElementById('red-count')!;
const roundTimerEl = document.getElementById('round-timer')!;
const speedToggle = document.getElementById('speed-toggle') as HTMLButtonElement;

const planningOverlay = document.getElementById('planning-overlay')!;
const planningLabel = document.getElementById('planning-label')!;
const confirmBtn = document.getElementById('confirm-btn')!;
const coverScreen = document.getElementById('cover-screen')!;
const roundCounterEl = document.getElementById('round-counter')!;

const winnerTextEl = document.getElementById('winner-text')!;
const resultStatsEl = document.getElementById('result-stats')!;
const rematchBtn = document.getElementById('rematch-btn')!;
const newBattleBtn = document.getElementById('new-battle-btn')!;
const replayBtn = document.getElementById('replay-btn')!;

const oneShotCb = document.getElementById('one-shot-cb') as HTMLInputElement;
const bloodCb = document.getElementById('blood-cb') as HTMLInputElement;
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
let engine: GameEngine | null = null;
let aiMode = false;

// Replay state
let replayPlayer: ReplayPlayer | null = null;
let lastReplayData: ReplayData | null = null;

const totalPerSide = ARMY_COMPOSITION.reduce((s, c) => s + c.count, 0) * BATTALION_SIZE;

function showScreen(screen: 'prompt' | 'battle' | 'result') {
  promptScreen.classList.toggle('active', screen === 'prompt');
  battleScreen.classList.add('active'); // always visible once initialized
  resultScreen.classList.toggle('active', screen === 'result');
}

function onPhaseChange(phase: TurnPhase): void {
  const planning = phase === 'blue-planning' || phase === 'red-planning';

  // Hide HUD during planning so the Done button doesn't overlap
  battleHud.style.display = planning ? 'none' : '';

  // Planning overlay
  if (planning) {
    const team = phase === 'blue-planning' ? 'Blue' : 'Red';
    const isDayMode = dayModeCb.checked;
    const color = phase === 'blue-planning'
      ? (isDayMode ? '#2266aa' : '#4a9eff')
      : (isDayMode ? '#aa3333' : '#ff4a4a');
    planningLabel.textContent = `${team} Planning`;
    planningLabel.style.color = color;
    planningOverlay.classList.add('active');
    confirmBtn.classList.add('active');
    roundTimerEl.textContent = '';
  } else {
    planningOverlay.classList.remove('active');
    confirmBtn.classList.remove('active');
  }

  // Cover screen
  coverScreen.classList.toggle('active', phase === 'cover');
}

function captureReplayData(): void {
  lastReplayData = engine?.getReplayData() ?? null;
}

function onGameEvent(
  event: 'update' | 'end' | 'phase-change',
  data?: BattleResult | { phase: TurnPhase; timeLeft?: number; round?: number },
) {
  if (event === 'phase-change' && data && 'phase' in data) {
    onPhaseChange(data.phase);
    if (data.round !== undefined) {
      roundCounterEl.textContent = `Round ${data.round}`;
    }
    return;
  }

  if (event === 'update' && engine) {
    const counts = engine.getAliveCount();
    blueCountEl.textContent = `Blue: ${counts.blue}/${totalPerSide}`;
    redCountEl.textContent = `Red: ${counts.red}/${totalPerSide}`;

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

    const color = result.winner === 'blue' ? '#4a9eff' : '#ff4a4a';
    winnerTextEl.innerHTML = `${result.winner === 'blue' ? 'Blue' : 'Red'} Wins!<br><span style="font-size:0.5em;opacity:0.7">Elimination!</span>`;
    winnerTextEl.style.color = color;

    resultStatsEl.innerHTML = [
      `Duration: ${result.duration.toFixed(1)}s`,
      `Blue survivors: ${result.blueAlive}/${totalPerSide}`,
      `Red survivors: ${result.redAlive}/${totalPerSide}`,
    ].join('<br>');

    rematchBtn.textContent = 'Rematch';
    newBattleBtn.textContent = 'Back';
    replayBtn.style.display = lastReplayData ? '' : 'none';

    showScreen('result');
  }
}

async function initRenderer(): Promise<void> {
  if (renderer) return;
  battleScreen.classList.add('active'); // visible before init so container has dimensions
  renderer = new Renderer();
  await renderer.init(pixiContainer);
}

function showPreview(): void {
  if (!renderer) return;
  renderer.renderElevationZones(generateElevationZones());
  renderer.renderObstacles(generateObstacles());
  const blue = createArmyBattalions('blue');
  const red = createArmyBattalions('red');
  renderer.renderUnits([...blue.units, ...red.units]);
}

function startGame(): void {
  lastReplayData = null;
  engine?.stop();
  document.body.classList.toggle('day-mode', dayModeCb.checked);
  renderer!.setTheme(dayModeCb.checked ? DAY_THEME : NIGHT_THEME);
  engine = new GameEngine(renderer!, onGameEvent, {
    aiMode,
    oneShot: oneShotCb.checked,
    blood: bloodCb.checked,
  });
  showScreen('battle');
  speedToggle.classList.remove('active');
  speedToggle.dataset.speed = '1';
  speedToggle.textContent = '3x';
  roundCounterEl.textContent = 'Round 1';
  engine.startBattle();
}

// --- Replay functions ---

function startReplay(data: ReplayData): void {
  // Hide other overlays
  resultScreen.classList.remove('active');
  planningOverlay.classList.remove('active');
  confirmBtn.classList.remove('active');
  battleHud.style.display = 'none';

  showScreen('battle');
  replayOverlay.classList.add('active');
  replayPauseBtn.textContent = '\u23F8';
  replaySpeedToggle.textContent = '3x';
  replaySpeedToggle.classList.remove('active');

  replayPlayer = new ReplayPlayer(renderer!, data, (event, eventData) => {
    if (event === 'frame' && eventData) {
      replayProgress.textContent = `${eventData.time.toFixed(1)}s / ${eventData.duration.toFixed(1)}s`;
    }
    if (event === 'end') {
      replayPauseBtn.textContent = '\u25B6';
    }
  });
  replayPlayer.start();
}

function stopReplay(): void {
  replayPlayer?.stop();
  replayPlayer = null;
  replayOverlay.classList.remove('active');
  showScreen('result');
}

dayModeCb.addEventListener('change', () => {
  document.body.classList.toggle('day-mode', dayModeCb.checked);
  if (renderer) renderer.setTheme(dayModeCb.checked ? DAY_THEME : NIGHT_THEME);
});

// --- Event listeners ---
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
  speedToggle.dataset.speed = String(newSpeed);
  speedToggle.classList.toggle('active', !isfast);
  speedToggle.textContent = isfast ? '3x' : '1x';
  engine?.setSpeed(newSpeed);
});

rematchBtn.addEventListener('click', async () => {
  await initRenderer();
  startGame();
});

newBattleBtn.addEventListener('click', () => {
  engine?.stop();
  engine = null;
  planningOverlay.classList.remove('active');
  confirmBtn.classList.remove('active');
  coverScreen.classList.remove('active');
  roundTimerEl.textContent = '';
  lastReplayData = null;

  showPreview();
  showScreen('prompt');
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
  replayPauseBtn.textContent = '\u23F8';
});

replayPauseBtn.addEventListener('click', () => {
  if (!replayPlayer) return;
  replayPlayer.togglePause();
  replayPauseBtn.textContent = replayPlayer.isPaused ? '\u25B6' : '\u23F8';
});

replayExitBtn.addEventListener('click', () => {
  stopReplay();
});

replaySpeedToggle.addEventListener('click', () => {
  const isActive = replaySpeedToggle.classList.toggle('active');
  const speed = isActive ? 3 : 1;
  replayPlayer?.setSpeed(speed);
  replaySpeedToggle.textContent = isActive ? '1x' : '3x';
});

// Initialize renderer and show battlefield preview behind start screen
(async () => {
  await initRenderer();
  document.body.classList.toggle('day-mode', dayModeCb.checked);
  if (dayModeCb.checked) renderer!.setTheme(DAY_THEME);
  showPreview();
  showScreen('prompt');
})();
