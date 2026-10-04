import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AudioConfig } from "../../src/audio/AudioConfig";
import { AudioService } from "../../src/audio/AudioService";
import type { Game } from "../../src/core/Game";
import { DevSceneData } from "../DevSceneData";
import { create as createDoorsRoom } from "./DoorsScene";

export const id = "audio";
export const title =
  "Audio pass (fáze 20): klikni pro zvuk. Hudba, kroky (beton), prostorové hučení ohně v rohu, robot za zamčenými dveřmi (servomotory a výstřely tlumené dveřmi, červený klíč je na zemi), UI zvuky v menu";

export async function create(game: Game): Promise<void> {
  await createDoorsRoom(game);
  const layout = DevSceneData.load().audio;
  const fire = AudioConfig.load().emitters.fire;
  const audio = AudioService.for(game);
  const at = Vector3.FromArray(layout.fire).add(new Vector3(0, fire.lift, 0));
  audio.spatial.add({ id: "fire:dev", sound: fire.sound, volume: fire.volume, maxDistance: fire.maxDistance, rate: 1, position: () => at, level: () => layout.fireIntensity });
  audio.startMusic();
}
