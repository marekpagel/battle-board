import { useMemo } from "react";
import type { Combatant } from "../encounter";
import { ringStyle, type RingStyle } from "../overlays/rings";

export type { RingStyle };

export type RingConfig = {
    movement: number;
    movementStyle: RingStyle;
};

/** A combatant's ring settings with defaults applied, for the ring controls. */
export function useRingState(row: Combatant) {
    const config = useMemo((): RingConfig => ({
        movement: row.movement,
        movementStyle: ringStyle(row, "move"),
    }), [row]);

    return { config };
}
