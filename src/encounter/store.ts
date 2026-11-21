import { isImage, type Item } from "@owlbear-rodeo/sdk";
import { createMetaForItem, isMetadata, META_KEY, type MetaShape } from "../components/metadata";
import { getPluginId } from "../getPluginId";
import type { ObrPort, Unsubscribe } from "../obr/port";
import { memberIndex, toCombatant, type Combatant, type CombatantPatch } from "./combatant";
import { deriveGroups, newGroupId, type Group } from "./groups";
import { adjustCurrent, setCurrent, setMax, setTemp, type HealthChange } from "./health";
import { announceConcentrationCheck } from "./concentration";
import * as turns from "./turnOrder";
import { createProfileStore } from "../profiles/store";
import { findProfile, type CharacterProfiles } from "../profiles/profiles";
import { resourcesOf, turnOf, type TurnResources } from "./turnResources";
import { initiativePromptTargets } from "./initiativePrompt";

export const SCENE_META_KEY = getPluginId("sceneState");
export const ITEM_ADDED_CHANNEL = "com.missing-link-dev.battle-board/item-added";

export type EncounterState = {
    /** True once items and scene state have loaded. */
    ready: boolean;
    /** Combatants in display order, which is the turn order (see turnOrder.ts). */
    combatants: Combatant[];
    groups: Group[];
    started: boolean;
    round: number;
};

export type GroupTarget =
    | { groupId: string }
    | { newGroup: { name: string; staged: boolean; initiative?: number } };

export type EncounterStore = ReturnType<typeof createEncounterStore>;

/**
 * The only writer of combatant data. Write-through (ADR-0004): commands write
 * token metadata and state is rebuilt only from Owlbear's change events.
 *
 * Commands work without subscribing, so other frames (the group modal, the
 * elevation popover) can create a store just to issue them.
 */
