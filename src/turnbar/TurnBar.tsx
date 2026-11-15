import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ToggleButton from "@mui/material/ToggleButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ChevronLeftRounded from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import { encounterStore, useEncounter, type Combatant } from "../encounter";
import { turnOrder } from "../encounter/turnOrder";
import { barCombatants, endProgress, resourcesOf, turnOf, type TurnResources } from "../encounter/turnResources";
import { focusToken } from "../components/focusToken";
import { usePlayerIdentity } from "./usePlayerIdentity";
import { TURN_BAR_POPOVER_ID } from "./useTurnBarPopover";

const TURN_BAR_FONT_SIZE = "0.7rem";

/** The player's turn bar: one slide per owned combatant, cycling like a carousel. */
export function TurnBar() {
    const encounter = useEncounter();
    const { playerId, connected } = usePlayerIdentity();
    const owned = useMemo(() => (playerId ? barCombatants(encounter, playerId) : []), [encounter, playerId]);
    const [shownId, setShownId] = useState<string | null>(null);
    const fitRef = useFitPopover();

    // Jump to the player's combatant whose turn starts (the first, in a group).
    const activeOwned = owned.find((c) => c.active)?.id ?? null;
    const lastActive = useRef<string | null>(null);
    useEffect(() => {
        if (activeOwned && activeOwned !== lastActive.current) setShownId(activeOwned);
        lastActive.current = activeOwned;
    }, [activeOwned]);

    const index = Math.max(0, owned.findIndex((c) => c.id === shownId));
    const combatant = owned[index];
    if (!combatant) return null;

    const step = (by: number) => setShownId(owned[(index + by + owned.length) % owned.length].id);
    const resources = resourcesOf(combatant);
    const set = (changes: Partial<TurnResources>) => encounterStore.setTurnResources(combatant.id, changes).catch(console.error);

    const turn = turnOf(turnOrder(encounter), combatant.id);
    const progress = turn?.kind === "group" ? endProgress(turn, connected) : null;

    // Off-turn, only a reaction can be taken.
    const onTurn = combatant.active;

    return (
        <Box
            ref={fitRef}
            // Natural width, not the popover's current width, so the fit can grow as well as shrink.
            sx={{ display: "flex", width: "max-content", whiteSpace: "nowrap", alignItems: "center", gap: 0.5, pl: 0, pr: 0.5, py: 0, bgcolor: "background.paper", "& > *": { flexShrink: 0 } }}
        >
            <Carousel combatant={combatant} count={owned.length} onStep={step} />

            <Divider orientation="vertical" flexItem />

            <Resource label="Action" used={resources.actionUsed} disabled={!onTurn} onChange={(v) => set({ actionUsed: v })} />
            <Resource label="Bonus" used={resources.bonusActionUsed} disabled={!onTurn} onChange={(v) => set({ bonusActionUsed: v })} />
            <Resource label="Reaction" used={resources.reactionUsed} onChange={(v) => set({ reactionUsed: v })} />

            <Divider orientation="vertical" flexItem />

            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
                <Button
                    size="small"
                    variant={resources.ended ? "outlined" : "contained"}
                    disabled={!onTurn}
                    onClick={() => set({ ended: !resources.ended })}
                    aria-label={resources.ended ? "Undo end turn" : "End turn"}
                    sx={{ px: 0.75, py: 0.5, minWidth: 0, whiteSpace: "nowrap", fontSize: TURN_BAR_FONT_SIZE, fontWeight: 700, lineHeight: 1.2, textTransform: "none" }}
                >
                    {resources.ended ? "Undo" : "End"}
                </Button>
                {progress && onTurn && progress.total > 1 && (
                    <Typography sx={{ fontSize: "0.65rem", color: "text.secondary", mt: 0.25 }}>
                        {progress.ended}/{progress.total} ended
                    </Typography>
                )}
            </Box>
        </Box>
    );
}

/** Resize the popover to the bar's content, whatever its controls currently need. */
function useFitPopover() {
    const ref = useRef<HTMLDivElement | null>(null);
    const size = useRef("");
    // No deps: the bar mounts only once there is a combatant to show.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const fit = () => {
            const { width, height } = el.getBoundingClientRect();
            const next = `${Math.ceil(width)}x${Math.ceil(height)}`;
            if (!width || !height || next === size.current) return;
            size.current = next;
            OBR.popover.setWidth(TURN_BAR_POPOVER_ID, Math.ceil(width)).catch(console.error);
            OBR.popover.setHeight(TURN_BAR_POPOVER_ID, Math.ceil(height)).catch(console.error);
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(el);
        return () => observer.disconnect();
    });
    return ref;
}

function Carousel({ combatant, count, onStep }: { combatant: Combatant; count: number; onStep: (by: number) => void }) {
    const arrows = count > 1;
    return (
        <Box sx={{ display: "flex", alignItems: "center" }}>
            {arrows && (
                <IconButton size="small" sx={{ p: 0 }} aria-label="previous token" onClick={() => onStep(-1)}>
                    <ChevronLeftRounded fontSize="small" />
                </IconButton>
            )}
            <Tooltip title={`Center map on ${combatant.name}${combatant.active ? " (your turn)" : ""}`}>
                <IconButton aria-label={`Center map on ${combatant.name}`} sx={{ p: 0 }}
                    onClick={() => void focusToken(combatant.id).catch(console.error)}>
                    <Avatar
                        src={combatant.imageUrl}
                        alt={combatant.name}
                        sx={{
                            width: 44,
                            height: 44,
                            bgcolor: "action.selected",
                            outline: (t) => (combatant.active ? `3px solid ${t.palette.primary.main}` : "none"),
                            outlineOffset: -3,
                        }}
                    />
                </IconButton>
            </Tooltip>
            {arrows && (
                <IconButton size="small" sx={{ p: 0 }} aria-label="next token" onClick={() => onStep(1)}>
                    <ChevronRightRounded fontSize="small" />
                </IconButton>
            )}
        </Box>
    );
}

function Resource({ label, used, disabled, onChange }: { label: string; used: boolean; disabled?: boolean; onChange: (used: boolean) => void }) {
    return (
        <ToggleButton
            value={label}
            size="small"
            disabled={disabled}
            selected={!used && !disabled}
            onChange={() => onChange(!used)}
            aria-label={`${label} ${used ? "used" : "available"}`}
            title={used ? `${label} used` : `${label} available`}
            sx={{
                px: 0.75,
                py: 0.5,
                fontSize: TURN_BAR_FONT_SIZE,
                fontWeight: 400,
                lineHeight: 1.2,
                textTransform: "none",
                textDecoration: used ? "line-through" : "none",
                color: "text.disabled",
                "&.Mui-selected": { color: "primary.contrastText", bgcolor: "primary.main" },
                "&.Mui-selected:hover": { bgcolor: "primary.dark" },
            }}
        >
            {label}
        </ToggleButton>
    );
}
