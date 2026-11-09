import { THEMES, Theme, ThemeName } from './theme';
import { ChargeMode, ChargeResult } from './charge/mode';
import { LaneMode } from './lanes/mode';
import { FrontMode } from './front/mode';
import { CommanderResult } from './commanders/mode';
import { CommanderKind } from './lanes/cards';

// DOM elements
const promptScreen = document.getElementById('prompt-screen')!;
const resultScreen = document.getElementById('result-screen')!;
const chargeBtn = document.getElementById('charge-btn')!;
const lanesBtn = document.getElementById('lanes-btn')!;
const frontBtn = document.getElementById('front-btn')!;

const winnerTextEl = document.getElementById('winner-text')!;
const resultStatsEl = document.getElementById('result-stats')!;
const rematchBtn = document.getElementById('rematch-btn')!;
const newBattleBtn = document.getElementById('new-battle-btn')!;
const reloadBtn = document.getElementById('reload-btn')!;

const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
// Bumped when the default style changes, so everyone sees the new default once.
const THEME_KEY = 'theme-v2';

function loadThemeName(): ThemeName {
  let stored: string | null = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch { /* storage unavailable */ }
  return stored && stored in THEMES ? stored as ThemeName : 'rts';
}

themeSelect.value = loadThemeName();

function currentTheme(): Theme {
  return THEMES[themeSelect.value as ThemeName] ?? THEMES.rts;
}

function teamCss(team: 'blue' | 'red'): string {
  const c = team === 'blue' ? currentTheme().blue : currentTheme().red;
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** Ink & watercolour uses the light page styling; the others use the dark overlays. */
function applyBodyTheme(): void {
  document.body.classList.toggle('day-mode', themeSelect.value === 'ink');
  document.body.classList.toggle('style-rts', themeSelect.value === 'rts');
  document.body.classList.toggle('style-3d', themeSelect.value === '3d');
}

let gameFailed = false;
let chargeMode: ChargeMode | null = null;
let laneMode: LaneMode | null = null;
let frontMode: FrontMode | null = null;
type ModeKey = 'charge' | 'lanes' | 'front';
/** The mode the result screen's "ride again" restarts. */
let lastMode: ModeKey = 'charge';
/** The commander mode the horse picker will start. */
let pickFor: 'lanes' | 'front' = 'lanes';

function modeBtn(mode: ModeKey): HTMLElement {
  return mode === 'lanes' ? lanesBtn : mode === 'front' ? frontBtn : chargeBtn;
}

function stopAll(): void {
  chargeMode?.stop();
  laneMode?.stop();
  frontMode?.stop();
}

function showScreen(screen: 'prompt' | 'charge' | 'result') {
  promptScreen.classList.toggle('active', screen === 'prompt');
  resultScreen.classList.toggle('active', screen === 'result');
}

function showGameError(): void {
  if (gameFailed) return;
  gameFailed = true;

  // Keep recovery in the DOM so it works even when the renderer has failed.
  winnerTextEl.textContent = 'Game interrupted';
  winnerTextEl.style.color = '';
  resultStatsEl.textContent = 'Reload the game to ride again.';
  rematchBtn.style.display = 'none';
  newBattleBtn.style.display = 'none';
  reloadBtn.hidden = false;
  showScreen('result');
  reloadBtn.focus();

  stopAll();
}

function returnToMenu(): void {
  stopAll();
  showScreen('prompt');
  modeBtn(lastMode).focus();
}

function onChargeEnd(result: ChargeResult): void {
  if (gameFailed) return;
  const won = result.outcome === 'victory';
  winnerTextEl.innerHTML = `${won ? 'Victory!' : 'Defeat'}<br><span style="font-size:0.4em;opacity:0.7;letter-spacing:1px">${result.reason}</span>`;
  winnerTextEl.style.color = teamCss(won ? 'blue' : 'red');
  const mins = Math.floor(result.time / 60);
  const secs = String(Math.floor(result.time % 60)).padStart(2, '0');
  resultStatsEl.innerHTML = [
    `<b style="font-size:1.4em">Score ${result.score.toLocaleString()}</b>`,
    `Enemies ridden down: ${result.kills}`,
    `Battalions routed by your charges: ${result.routs}`,
    ...(result.general ? ['You cut down the enemy general'] : []),
    ...(result.pursuit > 0 ? [`Ridden down in the pursuit: ${result.pursuit}`] : []),
    `Best trample combo: ${result.bestCombo}`,
    `Riders recruited: ${result.joined} · lost: ${result.ridersLost}`,
    `Time: ${mins}:${secs}`,
    result.newBest ? '<b>New best score!</b>' : `Best: ${result.best.toLocaleString()}`,
  ].join('<br>');
  showScreen('result');
  rematchBtn.focus();
}

function onCommanderEnd(result: CommanderResult): void {
  if (gameFailed) return;
  const won = result.outcome === 'victory';
  winnerTextEl.innerHTML = `${won ? 'Victory!' : 'Defeat'}<br><span style="font-size:0.4em;opacity:0.7;letter-spacing:1px">${result.reason}</span>`;
  winnerTextEl.style.color = teamCss(won ? 'blue' : 'red');
  const mins = Math.floor(result.time / 60);
  const secs = String(Math.floor(result.time % 60)).padStart(2, '0');
  resultStatsEl.innerHTML = [
    `<b style="font-size:1.4em">Level ${result.level}</b> ${result.commander} · rival: level ${result.rivalLevel} ${result.rivalCommander}`,
    result.mode === 'lanes' ? `Enemy towers destroyed: ${result.towers ?? 0}` : `Battalions routed by your charges: ${result.routs ?? 0}`,
    `Rival commander slain: ${result.heroKills} · your squadron lost: ${result.deaths}`,
    `Enemies ridden down: ${result.kills}`,
    ...(result.cards.length > 0 ? [`<span style="font-size:0.85em;opacity:0.8">Cards: ${result.cards.join(', ')}</span>`] : []),
    `Time: ${mins}:${secs}`,
  ].join('<br>');
  showScreen('result');
  rematchBtn.focus();
}

/** Lanes and front: first choose your kind of horse. */
function showCommanderPick(mode: 'lanes' | 'front'): void {
  pickFor = mode;
  promptScreen.classList.add('picking');
  (document.querySelector('#ln-pick .ln-cmd') as HTMLButtonElement | null)?.focus();
}

document.querySelectorAll<HTMLButtonElement>('#ln-pick .ln-cmd').forEach(btn => {
  btn.addEventListener('click', () => {
    promptScreen.classList.remove('picking');
    laneKind = btn.dataset.kind as CommanderKind;
    startCommander(pickFor);
  });
});
document.getElementById('ln-pick-back')!.addEventListener('click', () => {
  promptScreen.classList.remove('picking');
  modeBtn(pickFor).focus();
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && promptScreen.classList.contains('picking')) {
    promptScreen.classList.remove('picking');
    modeBtn(pickFor).focus();
  }
});

