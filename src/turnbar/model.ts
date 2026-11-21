import type { Role } from "../obr/port";
import { barCombatants } from "../encounter/turnResources";
import { turnOrder, type TurnState } from "../encounter/turnOrder";

/** GMs follow the active turn, including hidden combatants and every group member. */
export function dmBarCombatants(state: TurnState) {
    const active = turnOrder(state).find((turn) => turn.active);
    return active ? active.kind === "group" ? active.members : [active.combatant] : [];
}

/** The GM's own bar is independent of the setting that enables player bars. */
export function showTurnBar(state: TurnState, role: Role, playerId: string | null, playerBars: boolean, hidden: boolean) {
    if (!state.started || hidden) return false;
    if (role === "GM") return turnOrder(state).length > 0;
    return playerBars && !!playerId && barCombatants(state, playerId).length > 0;
}
