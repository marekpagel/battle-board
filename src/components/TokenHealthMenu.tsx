import { useLayoutEffect, useRef, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CloseRounded from "@mui/icons-material/CloseRounded";
import { encounterStore, useEncounter } from "../encounter";
import { useRole } from "../hooks/useRole";
import { HealthBar } from "./HealthDisplay";
import { HEALTH_POPOVER_ID } from "./tokenHealthAction";

export function TokenHealthMenu() {
    const [ids] = useState(() => [...new Set(new URLSearchParams(window.location.search).getAll("token"))]);
    const encounter = useEncounter();
    const role = useRole();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const content = useRef<HTMLDivElement | null>(null);
    const inFlight = useRef(false);
    const targets = ids.map((id) => encounter.combatants.find((c) => c.id === id)).filter((c) => c !== undefined);
    const available = role === "GM" && encounter.ready && ids.length > 0 && targets.length === ids.length;

    useLayoutEffect(() => {
        const element = content.current;
        if (!element) return;
        let lastHeight = 0;
        const fit = () => {
            const height = Math.ceil(element.getBoundingClientRect().height);
            if (height > 0 && height !== lastHeight) {
                lastHeight = height;
                void OBR.popover.setHeight(HEALTH_POPOVER_ID, height).catch(console.error);
            }
        };
        fit();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(fit);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const apply = async (delta: number) => {
        if (!available || inFlight.current || !Number.isSafeInteger(delta) || delta === 0) return;
        inFlight.current = true;
        setBusy(true);
        setError(null);
        try {
            if (await OBR.player.getRole() !== "GM") throw new Error("Only the DM can use these health controls.");
            await encounterStore.adjustHP(ids, delta);
        } catch (error) {
            setError(error instanceof Error ? error.message : "Could not update health. Try again.");
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    };

    return (
        <Stack ref={content} component="section" aria-label="Token health controls" spacing={0.5}
            sx={{ p: 0.75, flexShrink: 0, boxSizing: "border-box", color: "text.primary", bgcolor: "background.paper" }}>
            <Stack direction="row" spacing={0.5} alignItems="flex-start">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    {role !== "GM" ? <Alert severity="info">DM controls only.</Alert> : !encounter.ready ? (
                        <Typography variant="body2">Loading health…</Typography>
                    ) : !available ? (
                        <Alert severity="info">Select a token in initiative and reopen these controls.</Alert>
                    ) : (
                        <Stack spacing={0.5} sx={{ maxHeight: 100, overflowY: "auto" }}>
                            {targets.map((target) => (
                                <Stack key={target.id} direction="row" spacing={0.75} alignItems="center">
                                    <Avatar src={target.imageUrl} alt={target.name} sx={{ width: 30, height: 30 }} />
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography noWrap sx={{ fontSize: "0.8rem", fontWeight: 600 }}>{target.name}</Typography>
                                        <Typography sx={{ fontSize: "0.75rem" }}>
                                            {target.currentHP} / {target.maxHP} HP{target.tempHP > 0 ? ` · ${target.tempHP} temp` : ""}
                                        </Typography>
                                        <HealthBar row={target} />
                                    </Box>
                                </Stack>
                            ))}
                        </Stack>
                    )}
                </Box>
                <IconButton size="small" aria-label="Close health controls" sx={{ p: 0.25 }}
                    onClick={() => void OBR.popover.close(HEALTH_POPOVER_ID).catch(console.error)}>
                    <CloseRounded sx={{ fontSize: 16 }} />
                </IconButton>
            </Stack>
            {available && <>
                <Stack direction="row" justifyContent="space-between">
                    {[-5, -1, 1, 5].map((delta) => (
                        <Button key={delta} size="small" disabled={busy} onClick={() => void apply(delta)}
                            aria-label={`${delta < 0 ? "Deal" : "Heal"} ${Math.abs(delta)} HP${ids.length > 1 ? " to each selected token" : ""}`}
                            sx={{ minWidth: 44, minHeight: 30, p: 0, color: delta < 0 ? "error.main" : "success.main" }}>
                            {delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}
                        </Button>
                    ))}
                </Stack>
                {ids.length > 1 && <Typography sx={{ fontSize: "0.65rem", color: "text.secondary" }}>Applies to each selected token.</Typography>}
            </>}
            {error && <Typography role="alert" sx={{ fontSize: "0.75rem", color: "error.main" }}>{error}</Typography>}
        </Stack>
    );
}
