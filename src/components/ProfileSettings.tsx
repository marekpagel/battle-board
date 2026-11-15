import { useMemo, useState } from "react";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import { profileStore, useProfiles } from "../profiles";
import { parseProfileStorage } from "../profiles/profiles";

export function ProfileSettings() {
    const { ready, profiles } = useProfiles();
    const entries = Object.entries(profiles).sort(([a], [b]) => a.localeCompare(b));
    const storage = JSON.stringify(Object.fromEntries(entries), null, 2);
    // Room changes refresh the saved view without discarding an in-progress edit.
    const [draft, setDraft] = useState<string | null>(null);
    const text = draft ?? storage;
    const [mode, setMode] = useState<"merge" | "replace">("merge");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState(false);
    const validation = useMemo(() => {
        try { return { count: Object.keys(parseProfileStorage(text)).length, error: "" }; }
        catch (e) { return { count: 0, error: e instanceof Error ? e.message : "Invalid profile JSON." }; }
    }, [text]);

    const act = async (command: () => Promise<void>, success: string) => {
        setBusy(true); setMessage(""); setError(false);
        try { await command(); setMessage(success); }
        catch (e) { setError(true); setMessage(e instanceof Error ? e.message : "Unable to update profiles."); }
        finally { setBusy(false); }
    };
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(storage);
            setError(false); setMessage("Saved profile JSON copied.");
        } catch {
            setError(false);
            setMessage(draft === null ? "Select and copy the JSON below using your device's Copy action." : "Reload saved JSON to view the saved storage, then select and copy it using your device's Copy action.");
        }
    };
    const paste = async () => {
        try {
            const incoming = await navigator.clipboard.readText();
            setDraft(incoming); setError(false); setMessage("Review the pasted JSON, then import it.");
        } catch {
            setError(false); setMessage("Paste into the JSON field using your device's Paste action.");
        }
    };
    return <Accordion elevation={0} disableGutters square sx={{ border: 1, borderColor: "divider", borderRadius: 1, "&:before": { display: "none" } }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ px: 1, minHeight: 38 }}>
            <Typography sx={{ fontWeight: 700, fontSize: "0.85rem" }}>Saved Profiles ({entries.length})</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 1 }}>
            <Stack spacing={1}>
                <Typography sx={{ fontSize: "0.75rem", color: "text.secondary" }}>
                    Profiles are shared across scenes in this room. Saving, importing or deleting a profile leaves existing tokens unchanged.
                </Typography>
                {!ready ? <Typography variant="body2">Loading profiles…</Typography> : entries.length === 0 ? (
                    <Typography variant="body2">No saved profiles. Save one from a combatant's expanded options, or paste profile JSON below.</Typography>
                ) : <TableContainer sx={{ maxHeight: 240 }}>
                    <Table size="small" aria-label="Saved character profiles" stickyHeader sx={{ "& th, & td": { px: 0.5, py: 0.5, fontSize: "0.7rem" } }}>
                        <TableHead><TableRow>
                            <TableCell>Name</TableCell><TableCell>Type</TableCell><TableCell align="right">Max HP</TableCell>
                            <TableCell align="right">Speed</TableCell><TableCell align="right">AC</TableCell><TableCell align="right">Bonus</TableCell><TableCell />
                        </TableRow></TableHead>
                        <TableBody>{entries.map(([name, stats]) => <TableRow key={name}>
                            <TableCell sx={{ overflowWrap: "anywhere" }}>{name}</TableCell><TableCell>{stats.playerCharacter ? "PC" : "NPC"}</TableCell>
                            <TableCell align="right">{stats.maxHP}</TableCell><TableCell align="right">{stats.movement}</TableCell>
                            <TableCell align="right">{stats.ac}</TableCell><TableCell align="right">{stats.initiativeBonus}</TableCell>
                            <TableCell><Button size="small" color="error" disabled={busy} aria-label={`Delete profile ${name}`} sx={{ minWidth: 0, p: 0 }}
                                onClick={() => void act(() => profileStore.forget(name), `Profile “${name}” deleted.`)}>Delete</Button></TableCell>
                        </TableRow>)}</TableBody>
                    </Table>
                </TableContainer>}
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Button size="small" disabled={!ready || busy} onClick={() => void copy()}>Copy saved JSON</Button>
                    <Button size="small" disabled={!ready || busy} onClick={() => void paste()}>Paste JSON</Button>
                    <Button size="small" disabled={!ready || busy || draft === null} onClick={() => { setDraft(null); setMessage(""); }}>Reload saved JSON</Button>
                </Stack>
                <TextField label="Profile storage (JSON)" multiline minRows={5} maxRows={12} fullWidth size="small"
                    value={text} disabled={!ready || busy} error={!!validation.error}
                    onChange={(e) => { setDraft(e.target.value); setMessage(""); }}
                    helperText={validation.error || "Keys are token names; movement is speed. Edit the JSON or paste a copy from another room."}
                    slotProps={{ htmlInput: { spellCheck: false, "aria-label": "Profile storage JSON" } }}
                    sx={{ "& textarea": { fontFamily: "monospace", fontSize: "0.75rem" } }} />
                <TextField select label="Import mode" size="small" value={mode} disabled={busy}
                    onChange={(e) => setMode(e.target.value as "merge" | "replace")}
                    helperText={mode === "merge" ? "Keeps other profiles and updates names included in the JSON." : "Replaces all saved profiles. Names omitted from the JSON will be deleted."}>
                    <MenuItem value="merge">Merge by name</MenuItem><MenuItem value="replace">Replace all profiles</MenuItem>
                </TextField>
                <Button size="small" variant="text" disabled={!ready || busy || !!validation.error}
                    onClick={() => void act(async () => { await profileStore.importStorage(text, mode); setDraft(null); }, `${validation.count} profiles imported.`)}>
                    {mode === "merge" ? "Import profiles" : "Replace all profiles"} ({validation.count})
                </Button>
                {message && <Typography role={error ? "alert" : "status"} sx={{ fontSize: "0.75rem", color: error ? "error.main" : "text.secondary" }}>{message}</Typography>}
            </Stack>
        </AccordionDetails>
    </Accordion>;
}
