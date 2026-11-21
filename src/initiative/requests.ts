import { getPluginId } from "../getPluginId";
import type { ObrPort } from "../obr/port";
import { initiativePromptTargets } from "../encounter/initiativePrompt";
import { deriveGroups } from "../encounter/groups";
import { combatantsOf, readClock } from "../encounter/store";

export const INITIATIVE_REQUEST_CHANNEL = getPluginId("request-initiative");

/** Request only missing initiatives from currently connected PC owners. */
export async function requestPlayerInitiative(port: ObrPort): Promise<number> {
    if (await port.player.getRole() !== "GM") return 0;
    const [items, scene, party] = await Promise.all([port.items.get(), port.sceneMetadata.get(), port.party.getPlayers()]);
    const combatants = combatantsOf(items);
    const owners = new Set(party.filter((p) => p.role === "PLAYER").map((p) => p.id));
    const targets = initiativePromptTargets({ combatants, groups: deriveGroups(combatants), ...readClock(scene) })
        .filter((c) => owners.has(c.ownerId));
    if (targets.length) await port.broadcast.send(INITIATIVE_REQUEST_CHANNEL, targets.map((c) => c.id), "REMOTE");
    return new Set(targets.map((c) => c.ownerId)).size;
}
export type InitiativePromptUI = { open(ids: string[]): Promise<void>; close(): Promise<void> };

/** The background receives requests even with the tracker closed. */
export function listenForInitiativeRequests(port: ObrPort, ui: InitiativePromptUI) {
    let stopped = false;
    let operations = Promise.resolve();
    const enqueue = (run: () => Promise<void>) => { operations = operations.then(run).catch(console.error); };
    const unsubscribe = port.broadcast.onMessage(INITIATIVE_REQUEST_CHANNEL, (data) => {
        if (!Array.isArray(data) || !data.every((id) => typeof id === "string")) return;
        enqueue(async () => {
            const [role, playerId, items, scene] = await Promise.all([
                port.player.getRole(), port.player.getId(), port.items.get(), port.sceneMetadata.get(),
            ]);
            if (stopped || role !== "PLAYER") return;
            const combatants = combatantsOf(items);
            const ids = initiativePromptTargets({ combatants, groups: deriveGroups(combatants), ...readClock(scene) }, playerId)
                .filter((c) => data.includes(c.id)).map((c) => c.id);
            if (!stopped && ids.length) await ui.open(ids);
        });
    });
    return () => {
        stopped = true;
        unsubscribe();
        enqueue(() => ui.close());
    };
}
