import { useEffect } from "react";
import { obrAdapter } from "../obr/obrAdapter";
import type { Role } from "../obr/port";
import { startInitiativeBadgeSync } from "../overlays/initiativeBadges";

export function useInitiativeBadges(ready: boolean, role: Role) {
    useEffect(() => {
        if (ready) return startInitiativeBadgeSync(obrAdapter);
    }, [ready, role]);
}