export function createEncounterStore(port: ObrPort) {
    const profileStore = createProfileStore(port);
    let state: EncounterState = { ready: false, combatants: [], groups: [], started: false, round: 0 };
    const listeners = new Set<() => void>();
    let stopSync: Unsubscribe | null = null;
    let syncVersion = 0;

    function setState(next: Partial<EncounterState>) {
        state = { ...state, ...next };
        listeners.forEach((l) => l());
    }

    function applyItems(items: Item[]) {
        const combatants = combatantsOf(items);
        const groups = deriveGroups(combatants);
        setState({ combatants: turns.orderCombatants(combatants, groups), groups });
    }

    function applyScene(metadata: Record<string, unknown>) {
        setState(readClock(metadata));
    }

    function startSync() {
        const version = ++syncVersion;
        const unsubItems = port.items.onChange((items) => { if (version === syncVersion) applyItems(items); });
        const unsubScene = port.sceneMetadata.onChange((scene) => { if (version === syncVersion) applyScene(scene); });
        Promise.all([port.items.get(), port.sceneMetadata.get()])
            .then(([items, scene]) => {
                if (version !== syncVersion) return;
                applyItems(items);
                applyScene(scene);
                setState({ ready: true });
            })
            .catch(console.error);
        stopSync = () => {
            unsubItems();
            unsubScene();
        };
    }

    /** Current combatants and groups, read fresh from the scene. */
    async function snapshot() {
        const items = await port.items.get();
        const combatants = combatantsOf(items);
        return { items, combatants, groups: deriveGroups(combatants) };
    }

    /** `snapshot` plus the encounter clock, for turn commands. */
    async function turnSnapshot(): Promise<turns.TurnState> {
        const [{ combatants, groups }, scene] = await Promise.all([snapshot(), port.sceneMetadata.get()]);
        return { combatants, groups, ...readClock(scene) };
    }

    // Turn and health commands run one at a time, each on fresh state.
    let queue: Promise<unknown> = Promise.resolve();
    function exclusive<T>(operation: () => Promise<T>): Promise<T> {
        const run = queue.then(operation, operation);
        queue = run.catch(() => {});
        return run;
    }

    /** Apply health rules to fresh state and announce checks only after the write succeeds. */
    function changeHP(ids: string | string[], calculate: (combatant: Combatant) => HealthChange) {
        return exclusive(async () => {
            const selected = new Set(typeof ids === "string" ? [ids] : ids);
            if (!selected.size) return;
            const { combatants } = await snapshot();
            const changes = new Map(combatants.filter((c) => selected.has(c.id))
                .map((combatant) => [combatant.id, { combatant, ...calculate(combatant) }]));
            if (!changes.size) return;
            await port.items.update([...changes.keys()], (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (meta) Object.assign(meta, changes.get(item.id)!.patch);
                }
            });
            for (const { combatant, concentrationCheck } of changes.values()) {
                if (concentrationCheck) await announceConcentrationCheck(port, combatant, concentrationCheck.dc);
            }
        });
    }

    /**
     * One write that applies `edit` to `ids` and, when the turn moves, sets
     * exactly `change.activeIds` active; then the round, if it changed.
     */
    async function writeWithTurn(state: turns.TurnState, ids: string[], edit: (meta: MetaShape, item: Item) => void, change: turns.TurnChange | null) {
        const target = change ? new Set(change.activeIds) : null;
        const flips = target ? state.combatants.filter((c) => c.active !== target.has(c.id)).map((c) => c.id) : [];
        const touched = [...new Set([...ids, ...flips])];
        if (touched.length) {
            await port.items.update(touched, (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (!meta) continue;
                    if (target && meta.active !== target.has(item.id)) {
                        meta.active = target.has(item.id);
                        // A turn starting gets fresh resources; one ending has spent its End turn.
                        if (meta.active) clearResources(meta);
                        else if (meta.turnResources?.ended) meta.turnResources.ended = false;
                    }
                    if (ids.includes(item.id)) edit(meta, item);
                }
            });
        }
        if (change && change.round !== state.round) await setClock(true, change.round);
    }

    async function announceAdded(ids: string[]) {
        for (const id of ids) await port.broadcast.send(ITEM_ADDED_CHANNEL, id, "LOCAL");
    }

    /**
     * Take combatants out of initiative. Their tokens keep all saved data. If
     * the turn holder leaves, the turn passes on.
     */
    const remove = (ids: string[]) => exclusive(async () => {
        if (!ids.length) return;
        const state = await turnSnapshot();
        await writeWithTurn(state, ids, (meta) => {
            meta.inInitiative = false;
            meta.active = false;
        }, turns.afterLeaving(state, ids));
    });

    /** Write the encounter's started flag and round, touching only this extension's scene key. */
    async function setClock(started: boolean, round: number) {
        const scene = await port.sceneMetadata.get();
        const current = (scene[SCENE_META_KEY] as Record<string, unknown> | undefined) ?? {};
        await port.sceneMetadata.set({ [SCENE_META_KEY]: { ...current, started, round } });
    }

    return {
        getState: () => state,

        subscribe(listener: () => void): Unsubscribe {
            listeners.add(listener);
            if (!stopSync) startSync();
            return () => listeners.delete(listener);
        },

        /** Stop listening to the scene. */
        dispose() {
            syncVersion++;
            stopSync?.();
            stopSync = null;
            state = { ready: false, combatants: [], groups: [], started: false, round: 0 };
            listeners.clear();
        },

        /**
         * Put tokens into initiative, keeping any saved data. A token whose saved
         * group still has combatants rejoins it at the group's current initiative,
         * last in member order; a token whose saved group is empty brings the group
         * back as saved. `solo` drops saved group membership instead.
         */
        async add(tokenIds: string[], opts: { solo?: boolean } = {}) {
            if (!tokenIds.length) return;
            const adding = new Set(tokenIds);
            const [{ combatants }, profiles] = await Promise.all([snapshot(), profileStore.read()]);
            const others = combatants.filter((c) => !adding.has(c.id));
            const groups = new Map(deriveGroups(others).map((g) => [g.id, g]));
            const nextIndex = nextIndexByGroup(others);

            await port.items.update(tokenIds, (items) => {
                for (const item of items) {
                    const meta = editableMeta(item, profiles);
                    // Joining starts with fresh turn resources, whatever an earlier encounter left.
                    if (meta.inInitiative === false) clearResources(meta);
                    meta.inInitiative = true;
                    meta.name = liveName(item) || meta.name;
                    if (opts.solo) {
                        clearGroup(meta);
                        meta.active = false;
                        continue;
                    }
                    const group = meta.groupId ? groups.get(meta.groupId) : undefined;
                    if (group) {
                        meta.initiative = group.initiative;
                        meta.groupInitiativeBonus = group.initiativeBonus;
                        meta.groupName = group.name;
                        meta.groupStaged = group.staged;
                        meta.groupIndex = takeIndex(nextIndex, group.id);
                        meta.active = group.active;
                    } else {
                        meta.active = false;
                    }
                }
            });
            await announceAdded(tokenIds);
        },

        /**
         * Put tokens into an existing or new group (adding them to initiative if
         * needed). Members take the group's initiative and go last in member order.
         * Returns the group id.
         */
        async addToGroup(tokenIds: string[], target: GroupTarget, opts: { hideWhenStaged: boolean }): Promise<string> {
            const adding = new Set(tokenIds);
            const [{ combatants }, profiles] = await Promise.all([snapshot(), profileStore.read()]);
            const wasCombatant = new Set(combatants.map((c) => c.id));
            const others = combatants.filter((c) => !adding.has(c.id));
            const nextIndex = nextIndexByGroup(others);

            const group = "groupId" in target
                ? deriveGroups(others).find((g) => g.id === target.groupId)
                    ?? { id: target.groupId, name: "New Group", initiative: 0, initiativeBonus: 0, staged: false, active: false }
                : {
                    id: newGroupId(),
                    name: target.newGroup.name.trim() || "New Group",
                    initiative: Math.floor(target.newGroup.initiative ?? 0),
                    initiativeBonus: 0,
                    staged: target.newGroup.staged,
                    active: false,
                };

            await port.items.update(tokenIds, (items) => {
                for (const item of items) {
                    const meta = editableMeta(item, profiles);
                    if (!wasCombatant.has(item.id)) clearResources(meta);
                    meta.inInitiative = true;
                    meta.name = liveName(item) || meta.name;
                    setGroup(meta, group.id, group.name, group.staged);
                    meta.initiative = group.initiative;
                    meta.groupInitiativeBonus = group.initiativeBonus;
                    meta.groupIndex = takeIndex(nextIndex, group.id);
                    meta.active = group.active;
                    if (group.staged && opts.hideWhenStaged) item.visible = false;
                }
            });
            await announceAdded(tokenIds.filter((id) => !wasCombatant.has(id)));
            return group.id;
        },

        remove,

        /** Remove every combatant and end the encounter. */
        clearAll: () => exclusive(async () => {
            const { combatants } = await snapshot();
            const ids = combatants.map((c) => c.id);
            if (ids.length) {
                await port.items.update(ids, (items) => {
                    for (const item of items) {
                        const meta = savedMeta(item);
                        if (!meta) continue;
                        meta.inInitiative = false;
                        meta.active = false;
                        clearResources(meta);
                    }
                });
            }
            await setClock(false, 0);
        }),

        /** Edit combatant fields. Tokens without saved data are skipped. */
        async patch(ids: string | string[], fields: CombatantPatch) {
            const list = Array.isArray(ids) ? ids : [ids];
            if (!list.length || !Object.keys(fields).length) return;
            await port.items.update(list, (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (meta) Object.assign(meta, fields);
                }
            });
        },

        /**
         * Take combatants out of their groups. A token leaving a staged group can
         * be shown again. Leavers lose the turn unless they were the whole group.
         */
        leaveGroup: (ids: string[], opts: { showIfWasStaged: boolean }) => exclusive(async () => {
            const { groups } = await snapshot();
            const leaving = new Set(ids);
            const wholeGroupLeaves = new Set(
                groups.filter((g) => g.memberIds.every((id) => leaving.has(id))).flatMap((g) => g.memberIds),
            );
            await port.items.update(ids, (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (!meta) continue;
                    const wasStaged = !!meta.groupStaged;
                    clearGroup(meta);
                    if (!wholeGroupLeaves.has(item.id)) meta.active = false;
                    if (wasStaged && opts.showIfWasStaged) item.visible = true;
                }
            });
        }),

        /** Dissolve a group. If it held the turn, its first member keeps it. */
        ungroup: (groupId: string) => exclusive(async () => {
            const { groups } = await snapshot();
            const group = groups.find((g) => g.id === groupId);
            if (!group) return;
            const [first] = group.memberIds;
            await port.items.update(group.memberIds, (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (!meta) continue;
                    clearGroup(meta);
                    meta.active = group.active && item.id === first;
                }
            });
        }),

        /** Save current permanent stats under the combatant's live name. */
        saveProfile: (id: string) => exclusive(async () => {
            const { combatants } = await snapshot();
            const combatant = combatants.find((c) => c.id === id);
            if (!combatant) throw new Error("This token is no longer in the tracker.");
            await profileStore.save(combatant.name, combatant);
        }),

        /** Explicitly load a profile onto an existing combatant, filling current HP to max. */
        loadProfile: (id: string) => exclusive(async () => {
            if (await port.player.getRole() !== "GM") throw new Error("Only the DM can load profiles.");
            const [{ combatants }, profiles] = await Promise.all([snapshot(), profileStore.read()]);
            const combatant = combatants.find((c) => c.id === id);
            if (!combatant) throw new Error("This token is no longer in the tracker.");
            const profile = findProfile(profiles, combatant.name);
            if (!profile) throw new Error(`No saved profile for ${combatant.name}.`);
            await port.items.update([id], (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (meta) Object.assign(meta, profile, { currentHP: profile.maxHP });
                }
            });
        }),

        /** Commit typed HP using the same rules and write path as button adjustments. */
        setHP: (id: string, value: number, field: "current" | "temp" | "max" = "current") =>
            changeHP(id, (combatant) => {
                if (field === "max") return setMax(value);
                return field === "temp" ? setTemp(combatant, value) : setCurrent(combatant, value);
            }),

        /** Apply an HP adjustment independently to the selected tokens, never to their whole groups. */
        adjustHP: (ids: string | string[], delta: number, field: "current" | "temp" = "current") => {
            if (!Number.isFinite(delta)) return Promise.reject(new Error("HP adjustment must be a finite number."));
            return changeHP(ids, (combatant) => field === "temp"
                ? setTemp(combatant, combatant.tempHP + delta)
                : adjustCurrent(combatant, delta));
        },

        async setGroupInitiativeBonus(groupId: string, bonus: number) {
            if (!Number.isFinite(bonus)) return;
            const { groups } = await snapshot();
            const group = groups.find((g) => g.id === groupId);
            if (!group) return;
            await port.items.update(group.memberIds, (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (meta) meta.groupInitiativeBonus = Math.trunc(bonus);
                }
            });
        },

        /** Reset all solo and shared initiatives before the encounter, preserving member order. */
        resetInitiative: () => exclusive(async () => {
            if (await port.player.getRole() !== "GM") return;
            const state = await turnSnapshot();
            if (state.started || !state.combatants.length) return;
            const indices = new Map(state.groups.flatMap((g) => g.memberIds.map((id, index) => [id, index] as const)));
            await port.items.update(state.combatants.map((c) => c.id), (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (!meta) continue;
                    meta.initiative = 0;
                    if (indices.has(item.id)) meta.groupIndex = indices.get(item.id)!;
                }
            });
        }),

        /** Explicit PC rolls are allowed at zero before the encounter; bulk rolls still skip PCs. */
        rollPlayerInitiative: (id: string, random: () => number = Math.random) => exclusive(async () => {
            const state = await turnSnapshot();
            if (state.started) return;
            const pc = state.combatants.find((c) => c.id === id && c.playerCharacter);
            if (!pc) return;
            const group = state.groups.find((g) => g.id === pc.groupId);
            if ((group?.initiative ?? pc.initiative) !== 0) return;
            if (group && await port.player.getRole() !== "GM") {
                const playerId = await port.player.getId();
                const members = state.combatants.filter((c) => c.groupId === group.id);
                if (members.some((c) => c.ownerId !== playerId)) {
                    throw new Error("Ask the DM to roll this group. You must own every member to roll it yourself.");
                }
            }
            const initiative = 1 + Math.floor(random() * 20) + (group?.initiativeBonus ?? pc.initiativeBonus);
            const ids = group?.memberIds ?? [id];
            await port.items.update(ids, (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (!meta) continue;
                    meta.initiative = initiative;
                    if (group) meta.groupIndex = group.memberIds.indexOf(item.id);
                }
            });
        }),

        /** Roll NPC turns only. Groups containing PCs are left unchanged. */
        rollInitiative: (targetId?: string, random: () => number = Math.random) => exclusive(async () => {
            const { combatants, groups } = await snapshot();
            const results = new Map<string, { initiative: number; groupIndex?: number }>();
            const roll = (bonus: number) => 1 + Math.floor(random() * 20) + bonus;
            const pcIds = new Set(combatants.filter((c) => c.playerCharacter).map((c) => c.id));
            for (const group of groups) {
                if (group.memberIds.some((id) => pcIds.has(id))) continue;
                if (targetId ? group.id !== targetId : group.staged) continue;
                const initiative = roll(group.initiativeBonus);
                group.memberIds.forEach((id, groupIndex) => results.set(id, { initiative, groupIndex }));
            }
            for (const c of combatants) {
                if (c.playerCharacter || c.groupId || (targetId && c.id !== targetId)) continue;
                results.set(c.id, { initiative: roll(c.initiativeBonus) });
            }
            if (!results.size) return;
            await port.items.update([...results.keys()], (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (meta) Object.assign(meta, results.get(item.id));
                }
            });
        }),

        /** Popup submissions recheck ownership, shared turns and zero initiative on fresh scene state. */
        submitRequestedInitiative: (id: string, initiative: number) => exclusive(async () => {
            if (!Number.isFinite(initiative)) throw new Error("Enter a valid initiative total.");
            const [state, playerId, role] = await Promise.all([turnSnapshot(), port.player.getId(), port.player.getRole()]);
            if (role !== "PLAYER" || !initiativePromptTargets(state, playerId).some((c) => c.id === id)) {
                throw new Error("This character is no longer waiting for initiative.");
            }
            const pc = state.combatants.find((c) => c.id === id)!;
            const group = state.groups.find((g) => g.id === pc.groupId);
            await port.items.update(group?.memberIds ?? [id], (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (!meta) continue;
                    meta.initiative = group ? Math.floor(initiative) : Math.round(initiative * 10) / 10;
                    if (group) meta.groupIndex = group.memberIds.indexOf(item.id);
                }
            });
        }),

        /** Player entry is allowed only before the encounter starts, including delayed field commits. */
        setPlayerInitiative: (id: string, initiative: number) => exclusive(async () => {
            if (!Number.isFinite(initiative)) return;
            const state = await turnSnapshot();
            if (state.started) return;
            const pc = state.combatants.find((c) => c.id === id && c.playerCharacter);
            if (!pc) return;
            const group = state.groups.find((g) => g.id === pc.groupId);
            const ids = group ? group.memberIds : [id];
            await port.items.update(ids, (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (!meta) continue;
                    meta.initiative = group ? Math.floor(initiative) : Math.round(initiative * 10) / 10;
                    if (group) meta.groupIndex = group.memberIds.indexOf(item.id);
                }
            });
        }),

        async setGroupInitiative(groupId: string, initiative: number) {
            const { groups } = await snapshot();
            const group = groups.find((g) => g.id === groupId);
            if (!group) return;
            const whole = Math.floor(initiative);
            await port.items.update(group.memberIds, (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (!meta) continue;
                    meta.initiative = whole;
                    // Older saves keep member order in the decimal being overwritten here.
                    meta.groupIndex = group.memberIds.indexOf(item.id);
                }
            });
        },

        async renameGroup(groupId: string, name: string) {
            const { groups } = await snapshot();
            const group = groups.find((g) => g.id === groupId);
            if (!group) return;
            await port.items.update(group.memberIds, (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (meta) meta.groupName = name.trim() || group.name;
                }
            });
        },

        /**
         * Stage or release a group. Staging the group whose turn it is passes the
         * turn on; released members start inactive. Tokens hide/show when
         * `controlVisibility`.
         */
        setGroupStaged: (groupId: string, staged: boolean, opts: { controlVisibility: boolean }) => exclusive(async () => {
            const state = await turnSnapshot();
            const group = state.groups.find((g) => g.id === groupId);
            if (!group) return;
            await writeWithTurn(state, group.memberIds, (meta, item) => {
                meta.groupStaged = staged;
                meta.active = false;
                if (opts.controlVisibility) item.visible = !staged;
            }, staged ? turns.afterLeaving(state, group.memberIds) : null);
        }),

        /** Begin the encounter at the first turn of round 1, with every combatant's turn resources fresh. */
        start: () => exclusive(async () => {
            const state = await turnSnapshot();
            const change = turns.start(state);
            if (!change) return;
            await writeWithTurn(state, idsWithResources(state.combatants), clearResources, change);
            await setClock(true, 1);
        }),

        /** End the encounter: nobody active, round 0, turn resources cleared. */
        end: () => exclusive(async () => {
            const state = await turnSnapshot();
            await writeWithTurn(state, idsWithResources(state.combatants), clearResources, { activeIds: [], round: state.round });
            await setClock(false, 0);
        }),

        next: () => exclusive(async () => {
            const state = await turnSnapshot();
            await writeWithTurn(state, [], () => {}, turns.next(state));
        }),

        /**
         * Advance only if `turnKey` is still the active turn. Two GM clients
         * advancing from the same turn write the same result, so the turn
         * cannot be skipped twice.
         */
        advanceFrom: (turnKey: string) => exclusive(async () => {
            const state = await turnSnapshot();
            const active = turns.turnOrder(state).find((t) => t.active);
            if (active?.key !== turnKey) return;
            await writeWithTurn(state, [], () => {}, turns.next(state));
        }),

        /**
         * Record what a combatant has used this turn, on top of what it had
         * already used. Off-turn only the reaction can change.
         */
        setTurnResources: (id: string, changes: Partial<TurnResources>) => exclusive(async () => {
            const state = await turnSnapshot();
            const combatant = state.combatants.find((c) => c.id === id);
            if (!combatant || !state.started || !turnOf(turns.turnOrder(state), id)) return;
            const current = resourcesOf(combatant);
            const next = combatant.active ? { ...current, ...changes } : { ...current, reactionUsed: changes.reactionUsed ?? current.reactionUsed };
            next.movementUsed = Math.max(0, Math.floor(next.movementUsed));
            await port.items.update([id], (items) => {
                for (const item of items) {
                    const meta = savedMeta(item);
                    if (meta) meta.turnResources = next;
                }
            });
        }),

        prev: () => exclusive(async () => {
            const state = await turnSnapshot();
            await writeWithTurn(state, [], () => {}, turns.prev(state));
        }),
    };
}

