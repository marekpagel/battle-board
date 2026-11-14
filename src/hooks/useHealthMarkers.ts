import { useEffect } from "react";
import { obrAdapter } from "../obr/obrAdapter";
import { startHealthMarkerSync } from "../overlays/healthMarkers";

/** Keep map badges in sync with saved HP while a GM's tracker is open. */
export function useHealthMarkers(ready: boolean) {
    useEffect(() => {
        if (ready) return startHealthMarkerSync(obrAdapter);
    }, [ready]);
}
