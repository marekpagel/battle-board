import { useState } from "react";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Combatant } from "../encounter";
import { encounterStore } from "../encounter";
import { profileStore, useProfiles } from "../profiles";
import { findProfile } from "../profiles/profiles";

/** Named templates are managed by the DM from each combatant's expanded options. */
export function ProfileControls({ row }: { row: Combatant }) {
    const { ready, profiles } = useProfiles();
    const exists = !!findProfile(profiles, row.name);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState(false);
    const act = async (command: () => Promise<void>, success: string) => {
        setBusy(true); setMessage(""); setError(false);
        try { await command(); setMessage(success); }
        catch (e) { setError(true); setMessage(e instanceof Error ? e.message : "Unable to update the profile."); }
        finally { setBusy(false); }
    };
    const buttonSx = { minWidth: 0, p: 0, fontSize: "0.7rem" };
    return <Stack spacing={0.25} sx={{ my: 0.5 }} onClick={(e) => e.stopPropagation()}>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
            <Typography sx={{ fontSize: "0.75rem", color: "text.secondary" }}>Profile: {row.name}</Typography>
            <Button disabled={!ready || busy} sx={buttonSx}
                onClick={() => void act(() => encounterStore.saveProfile(row.id), `Profile saved for ${row.name}.`)}>
                {exists ? "Update profile" : "Save profile"}
            </Button>
            {exists && <>
                <Button disabled={busy} sx={buttonSx}
                    onClick={() => void act(() => encounterStore.loadProfile(row.id), "Profile loaded. HP restored to max.")}>Load profile</Button>
                <Button disabled={busy} sx={buttonSx}
                    onClick={() => void act(() => profileStore.forget(row.name), "Saved profile forgotten.")}>Forget profile</Button>
            </>}
        </Stack>
        <Typography sx={{ fontSize: "0.65rem", color: "text.secondary" }}>
            Saves max HP, speed, AC, initiative bonus and PC/NPC. New tokens with this name load it when added.
        </Typography>
        {message && <Typography role={error ? "alert" : "status"} sx={{ fontSize: "0.7rem", color: error ? "error.main" : "text.secondary" }}>{message}</Typography>}
    </Stack>;
}
