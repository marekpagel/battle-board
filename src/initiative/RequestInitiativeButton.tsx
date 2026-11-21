import { useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import Button from "@mui/material/Button";
import { obrAdapter } from "../obr/obrAdapter";
import { requestPlayerInitiative } from "./requests";

export function RequestInitiativeButton({ disabled }: { disabled: boolean }) {
    const [busy, setBusy] = useState(false);
    const request = async () => {
        setBusy(true);
        try {
            const count = await requestPlayerInitiative(obrAdapter);
            await OBR.notification.show(count ? `Initiative requested from ${count} player${count === 1 ? "" : "s"}.`
                : "No connected players have PCs waiting for initiative.", "INFO");
        } catch (cause) {
            await OBR.notification.show(cause instanceof Error ? cause.message : "Unable to request initiative.", "ERROR");
        } finally {
            setBusy(false);
        }
    };
    return <Button size="small" variant="text" disabled={disabled || busy} onClick={() => void request()}
        sx={{ minWidth: 0, p: 0, border: 0, borderRadius: 0, fontSize: "0.75rem" }}>Request player initiative</Button>;
}
