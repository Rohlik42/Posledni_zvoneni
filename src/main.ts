import { Game } from "./core/Game";
import { MainScene } from "./core/MainScene";
import "./ui/BundledFonts";

const CANVAS_ID = "game";

void Game.boot(document.getElementById(CANVAS_ID) as HTMLCanvasElement, new MainScene());
