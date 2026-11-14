import type { Role } from "../obr/port";
import { useTheme } from "@mui/material/styles";
import { useEffect } from "react";
import { obrAdapter } from "../obr/obrAdapter";
import { startHealthBarSync } from "../overlays/healthBars";

export function useHealthBars(ready: boolean, role: Role) {
    const { palette } = useTheme();
    const success = palette.success.main, warning = palette.warning.main, error = palette.error.main;
    useEffect(() => {
        if (ready) return startHealthBarSync(obrAdapter, undefined, { success, warning, error });
    }, [ready, role, success, warning, error]);
}
