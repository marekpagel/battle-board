import { playerCombatants } from "../encounter/playerView";
import { useCallback, useMemo, useState } from "react";
import { useCMTokens } from "../components/useCMTokens";
import { encounterStore, useEncounter, type CombatantPatch } from "../encounter";
import { settingsStore, useSettings, type InitiativeSettings } from "../settings";

/**
 * Everything the tracker renders: the encounter (from the Encounter store),
 * room settings (Settings store), token geometry, and which rows are expanded.
 */
export function useInitiativeState() {
    const { combatants, groups, started, round } = useEncounter();
    const { settings } = useSettings();
    const cmTokens = useCMTokens();
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    const toggleExpanded = useCallback((id: string) =>
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        }), []);

    const initiativeItemIds = useMemo(() => new Set(combatants.map((c) => c.id)), [combatants]);

    const visibleRows = useMemo(() =>
        playerCombatants(combatants, groups, started, settings.disablePlayerList),
        [combatants, groups, started, settings.disablePlayerList]
    );

    const initiativeTokens = useMemo(() =>
        cmTokens.filter(t => initiativeItemIds.has(t.id)),
        [cmTokens, initiativeItemIds]
    );

    const setSettings = useCallback((patch: Partial<InitiativeSettings>) => {
        settingsStore.update(patch).catch(console.error);
    }, []);

    const updateRow = useCallback((id: string, patch: CombatantPatch) => {
        encounterStore.patch(id, patch).catch(console.error);
    }, []);

    return {
        combatants,
        groups,
        started,
        round,
        settings,
        setSettings,
        cmTokens,
        expandedIds,
        toggleExpanded,
        visibleRows,
        initiativeTokens,
        updateRow,
    };
}
