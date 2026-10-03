import { Palette } from "../utils/Palette";
import type { WeaponInventory, WeaponSlotInfo } from "../weapons/WeaponInventory";
import type { SlotsData } from "./HudConfig";

const SLOTS_ID = "weapon-slots";
/** Panel opacity as a hex alpha (LEGACY §4 panels `…bf`). */
const PANEL_ALPHA_HEX = "bf";
const RADIUS_PX = 3;
const BORDER_PX = 2;

interface SlotView {
  box: HTMLDivElement;
  slot: number;
}

/**
 * Weapon slots 1–6 at the bottom centre (phase 10 HUD, LEGACY §3 „{1–4} Tužka“): the slot number and the weapon name;
 * owned weapons are bright, the one in hand has the lime frame of the old game, the rest are dim.
 */
export class WeaponSlotsBar {
  readonly element: HTMLDivElement;
  private readonly views: SlotView[] = [];
  private lastState = "";

  constructor(
    parent: HTMLElement,
    private readonly inventory: WeaponInventory,
    private readonly data: SlotsData,
    fontFamily: string,
  ) {
    this.element = document.createElement("div");
    this.element.id = SLOTS_ID;
    Object.assign(this.element.style, {
      position: "fixed",
      left: "50%",
      bottom: `${data.gap * 2}px`,
      transform: "translateX(-50%)",
      display: "flex",
      gap: `${data.gap}px`,
      pointerEvents: "none",
      fontFamily,
    });
    for (const info of inventory.slots()) this.views.push(this.slotView(info));
    parent.append(this.element);
    this.refresh();
  }

  /** Slots as the HUD shows them: number, name, owned, active. */
  state(): { slot: number; name: string; owned: boolean; active: boolean }[] {
    const active = this.inventory.active?.id ?? null;
    return this.inventory.slots().map((s) => ({ slot: s.slot, name: s.name, owned: s.owned, active: s.id === active }));
  }

  /** Restyles the slots when ownership or the active weapon changed. */
  refresh(): void {
    const state = this.state();
    const key = JSON.stringify(state);
    if (key === this.lastState) return;
    this.lastState = key;
    const { colors } = this.data;
    for (const view of this.views) {
      const slot = state.find((s) => s.slot === view.slot);
      if (slot === undefined) continue;
      Object.assign(view.box.style, {
        opacity: slot.owned ? "1" : String(this.data.missingOpacity),
        borderColor: Palette.hex(slot.active ? colors.active : colors.border),
        background: slot.active ? Palette.hex(colors.activeBackground) : `${Palette.hex(colors.panel).slice(0, 7)}${PANEL_ALPHA_HEX}`,
        color: Palette.hex(slot.active ? colors.active : colors.text),
      });
    }
  }

  dispose(): void {
    this.element.remove();
  }

  private slotView(info: WeaponSlotInfo): SlotView {
    const box = document.createElement("div");
    Object.assign(box.style, {
      width: `${this.data.width}px`,
      height: `${this.data.height}px`,
      border: `${BORDER_PX}px solid`,
      borderRadius: `${RADIUS_PX}px`,
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    });
    const number = document.createElement("span");
    number.textContent = String(info.slot);
    Object.assign(number.style, { fontSize: `${this.data.numberSize}px`, fontWeight: "800", lineHeight: "1" });
    const name = document.createElement("span");
    name.textContent = info.name;
    Object.assign(name.style, { fontSize: `${this.data.nameSize}px`, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", maxWidth: "100%" });
    box.append(number, name);
    this.element.append(box);
    return { box, slot: info.slot };
  }
}
