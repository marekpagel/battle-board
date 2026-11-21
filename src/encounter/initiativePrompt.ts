import type { Combatant } from "./combatant";
import { turnOrder, type TurnState } from "./turnOrder";

/** One input per owned PC turn. Shared turns require ownership of every member. */
export function initiativePromptTargets(state: TurnState, playerId?: string): Combatant[] {
    if (state.started) return [];
    return turnOrder(state).flatMap((turn) => {
        if ((turn.kind === "group" ? turn.group.initiative : turn.combatant.initiative) !== 0) return [];
        const members = turn.kind === "group" ? turn.members : [turn.combatant];
        const pc = members.find((c) => c.playerCharacter && c.visible && (!playerId || c.ownerId === playerId));
        if (!pc || members.some((member) => member.ownerId !== pc.ownerId)) return [];
        return [pc];
    });
}

