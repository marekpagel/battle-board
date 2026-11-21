import { useEffect } from "react";
import { useEncounter } from "../encounter";
import type { Role } from "../obr/port";
import type { InitiativeSettings } from "../settings";
import { showTurnBar } from "./model";
import { useTurnBarPreferences } from "./preferences";
import { startTurnBarPopover } from "./popover";

/** The background frame owns the popup's lifetime, independently of the main panel. */
export function useTurnBarPopover(role: Role, playerId: string | null, settings: InitiativeSettings) {
    const encounter = useEncounter();
    const { position, hidden } = useTurnBarPreferences();
    const show = encounter.ready && showTurnBar(encounter, role, playerId, settings.turnBar, hidden);
    useEffect(() => {
        if (show) return startTurnBarPopover(position);
    }, [show, position]);
}
