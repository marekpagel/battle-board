import type { HealthMode, InitiativeSettings } from "../settings/settings";
import type { BroadcastDestination } from "../obr/port";
import type { Combatant, CombatantPatch } from "./combatant";

type HP = Pick<Combatant, "currentHP" | "maxHP" | "tempHP" | "concentrating">;

/** The fields to write, and the concentration check the change triggers, if any. */
export type HealthChange = { patch: CombatantPatch; concentrationCheck: { dc: number } | null };

/**
 * Set current HP to `value` (clamped to 0…max). Lowering it is damage, which
 * temp HP absorbs first; raising it is healing.
 */
export function setCurrent(c: HP, value: number): HealthChange {
    const target = clamp(value, 0, Math.max(0, c.maxHP));
    const damage = c.currentHP - target;
    if (damage <= 0) return change(c, { currentHP: target });

    const absorbed = Math.min(damage, c.tempHP);
    return change(c, { tempHP: c.tempHP - absorbed, currentHP: Math.max(0, c.currentHP - (damage - absorbed)) });
}

/** Apply the full damage amount before clamping HP, even when it exceeds current HP. */
export function adjustCurrent(c: HP, delta: number): HealthChange {
    if (delta >= 0) return setCurrent(c, c.currentHP + delta);
    const absorbed = Math.min(-delta, c.tempHP);
    return change(c, {
        tempHP: c.tempHP - absorbed,
        currentHP: Math.max(0, c.currentHP + delta + absorbed),
    });
}

/**
 * Set temp HP to `value`. Lowering it below the current temp HP is damage:
 * whatever the temp HP cannot absorb spills into current HP.
 */
export function setTemp(c: HP, value: number): HealthChange {
    if (value >= c.tempHP) return change(c, { tempHP: Math.max(0, value) });

    const damage = c.tempHP - value;
    const overflow = Math.max(0, damage - c.tempHP);
    return change(c, { tempHP: Math.max(0, value), currentHP: Math.max(0, c.currentHP - overflow) });
}

/** A max HP edit refills current HP to match; stat corrections are not damage. */
export function setMax(value: number): HealthChange {
    const maxHP = Math.max(0, value);
    return { patch: { maxHP, currentHP: maxHP }, concentrationCheck: null };
}

/** Any loss of total HP (temp + current) while concentrating needs a check: DC max(10, half the loss). */
function change(c: HP, patch: CombatantPatch): HealthChange {
    const before = c.currentHP + c.tempHP;
    const after = (patch.currentHP ?? c.currentHP) + (patch.tempHP ?? c.tempHP);
    const loss = before - after;
    return {
        patch,
        concentrationCheck: c.concentrating && loss > 0 ? { dc: Math.max(10, Math.floor(loss / 2)) } : null,
    };
}

export type HealthStatus = "Healthy" | "Bloodied" | "Dying" | "Dead";

export function status(c: Pick<Combatant, "currentHP" | "maxHP" | "playerCharacter">): HealthStatus {
    if (c.currentHP === 0) return c.playerCharacter ? "Dying" : "Dead";
    return c.maxHP > 0 && c.currentHP < c.maxHP / 2 ? "Bloodied" : "Healthy";
}

/** Shared palette choice for health status in the tracker and on the map. */
export function statusColorKey(value: HealthStatus): "error" | "warning" | "success" {
    return value === "Dead" || value === "Dying" ? "error" : value === "Bloodied" ? "warning" : "success";
}

type HealthSettings = Pick<InitiativeSettings, "displayHealthStatusToPlayer" | "pcHealthMode" | "npcHealthMode" | "playerEditableHealth">;

/** What players may see of this combatant's health. */
export function playerHealthMode(c: Pick<Combatant, "playerCharacter">, settings: HealthSettings): HealthMode {
    if (!settings.displayHealthStatusToPlayer) return "none";
    return c.playerCharacter ? settings.pcHealthMode : settings.npcHealthMode;
}

/** Whether players see a health column at all. */
export function showPlayerHealthColumn(settings: HealthSettings): boolean {
    return playerHealthMode({ playerCharacter: true }, settings) !== "none"
        || playerHealthMode({ playerCharacter: false }, settings) !== "none";
}

/** Whether the mode shows HP as numbers (with or without a bar). */
export function showsNumbers(mode: HealthMode): boolean {
    return mode === "numbers" || mode === "barNumbers";
}

/** Whether the mode shows a health bar. */
export function showsBar(mode: HealthMode): boolean {
    return mode === "bar" || mode === "barNumbers";
}

/** The one rule for player HP editing: enabled, a PC, and PC health shown as numbers. */
export function playerCanEditHP(c: Pick<Combatant, "playerCharacter">, settings: HealthSettings): boolean {
    return settings.playerEditableHealth && c.playerCharacter && showsNumbers(playerHealthMode(c, settings));
}

/** Share of max HP left, 0…1, or null when no max HP is set. */
export function healthFraction(c: Pick<Combatant, "currentHP" | "maxHP">): number | null {
    if (c.maxHP <= 0) return null;
    return clamp(c.currentHP / c.maxHP, 0, 1);
}

/** Shared green → yellow → red palette, matching HSL(hue, 70%, 45%).
 * Hex output works in both CSS and Owlbear's native drawing styles.
 */
export function healthColor(fraction: number): string {
    const hue = Math.round(clamp(fraction, 0, 1) * 120) / 60;
    const saturation = 0.7, lightness = 0.45;
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const offset = lightness - chroma / 2;
    const rgb = [hue <= 1 ? chroma : chroma * (2 - hue), hue <= 1 ? chroma * hue : chroma, 0];
    return `#${rgb.map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Who is told about a concentration check: everyone for a PC (its player
 * rolls), only the sending client for an NPC. Players can only edit PCs, so
 * NPC checks never leave the GM's client.
 */
export function concentrationAudience(c: Pick<Combatant, "playerCharacter">): BroadcastDestination {
    return c.playerCharacter ? "ALL" : "LOCAL";
}

function clamp(n: number, min: number, max: number) {
    return Math.min(Math.max(n, min), max);
}
