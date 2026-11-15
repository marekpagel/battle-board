import { getPluginId } from "../getPluginId";
import type { Combatant } from "../encounter/combatant";

export const PROFILES_META_KEY = getPluginId("characterProfiles");
/** Reusable stats only; encounter state always remains on individual tokens. */
export type CharacterProfile = Pick<Combatant, "maxHP" | "movement" | "ac" | "initiativeBonus" | "playerCharacter">;
export type CharacterProfiles = Record<string, CharacterProfile>;
export const profileKey = (name: string) => name.trim().toLowerCase();

export function profileOf(stats: CharacterProfile): CharacterProfile {
    return { maxHP: stats.maxHP, movement: stats.movement, ac: stats.ac, initiativeBonus: stats.initiativeBonus, playerCharacter: stats.playerCharacter };
}

function validProfile(value: unknown): value is CharacterProfile {
    if (!value || typeof value !== "object") return false;
    const p = value as Record<string, unknown>;
    return [p.maxHP, p.movement, p.ac].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)
        && typeof p.initiativeBonus === "number" && Number.isFinite(p.initiativeBonus)
        && typeof p.playerCharacter === "boolean";
}

export function readProfiles(raw: unknown): CharacterProfiles {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([name, value]) => name.trim() && validProfile(value))
        .map(([name, value]) => [profileKey(name), profileOf(value as CharacterProfile)]));
}

export function findProfile(profiles: CharacterProfiles, name: string): CharacterProfile | undefined {
    const key = profileKey(name);
    return Object.hasOwn(profiles, key) ? profiles[key] : undefined;
}

/** Validate pasted storage in full before writing any profiles. */
export function parseProfileStorage(text: string): CharacterProfiles {
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch { throw new Error("Enter valid JSON before importing profiles."); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Profile storage must be a JSON object keyed by character names.");
    }
    const entries: [string, CharacterProfile][] = [];
    const names = new Set<string>();
    for (const [name, value] of Object.entries(raw)) {
        const key = profileKey(name);
        if (!key) throw new Error("Every profile must have a character name.");
        if (names.has(key)) throw new Error(`More than one profile matches the name “${name.trim()}”.`);
        if (!validProfile(value)) {
            throw new Error(`Profile “${name}” needs nonnegative maxHP, movement and ac, a numeric initiativeBonus, and a boolean playerCharacter.`);
        }
        names.add(key);
        entries.push([key, profileOf(value)]);
    }
    return Object.fromEntries(entries);
}