let laneKind: CommanderKind = 'knights';

async function startCommander(mode: 'lanes' | 'front'): Promise<void> {
  if (gameFailed) return;
  lastMode = mode;
  stopAll();
  applyBodyTheme();
  showScreen('charge');
  const game = mode === 'lanes'
    ? (laneMode ??= new LaneMode({ onEnd: onCommanderEnd, onQuit: returnToMenu }))
    : (frontMode ??= new FrontMode({ onEnd: onCommanderEnd, onQuit: returnToMenu }));
  game.commander = laneKind;
  await game.start(currentTheme());
}

async function startCharge(): Promise<void> {
  if (gameFailed) return;
  lastMode = 'charge';
  stopAll();
  applyBodyTheme();
  showScreen('charge');
  chargeMode ??= new ChargeMode({
    onEnd: onChargeEnd,
    onQuit: returnToMenu,
  });
  await chargeMode.start(currentTheme());
}

themeSelect.addEventListener('change', () => {
  try { localStorage.setItem(THEME_KEY, themeSelect.value); } catch { /* storage unavailable */ }
  applyBodyTheme();
});

window.addEventListener('error', showGameError);
window.addEventListener('unhandledrejection', showGameError);
reloadBtn.addEventListener('click', () => window.location.reload());
chargeBtn.addEventListener('click', startCharge);
lanesBtn.addEventListener('click', () => showCommanderPick('lanes'));
frontBtn.addEventListener('click', () => showCommanderPick('front'));
rematchBtn.addEventListener('click', () => (lastMode === 'charge' ? startCharge() : startCommander(lastMode)));
newBattleBtn.addEventListener('click', returnToMenu);

applyBodyTheme();
showScreen('prompt');
