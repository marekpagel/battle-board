import type { Combatant } from "./combatant";
import type { Group } from "./groups";

/** PCs stay available for manual initiative entry, including before the encounter starts. */
export function playerCombatants(combatants: Combatant[], groups: Group[], started: boolean, listDisabled: boolean): Combatant[] {
    const staged = new Set(groups.filter((g) => g.staged).map((g) => g.id));
    return combatants.filter((c) => c.playerCharacter || (
        started && !listDisabled && c.visible && !(c.groupId && staged.has(c.groupId))
    ));
}
