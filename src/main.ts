import './ui/style.css';
import { Game } from './core/Game';
import { Physics } from './core/Physics';

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  // Stop iOS rubber-banding / double-tap zoom outside the canvas too.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  await Physics.init();
  const game = new Game(canvas, ui);
  // Handy for debugging in the console.
  (window as unknown as { game: Game }).game = game;
  game.run();
}

boot().catch((err) => {
  console.error(err);
  const ui = document.getElementById('ui');
  if (ui) ui.innerHTML = `<div class="overlay"><div class="panel"><h2>Failed to start</h2><div class="sub">${String(err)}</div></div></div>`;
});
