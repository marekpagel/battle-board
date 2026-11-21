import { useEffect } from "react";
import { encounterStore } from "./encounter";
import { useSettings } from "./settings";
import { obrAdapter } from "./obr/obrAdapter";
import { useRole } from "./hooks/useRole";
import { useRingSync } from "./hooks/useRingSync";
import { useElevationLabels } from "./hooks/useElevationLabels";
import { useHealthBars } from "./hooks/useHealthBars";
import { useInitiativeBadges } from "./hooks/useInitiativeBadges";
import { useTurnEndSync } from "./hooks/useTurnEndSync";
import { useTurnBarPopover } from "./turnbar/useTurnBarPopover";
import { usePlayerIdentity } from "./turnbar/usePlayerIdentity";
import { registerInitiativeContextMenu } from "./components/initiativeMenu";
import { runSavedDataMigrations } from "./settings/migrations";

/** Scene services live in the background so the main extension panel can be closed. */
export function SceneRuntime() {
    const role = useRole();
    const { settings } = useSettings();
    const { playerId } = usePlayerIdentity();
    useRingSync(true);
    useElevationLabels(true);
    useHealthBars(true, role);
    useInitiativeBadges(true, role);
    useTurnEndSync(true);
    useTurnBarPopover(role, playerId, settings);
    useEffect(() => registerInitiativeContextMenu(), []);
    useEffect(() => {
        void runSavedDataMigrations(obrAdapter).catch(console.error);
        return () => encounterStore.dispose();
    }, []);
    return null;
}