export function readClock(metadata: Record<string, unknown>): { started: boolean; round: number } {
    const raw = metadata[SCENE_META_KEY] as { started?: unknown; round?: unknown } | undefined;
    return {
        started: raw?.started === true,
        round: typeof raw?.round === "number" ? raw.round : 0,
    };
}

/** Combatants in the scene, unordered. */
export function combatantsOf(items: Item[]): Combatant[] {
    const list: Combatant[] = [];
    for (const item of items) {
        if (!isImage(item)) continue;
        const c = toCombatant(item);
        if (c) list.push(c);
    }
    return list;
}

function liveName(item: Item): string {
    const img = item as Item & { text?: { plainText?: string } };
    return img.text?.plainText || item.name || "";
}

/** The item's saved data for in-place editing, or undefined if it has none. */
function savedMeta(item: Item): MetaShape | undefined {
    const raw = (item.metadata as Record<string, unknown>)[META_KEY];
    return isMetadata(raw) ? raw : undefined;
}

/** The item's saved data for in-place editing, created with defaults if missing. */
function editableMeta(item: Item, profiles: CharacterProfiles): MetaShape {
    const existing = savedMeta(item);
    if (existing) {
        // Carry the oldest save format's group over before group fields are rewritten.
        if (!existing.groupId && existing.encounterGroups?.length) existing.groupId = existing.encounterGroups[0];
        delete existing.encounterGroups;
        return existing;
    }
    const created = createMetaForItem(item);
    const profile = findProfile(profiles, liveName(item));
    if (profile) Object.assign(created, profile, { currentHP: profile.maxHP });
    (item.metadata as Record<string, unknown>)[META_KEY] = created;
    return created;
}

function clearResources(meta: MetaShape) {
    if (meta.turnResources) meta.turnResources = null;
}

function idsWithResources(combatants: Combatant[]): string[] {
    return combatants.filter((c) => c.turnResources).map((c) => c.id);
}

function setGroup(meta: MetaShape, id: string, name: string, staged: boolean) {
    meta.groupId = id;
    meta.groupName = name;
    meta.groupStaged = staged;
    delete meta.encounterGroups;
}

function clearGroup(meta: MetaShape) {
    meta.groupId = null;
    meta.groupName = null;
    meta.groupStaged = false;
    meta.groupIndex = null;
    // Otherwise readMeta would fall back to the legacy group.
    delete meta.encounterGroups;
}

function nextIndexByGroup(combatants: Combatant[]): Map<string, number> {
    const next = new Map<string, number>();
    for (const c of combatants) {
        if (!c.groupId) continue;
        next.set(c.groupId, Math.max(next.get(c.groupId) ?? 0, memberIndex(c) + 1));
    }
    return next;
}

function takeIndex(next: Map<string, number>, groupId: string): number {
    const i = next.get(groupId) ?? 0;
    next.set(groupId, i + 1);
    return i;
}
