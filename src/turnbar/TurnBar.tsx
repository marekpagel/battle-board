import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ToggleButton from "@mui/material/ToggleButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ChevronLeftRounded from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import StopRounded from "@mui/icons-material/StopRounded";
import OpenInNewRounded from "@mui/icons-material/OpenInNewRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import { encounterStore, useEncounter, type Combatant } from "../encounter";
import { canPrev, turnOrder } from "../encounter/turnOrder";
import { barCombatants, endProgress, resourcesOf, turnOf, type TurnResources } from "../encounter/turnResources";
import { focusToken } from "../components/focusToken";
import { usePlayerIdentity } from "./usePlayerIdentity";
import { TURN_BAR_POPOVER_ID } from "./popover";
import { useRole } from "../hooks/useRole";
import { dmBarCombatants } from "./model";
import { useConcentrationNotifications } from "../hooks/useConcentrationNotifications";

const TURN_BAR_FONT_SIZE = "0.7rem";

export function TurnBar() {
    const role = useRole();
    return role === "GM" ? <DmTurnBar /> : <PlayerTurnBar />;
}

/** The GM follows the active turn, with full encounter controls and NPC resources. */
function DmTurnBar() {
    const encounter = useEncounter();
    const { checks, dismiss } = useConcentrationNotifications();
    const turns = useMemo(() => turnOrder(encounter), [encounter]);
    const active = turns.find((turn) => turn.active);
    const combatants = useMemo(() => dmBarCombatants(encounter), [encounter]);
    const [shownId, setShownId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const fitRef = useFitPopover();
    const index = Math.max(0, combatants.findIndex((combatant) => combatant.id === shownId));
    const combatant = combatants[index];
    const resources = combatant ? resourcesOf(combatant) : null;

    useEffect(() => { setShownId(null); }, [active?.key]);

    const execute = (command: () => Promise<void>) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        void (async () => {
            if (await OBR.player.getRole() !== "GM") throw new Error("Only the DM can control encounter turns.");
            await command();
        })().catch((error: unknown) => OBR.notification.show(error instanceof Error ? error.message : "Could not update the turn.", "ERROR"))
            .finally(() => { inFlight.current = false; setBusy(false); });
    };
    const set = (changes: Partial<TurnResources>) => {
        if (combatant) execute(() => encounterStore.setTurnResources(combatant.id, changes));
    };

    if (!encounter.started) return null;

    return (
        <Box ref={fitRef} sx={{ width: "max-content", bgcolor: "background.paper" }}>
            {checks.map((check) => <Stack key={check.tokenId} direction="row" spacing={0.5} alignItems="center" sx={{ px: 0.5, color: "warning.main" }}>
                <Typography sx={{ fontSize: "0.7rem" }}>{check.tokenName}: concentration DC {check.dc}</Typography>
                <IconButton size="small" aria-label={`Dismiss concentration check for ${check.tokenName}`} onClick={() => dismiss(check.tokenId)} sx={{ p: 0.25 }}>
                    <CloseRounded sx={{ fontSize: 14 }} />
                </IconButton>
            </Stack>)}
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, pr: 0.5, "& > *": { flexShrink: 0 } }}>
                {combatant && <>
                    <Carousel combatant={combatant} count={combatants.length}
                        onStep={(by) => setShownId(combatants[(index + by + combatants.length) % combatants.length].id)} />
                    <Box sx={{ maxWidth: 120, minWidth: 0 }}>
                        {active?.kind === "group" && <Typography noWrap sx={{ fontSize: "0.65rem", color: "text.secondary" }}>{active.group.name}</Typography>}
                        <Typography noWrap sx={{ fontSize: "0.75rem" }}>{combatant.name}</Typography>
                    </Box>
                    {!combatant.playerCharacter && resources && <>
                        <Divider orientation="vertical" flexItem />
                        <Resource label="Action" used={resources.actionUsed} disabled={busy} onChange={(value) => set({ actionUsed: value })} />
                        <Resource label="Bonus" used={resources.bonusActionUsed} disabled={busy} onChange={(value) => set({ bonusActionUsed: value })} />
                        <Resource label="Reaction" used={resources.reactionUsed} disabled={busy} onChange={(value) => set({ reactionUsed: value })} />
                    </>}
                    <Divider orientation="vertical" flexItem />
                </>}
                <Tooltip title="Previous turn">
                    <span><IconButton size="small" aria-label="Previous turn" disabled={busy || !canPrev(encounter)} onClick={() => execute(() => encounterStore.prev())} sx={{ p: 0.25 }}>
                        <ChevronLeftRounded fontSize="small" />
                    </IconButton></span>
                </Tooltip>
                <Typography aria-label={`Round ${encounter.round}`} sx={{ fontSize: TURN_BAR_FONT_SIZE, whiteSpace: "nowrap" }}>R {encounter.round}</Typography>
                <Button size="small" variant="contained" disabled={busy || !turns.length}
                    onClick={() => execute(() => active ? encounterStore.advanceFrom(active.key) : encounterStore.next())}
                    aria-label="Next turn" sx={{ minWidth: 0, px: 0.75, fontSize: TURN_BAR_FONT_SIZE, fontWeight: 400, textTransform: "none" }}>Next</Button>
                <Tooltip title="End encounter">
                    <span><IconButton size="small" aria-label="End encounter" color="error" disabled={busy} onClick={() => execute(() => encounterStore.end())} sx={{ p: 0.25 }}>
                        <StopRounded fontSize="small" />
                    </IconButton></span>
                </Tooltip>
                <Tooltip title="Open tracker">
                    <IconButton size="small" aria-label="Open tracker" onClick={() => void OBR.action.open().catch(console.error)} sx={{ p: 0.25 }}>
                        <OpenInNewRounded sx={{ fontSize: 16 }} />
                    </IconButton>
                </Tooltip>
            </Box>
        </Box>
    );
}

/** The player's turn bar: one slide per owned combatant, cycling like a carousel. */
function PlayerTurnBar() {
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
