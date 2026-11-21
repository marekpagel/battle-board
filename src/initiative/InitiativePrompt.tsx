import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CloseRounded from "@mui/icons-material/CloseRounded";
import { encounterStore, useEncounter, type Combatant } from "../encounter";
import { initiativePromptTargets } from "../encounter/initiativePrompt";
import { usePlayerIdentity } from "../turnbar/usePlayerIdentity";
import { useRole } from "../hooks/useRole";
import { initiativePromptUI } from "./popup";

function InitiativeInput({ combatant, name, bonus, autoFocus, onDone }: {
    combatant: Combatant; name: string; bonus: number; autoFocus: boolean; onDone(): void;
}) {
    const [value, setValue] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const submitting = useRef(false);
    const submit = async (initiative: number) => {
        if (submitting.current) return;
        submitting.current = true;
        setBusy(true); setError("");
        try {
            await encounterStore.submitRequestedInitiative(combatant.id, initiative);
            onDone();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Unable to save initiative.");
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    };
    return <Box component="form" onSubmit={(event) => { event.preventDefault(); if (value.trim()) void submit(Number(value)); }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Avatar src={combatant.imageUrl} alt="" sx={{ width: 36, height: 36 }} />
            <Typography sx={{ fontWeight: 600 }}>{name}</Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
            <TextField label="Initiative total" value={value} onChange={(event) => setValue(event.target.value)}
                autoFocus={autoFocus} size="small" fullWidth disabled={busy}
                slotProps={{ htmlInput: { inputMode: "decimal", "aria-label": `Initiative total for ${name}` } }} />
            <Button type="submit" variant="contained" size="small" disabled={busy || !value.trim() || !Number.isFinite(Number(value))}>Set</Button>
            <Button size="small" disabled={busy} onClick={() => void submit(1 + Math.floor(Math.random() * 20) + bonus)} sx={{ minWidth: 0 }}>Roll</Button>
        </Stack>
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </Box>;
}

export function InitiativePrompt() {
    const encounter = useEncounter();
    const { playerId } = usePlayerIdentity();
    const role = useRole();
    const [ids] = useState(() => new Set(new URLSearchParams(window.location.search).getAll("token")));
    const [answered, setAnswered] = useState<Set<string>>(new Set());
    const targets = playerId && role === "PLAYER" ? initiativePromptTargets(encounter, playerId)
        .filter((c) => ids.has(c.id) && !answered.has(c.id)) : [];
    const finished = encounter.ready && !!playerId && targets.length === 0;
    useEffect(() => {
        if (finished) void initiativePromptUI.close().catch(console.error);
    }, [finished]);
    return <Box sx={{ p: 2, overflowY: "auto", height: "100%", boxSizing: "border-box" }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: "1rem", fontWeight: 600 }}>Initiative</Typography>
            <IconButton size="small" aria-label="Close initiative prompt" onClick={() => void initiativePromptUI.close().catch(console.error)}><CloseRounded fontSize="small" /></IconButton>
        </Stack>
        <Stack spacing={2}>
            {targets.map((combatant, index) => {
                const group = encounter.groups.find((g) => g.id === combatant.groupId);
                return <InitiativeInput key={combatant.id} combatant={combatant} name={group?.name ?? combatant.name}
                    bonus={group?.initiativeBonus ?? combatant.initiativeBonus} autoFocus={index === 0}
                    onDone={() => setAnswered((prev) => new Set([...prev, combatant.id]))} />;
            })}
        </Stack>
    </Box>;
}
