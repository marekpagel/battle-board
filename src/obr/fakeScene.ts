import type { Item, Metadata } from "@owlbear-rodeo/sdk";
import type { BroadcastDestination, ObrPort, PartyMember, Role, Unsubscribe } from "./port";

/**
 * In-memory adapter for `ObrPort`. One fake scene is the shared room; each
 * `connect()` returns a port for one client. Like the real SDK (see ADR-0004),
 * a write's change event reaches every client, the writer included, before
 * the write's promise resolves. Tests should still `await flush()` before
 * asserting on what other subscribers saw.
 */
export type FakeGrid = { dpi: number; multiplier: number; unit: string };

export function createFakeScene(initial: { items?: Item[]; sceneMetadata?: Metadata; roomMetadata?: Metadata; grid?: Partial<FakeGrid> } = {}) {
    let grid: FakeGrid = { dpi: 150, multiplier: 5, unit: "ft", ...initial.grid };
    const gridListeners = new Set<() => void>();
    let items: Item[] = clone(initial.items ?? []);
    let sceneMetadata: Metadata = clone(initial.sceneMetadata ?? {});
    let roomMetadata: Metadata = clone(initial.roomMetadata ?? {});

    const itemListeners = new Set<(items: Item[]) => void>();
    const sceneListeners = new Set<(m: Metadata) => void>();
    const roomListeners = new Set<(m: Metadata) => void>();
    type Client = { id: number; playerId: string; role: Role; connected: boolean; messages: Map<string, Set<(data: unknown) => void>>; party: Set<(players: PartyMember[]) => void> };
    const clients: Client[] = [];
    const othersThan = (client: Client): PartyMember[] =>
        clients.filter((c) => c !== client && c.connected).map((c) => ({ id: c.playerId, role: c.role }));
    const emitParty = () => {
        for (const c of clients) {
            if (c.connected) queueMicrotask(() => c.party.forEach((l) => l(othersThan(c))));
        }
    };
    /** Every write applied to the scene, in order. Lets tests count round-trips. */
    const writes: { kind: "items.update" | "items.add" | "items.delete" | "localItems.add" | "localItems.update" | "localItems.delete" | "sceneMetadata" | "roomMetadata"; ids?: string[] }[] = [];

    const emit = <T>(listeners: Set<(v: T) => void>, value: () => T) => {
        queueMicrotask(() => listeners.forEach((l) => l(value())));
    };
    const emitItems = () => emit(itemListeners, () => clone(items));

    const subscribe = <T>(listeners: Set<T>, cb: T): Unsubscribe => {
        listeners.add(cb);
        return () => listeners.delete(cb);
    };

    const ports = new Map<ObrPort, Client>();

    function connect(role: Role = "GM", playerId = `player-${clients.length}`): ObrPort {
        const client: Client = { id: clients.length, playerId, role, connected: true, messages: new Map(), party: new Set() };
        clients.push(client);
        const port = portFor(client);
        ports.set(port, client);
        emitParty();
        return port;
    }

    function portFor(client: Client): ObrPort {
        const { role } = client;
        let localItems: Item[] = [];
        const localListeners = new Set<(items: Item[]) => void>();
        const emitLocal = () => emit(localListeners, () => clone(localItems));

        return {
            items: {
                async get(ids) {
                    const wanted = ids ? new Set(ids) : null;
                    return clone(wanted ? items.filter((i) => wanted.has(i.id)) : items);
                },
                async update(ids, update) {
                    const wanted = new Set(ids);
                    const drafts = clone(items.filter((i) => wanted.has(i.id)));
                    update(drafts);
                    const byId = new Map(drafts.map((d) => [d.id, d]));
                    items = items.map((i) => byId.get(i.id) ?? i);
                    writes.push({ kind: "items.update", ids: drafts.map((d) => d.id) });
                    emitItems();
                },
                async add(added) {
                    items = [...items, ...clone(added)];
                    writes.push({ kind: "items.add", ids: added.map((i) => i.id) });
                    emitItems();
                },
                async delete(ids) {
                    const gone = new Set(ids);
                    items = items.filter((i) => !gone.has(i.id));
                    writes.push({ kind: "items.delete", ids });
                    emitItems();
                },
                onChange: (cb) => subscribe(itemListeners, cb),
            },
            localItems: {
                async get(ids) { return clone(ids ? localItems.filter((i) => ids.includes(i.id)) : localItems); },
                async update(ids, update) {
                    const drafts = clone(localItems.filter((i) => ids.includes(i.id)));
                    update(drafts);
                    const byId = new Map(drafts.map((i) => [i.id, i]));
                    localItems = localItems.map((i) => byId.get(i.id) ?? i);
                    writes.push({ kind: "localItems.update", ids });
                    emitLocal();
                },
                async add(added) {
                    localItems = [...localItems, ...clone(added)];
                    writes.push({ kind: "localItems.add", ids: added.map((i) => i.id) });
                    emitLocal();
                },
                async delete(ids) {
                    localItems = localItems.filter((i) => !ids.includes(i.id));
                    writes.push({ kind: "localItems.delete", ids });
                    emitLocal();
                },
                onChange: (cb) => subscribe(localListeners, cb),
            },
            sceneMetadata: {
                get: async () => clone(sceneMetadata),
                async set(patch) {
                    sceneMetadata = { ...sceneMetadata, ...clone(patch) };
                    writes.push({ kind: "sceneMetadata" });
                    emit(sceneListeners, () => clone(sceneMetadata));
                },
                onChange: (cb) => subscribe(sceneListeners, cb),
            },
            roomMetadata: {
                get: async () => clone(roomMetadata),
                async set(patch) {
                    roomMetadata = { ...roomMetadata, ...clone(patch) };
                    writes.push({ kind: "roomMetadata" });
                    emit(roomListeners, () => clone(roomMetadata));
                },
                onChange: (cb) => subscribe(roomListeners, cb),
            },
            broadcast: {
                async send(channel, data, destination: BroadcastDestination) {
                    for (const c of clients) {
                        if (!c.connected) continue;
                        const isSelf = c === client;
                        if (destination === "LOCAL" && !isSelf) continue;
                        if (destination === "REMOTE" && isSelf) continue;
                        const listeners = c.messages.get(channel);
                        if (listeners) queueMicrotask(() => listeners.forEach((l) => l(clone(data))));
                    }
                },
                onMessage(channel, cb) {
                    if (!client.messages.has(channel)) client.messages.set(channel, new Set());
                    return subscribe(client.messages.get(channel)!, cb);
                },
            },
            player: {
                getRole: async () => role,
                getId: async () => client.playerId,
            },
            party: {
                getPlayers: async () => othersThan(client),
                onChange: (cb) => subscribe(client.party, cb),
            },
            grid: {
                getDpi: async () => grid.dpi,
                getScale: async () => ({ multiplier: grid.multiplier, unit: grid.unit }),
                onChange: (cb) => subscribe(gridListeners, cb),
            },
        };
    }

    return {
        connect,
        /** Leave the room, as closing the browser tab would. */
        disconnect(port: ObrPort) {
            const client = ports.get(port);
            if (!client) return;
            client.connected = false;
            emitParty();
        },
        writes,
        /** Change the grid (as a GM editing scene settings would) and notify clients. */
        setGrid(next: Partial<FakeGrid>) {
            grid = { ...grid, ...next };
            queueMicrotask(() => gridListeners.forEach((l) => l()));
        },
        /** Synchronous peek at scene state, for assertions. */
        peek: () => ({ items: clone(items), sceneMetadata: clone(sceneMetadata), roomMetadata: clone(roomMetadata) }),
    };
}

/** Resolve after all queued change events have been delivered. */
export function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function clone<T>(value: T): T {
    return value === undefined ? value : structuredClone(value);
}
