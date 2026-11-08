import { THEMES, Theme, ThemeName } from './theme';
import { ChargeMode, ChargeResult } from './charge/mode';

// DOM elements
const promptScreen = document.getElementById('prompt-screen')!;
const resultScreen = document.getElementById('result-screen')!;
const chargeBtn = document.getElementById('charge-btn')!;

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

/** Parchment and ink use the light page styling; the others use the dark overlays. */
function applyBodyTheme(): void {
  document.body.classList.toggle('day-mode', themeSelect.value === 'parchment' || themeSelect.value === 'ink');
  document.body.classList.toggle('style-rts', themeSelect.value === 'rts');
}

let gameFailed = false;
let chargeMode: ChargeMode | null = null;

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

  chargeMode?.stop();
}

function returnToMenu(): void {
  chargeMode?.stop();
  showScreen('prompt');
  chargeBtn.focus();
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

async function startCharge(): Promise<void> {
  if (gameFailed) return;
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
rematchBtn.addEventListener('click', startCharge);
newBattleBtn.addEventListener('click', returnToMenu);

applyBodyTheme();
showScreen('prompt');
