import { useState } from "react";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { CommitNumberField } from "./CommitFields";
import { encounterStore } from "../encounter";

export function InitiativeBonusField({ id, bonus, group = false }: { id: string; bonus: number; group?: boolean }) {
    return <Stack spacing={0} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography component="span" sx={{ fontSize: "0.75rem", color: "text.secondary" }}>{group ? "Group initiative bonus" : "Initiative bonus"}</Typography>
            <CommitNumberField value={bonus} variant="standard" size="small" finalize={Math.trunc}
                inputMode="text" slotProps={{ input: { disableUnderline: true }, htmlInput: { "aria-label": group ? "group initiative bonus" : "initiative bonus" } }}
                onCommit={(value) => {
                    const result = group ? encounterStore.setGroupInitiativeBonus(id, value) : encounterStore.patch(id, { initiativeBonus: value });
                    result.catch(console.error);
                }} sx={{ width: 24, "& input": { p: 0, textAlign: "center", fontSize: "0.7rem", height: "auto" } }} />
        </Stack>
    </Stack>;
}

export function InitiativeRollButton({ id, initiative, group = false, playerId, started }: { id: string; initiative: number; group?: boolean; playerId?: string; started: boolean }) {
    const [error, setError] = useState("");
    if (initiative !== 0 || (playerId && started)) return null;
    return <><Button size="small" variant="text" aria-label={group ? "Roll group initiative" : "Roll initiative"}
        onClick={(e) => {
            e.stopPropagation();
            setError("");
            const roll = playerId ? encounterStore.rollPlayerInitiative(playerId) : encounterStore.rollInitiative(id);
            roll.catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to roll initiative."));
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        sx={{ minWidth: 0, p: 0, border: 0, borderRadius: 0, fontSize: "0.65rem", lineHeight: 1.5 }}>Roll</Button>
        <Snackbar open={!!error} onClose={() => setError("")} onClick={(e) => e.stopPropagation()}>
            <Alert severity="error" onClose={() => setError("")}>{error}</Alert>
        </Snackbar>
    </>;
}
