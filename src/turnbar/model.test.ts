import { describe, expect, it } from "vitest";
import type { Combatant } from "../encounter/combatant";
import { deriveGroups } from "../encounter/groups";
import type { TurnState } from "../encounter/turnOrder";
import { dmBarCombatants, showTurnBar } from "./model";

const c = (id: string, extra: Partial<Combatant> = {}): Combatant => ({
    id, name: id, initiative: 10, initiativeBonus: 0, groupInitiativeBonus: 0, active: false, visible: true,
    ac: 10, currentHP: 10, maxHP: 10, tempHP: 0, movement: 30, attackRange: 60, elevation: 0,
    playerCharacter: false, ownerId: "another-player", ...extra,
});
const state = (combatants: Combatant[], started = true): TurnState => ({ combatants, groups: deriveGroups(combatants), started, round: 1 });

describe("turn bar visibility and DM targets", () => {
    it("shows the GM bar without owning a token or enabling player bars, including a hidden active NPC", () => {
        const encounter = state([c("hidden", { active: true, visible: false })]);
        expect(showTurnBar(encounter, "GM", null, false, false)).toBe(true);
        expect(dmBarCombatants(encounter).map((combatant) => combatant.id)).toEqual(["hidden"]);
        expect(showTurnBar(encounter, "GM", "gm", true, true)).toBe(false);
    });

    it("follows active PCs as well as every member of an active group in member order", () => {
        expect(dmBarCombatants(state([c("pc", { active: true, playerCharacter: true }), c("idle")])).map((combatant) => combatant.id)).toEqual(["pc"]);
        const encounter = state([
            c("b", { groupId: "g", groupIndex: 1, active: true }),
            c("a", { groupId: "g", groupIndex: 0, active: true, visible: false }), c("idle"),
        ]);
        expect(dmBarCombatants(encounter).map((combatant) => combatant.id)).toEqual(["a", "b"]);
    });

    it("hides after ending the encounter or with no turns, excluding staged groups", () => {
        expect(showTurnBar(state([c("npc")], false), "GM", null, false, false)).toBe(false);
        expect(showTurnBar(state([]), "GM", null, false, false)).toBe(false);
        expect(showTurnBar(state([c("staged", { groupId: "g", groupStaged: true })]), "GM", null, false, false)).toBe(false);
    });

    it("preserves the player's setting, ownership and visibility requirements", () => {
        const encounter = state([c("pc", { ownerId: "alice" })]);
        expect(showTurnBar(encounter, "PLAYER", "alice", true, false)).toBe(true);
        expect(showTurnBar(encounter, "PLAYER", "alice", false, false)).toBe(false);
        expect(showTurnBar(encounter, "PLAYER", "bob", true, false)).toBe(false);
        expect(showTurnBar(encounter, "PLAYER", "alice", true, true)).toBe(false);
        expect(showTurnBar(state([c("hidden", { ownerId: "alice", visible: false })]), "PLAYER", "alice", true, false)).toBe(false);
    });
});
