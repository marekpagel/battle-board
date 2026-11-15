import { createProfileStore } from "../profiles/store";
import { playerCombatants } from "./playerView";
import { describe, expect, it } from "vitest";
import { createFakeScene, flush } from "../obr/fakeScene";
import { makeToken } from "../test/tokens";
import { DEFAULT_META, META_KEY } from "../components/metadata";
import { createEncounterStore, ITEM_ADDED_CHANNEL, SCENE_META_KEY } from "./store";
import { CONCENTRATION_CHANNEL } from "./concentration";

/** Saved data as an older version of the extension would have written it. */
function saved(fields: Record<string, unknown> = {}) {
    return { [META_KEY]: { ...DEFAULT_META, name: "saved", visible: true, ...fields } };
}

async function setup(tokens: ReturnType<typeof makeToken>[], sceneMetadata: Record<string, unknown> = {}) {
    const scene = createFakeScene({ items: tokens, sceneMetadata });
    const port = scene.connect("GM");
    const store = createEncounterStore(port);
    store.subscribe(() => {});
    await flush();
    return { scene, port, store, meta: (id: string) => scene.peek().items.find((i) => i.id === id)!.metadata[META_KEY] as Record<string, unknown> };
}

describe("encounter store", () => {
    describe("add", () => {
        it("gives a new token default stats and announces it to statblock extensions", async () => {
            const { store, port } = await setup([makeToken({ id: "a", name: "Goblin" })]);
            const announced: unknown[] = [];
            port.broadcast.onMessage(ITEM_ADDED_CHANNEL, (id) => announced.push(id));

            await store.add(["a"]);
            await flush();

            const [c] = store.getState().combatants;
            expect(c).toMatchObject({ id: "a", name: "Goblin", ac: 10, maxHP: 10, active: false });
            expect(announced).toEqual(["a"]);
        });

        it("keeps a prepped token's saved stats", async () => {
            const { store } = await setup([makeToken({ id: "a", metadata: saved({ inInitiative: false, maxHP: 45, currentHP: 30, ac: 17 }) })]);
            await store.add(["a"]);
            await flush();
            expect(store.getState().combatants[0]).toMatchObject({ maxHP: 45, currentHP: 30, ac: 17 });
        });

        it("rejoins a group that still has combatants at its current initiative, last in member order", async () => {
            const { store, meta } = await setup([
                makeToken({ id: "m0", metadata: saved({ groupId: "g", groupName: "Wolves", initiative: 18, groupIndex: 0 }) }),
                makeToken({ id: "m1", metadata: saved({ groupId: "g", groupName: "Wolves", initiative: 18, groupIndex: 1 }) }),
                makeToken({ id: "back", metadata: saved({ inInitiative: false, groupId: "g", groupName: "Wolves", initiative: 9, groupIndex: 0 }) }),
            ]);
            await store.add(["back"]);
            await flush();
            expect(meta("back")).toMatchObject({ inInitiative: true, groupId: "g", initiative: 18, groupIndex: 2 });
            expect(store.getState().groups[0].memberIds).toEqual(["m0", "m1", "back"]);
        });

        it("brings back an empty group exactly as saved", async () => {
            const { store } = await setup([
                makeToken({ id: "a", metadata: saved({ inInitiative: false, groupId: "g", groupName: "Ambush", groupStaged: true, initiative: 14 }) }),
            ]);
            await store.add(["a"]);
            await flush();
            expect(store.getState().groups).toEqual([
                expect.objectContaining({ id: "g", name: "Ambush", staged: true, initiative: 14, memberIds: ["a"] }),
            ]);
        });

        it("solo drops saved group membership", async () => {
            const { store, meta } = await setup([
                makeToken({ id: "a", metadata: saved({ inInitiative: false, groupId: "g", groupName: "Ambush", groupStaged: true }) }),
            ]);
            await store.add(["a"], { solo: true });
            await flush();
            expect(meta("a")).toMatchObject({ groupId: null, groupName: null, groupStaged: false });
            expect(store.getState().groups).toEqual([]);
        });
    });

    describe("remove", () => {
        it("keeps every saved field, so adding again restores the combatant exactly", async () => {
            const { store, meta } = await setup([
                makeToken({ id: "a", metadata: saved({ initiative: 15, currentHP: 3, groupId: "g", groupName: "Pack", active: true }) }),
            ]);
            const before = { ...meta("a") };

            await store.remove(["a"]);
            await flush();
            expect(store.getState().combatants).toEqual([]);
            expect(meta("a")).toEqual({ ...before, inInitiative: false, active: false });

            await store.add(["a"]);
            await flush();
            expect(store.getState().combatants[0]).toMatchObject({ initiative: 15, currentHP: 3, groupId: "g", groupName: "Pack" });
        });
    });

    describe("clearAll", () => {
        it("removes every combatant, keeps their stats and ends the encounter", async () => {
            const { store, meta, scene } = await setup(
                [makeToken({ id: "a", metadata: saved({ maxHP: 40 }) }), makeToken({ id: "b", metadata: saved() })],
                { [SCENE_META_KEY]: { started: true, round: 4 } },
            );
            await store.clearAll();
            await flush();
            expect(store.getState()).toMatchObject({ combatants: [], started: false, round: 0 });
            expect(meta("a")).toMatchObject({ inInitiative: false, maxHP: 40 });
            expect(scene.peek().sceneMetadata[SCENE_META_KEY]).toEqual({ started: false, round: 0 });
        });
    });

    describe("concurrent edits (two clients, one scene)", () => {
        it("keeps both clients' edits to different fields of one combatant", async () => {
            const scene = createFakeScene({ items: [makeToken({ id: "pc", metadata: saved({ playerCharacter: true }) })] });
            const gm = createEncounterStore(scene.connect("GM"));
            const player = createEncounterStore(scene.connect("PLAYER"));
            gm.subscribe(() => {});
            player.subscribe(() => {});
            await flush();

            await Promise.all([gm.patch("pc", { ac: 18 }), player.patch("pc", { currentHP: 4 })]);
            await flush();

            for (const s of [gm, player]) expect(s.getState().combatants[0]).toMatchObject({ ac: 18, currentHP: 4 });
        });
    });

    describe("groups", () => {
        it("numbers members past nine without colliding (15, 15.1 … 15.10)", async () => {
            const ids = Array.from({ length: 11 }, (_, i) => `t${i}`);
            const { store, meta } = await setup(ids.map((id) => makeToken({ id })));
            await store.addToGroup(ids, { newGroup: { name: "Swarm", staged: false, initiative: 15 } }, { hideWhenStaged: true });
            await flush();

            const [group] = store.getState().groups;
            expect(group).toMatchObject({ name: "Swarm", initiative: 15 });
            expect(group.memberIds).toEqual(ids);
            expect(ids.map((id) => meta(id).initiative)).toEqual(ids.map(() => 15));
            expect(ids.map((id) => meta(id).groupIndex)).toEqual(ids.map((_, i) => i));
        });

        it("reads member order from the initiative decimal in older saves", async () => {
            const { store } = await setup([
                makeToken({ id: "third", metadata: saved({ groupId: "g", initiative: 12.2 }) }),
                makeToken({ id: "first", metadata: saved({ groupId: "g", initiative: 12 }) }),
                makeToken({ id: "second", metadata: saved({ groupId: "g", initiative: 12.1 }) }),
            ]);
            expect(store.getState().groups[0]).toMatchObject({ initiative: 12, memberIds: ["first", "second", "third"] });
        });

        it("keeps the old decimal order when the group's initiative changes", async () => {
            const { store, meta } = await setup([
                makeToken({ id: "second", metadata: saved({ groupId: "g", initiative: 12.1 }) }),
                makeToken({ id: "first", metadata: saved({ groupId: "g", initiative: 12 }) }),
            ]);
            await store.setGroupInitiative("g", 20);
            await flush();
            expect(meta("first")).toMatchObject({ initiative: 20, groupIndex: 0 });
            expect(meta("second")).toMatchObject({ initiative: 20, groupIndex: 1 });
            expect(store.getState().groups[0].memberIds).toEqual(["first", "second"]);
        });

        it("reads the oldest saves' encounterGroups as the token's group", async () => {
            const { store } = await setup([makeToken({ id: "a", metadata: saved({ encounterGroups: ["legacy"], groupId: undefined }) })]);
            expect(store.getState().combatants[0].groupId).toBe("legacy");
        });

        it("leaving a group does not fall back to the legacy encounterGroups", async () => {
            const { store } = await setup([makeToken({ id: "a", metadata: saved({ encounterGroups: ["legacy"], groupId: undefined }) })]);
            await store.leaveGroup(["a"], { showIfWasStaged: true });
            await flush();
            expect(store.getState().combatants[0].groupId).toBeNull();
        });

        it("staging hides members and takes the turn away, in one write", async () => {
            const { store, scene } = await setup([
                makeToken({ id: "a", metadata: saved({ groupId: "g", active: true }) }),
                makeToken({ id: "b", metadata: saved({ groupId: "g", active: true }) }),
            ]);
            const writesBefore = scene.writes.length;
            await store.setGroupStaged("g", true, { controlVisibility: true });
            await flush();

            expect(scene.writes.length - writesBefore).toBe(1);
            expect(store.getState().groups[0]).toMatchObject({ staged: true, active: false });
            expect(store.getState().combatants.map((c) => c.visible)).toEqual([false, false]);
        });

        it("a token leaving a staged group is shown again", async () => {
            const { store } = await setup([makeToken({ id: "a", visible: false, metadata: saved({ groupId: "g", groupStaged: true }) })]);
            await store.leaveGroup(["a"], { showIfWasStaged: true });
            await flush();
            expect(store.getState().combatants[0]).toMatchObject({ visible: true, groupId: null });
        });

        it("ungrouping the active group leaves the turn with its first member", async () => {
            const { store } = await setup([
                makeToken({ id: "b", metadata: saved({ groupId: "g", groupIndex: 1, active: true }) }),
                makeToken({ id: "a", metadata: saved({ groupId: "g", groupIndex: 0, active: true }) }),
            ]);
            await store.ungroup("g");
            await flush();
            const byId = Object.fromEntries(store.getState().combatants.map((c) => [c.id, c]));
            expect(byId.a).toMatchObject({ active: true, groupId: null });
            expect(byId.b).toMatchObject({ active: false, groupId: null });
            expect(store.getState().groups).toEqual([]);
        });

        it("adding to a staged group hides the token when staging controls visibility", async () => {
            const { store } = await setup([
                makeToken({ id: "m", metadata: saved({ groupId: "g", groupName: "Reserve", groupStaged: true }) }),
                makeToken({ id: "new" }),
            ]);
            await store.addToGroup(["new"], { groupId: "g" }, { hideWhenStaged: true });
            await flush();
            const added = store.getState().combatants.find((c) => c.id === "new")!;
            expect(added).toMatchObject({ groupId: "g", groupName: "Reserve", groupStaged: true, visible: false });
        });
    });

    describe("turns", () => {
        const clock = (started: boolean, round: number) => ({ [SCENE_META_KEY]: { started, round } });

        it("start makes the first turn active in round 1", async () => {
            const { store } = await setup([
                makeToken({ id: "slow", metadata: saved({ initiative: 5 }) }),
                makeToken({ id: "fast", metadata: saved({ initiative: 20 }) }),
            ]);
            await store.start();
            await flush();
            expect(store.getState()).toMatchObject({ started: true, round: 1 });
            expect(store.getState().combatants.filter((c) => c.active).map((c) => c.id)).toEqual(["fast"]);
        });

        it("next changes only the two combatants whose flag differs, in one item write", async () => {
            const { store, scene } = await setup([
                makeToken({ id: "a", metadata: saved({ initiative: 3, active: true }) }),
                makeToken({ id: "b", metadata: saved({ initiative: 2 }) }),
                makeToken({ id: "c", metadata: saved({ initiative: 1 }) }),
            ], clock(true, 1));
            const writesBefore = scene.writes.length;
            await store.next();
            await flush();
            expect(scene.writes.slice(writesBefore)).toEqual([{ kind: "items.update", ids: ["a", "b"] }]);
        });

        it("next after the last turn starts the next round", async () => {
            const { store } = await setup([
                makeToken({ id: "a", metadata: saved({ initiative: 3 }) }),
                makeToken({ id: "b", metadata: saved({ initiative: 2, active: true }) }),
            ], clock(true, 1));
            await store.next();
            await flush();
            expect(store.getState().round).toBe(2);
            expect(store.getState().combatants.find((c) => c.active)?.id).toBe("a");
        });

        it("two quick Next presses advance two turns (no stale round or order)", async () => {
            const { store } = await setup([
                makeToken({ id: "a", metadata: saved({ initiative: 3, active: true }) }),
                makeToken({ id: "b", metadata: saved({ initiative: 2 }) }),
                makeToken({ id: "c", metadata: saved({ initiative: 1 }) }),
            ], clock(true, 1));
            await Promise.all([store.next(), store.next()]);
            await flush();
            expect(store.getState().combatants.find((c) => c.active)?.id).toBe("c");
        });

        it("prev does nothing on the first turn of round 1", async () => {
            const { store, scene } = await setup([
                makeToken({ id: "a", metadata: saved({ initiative: 3, active: true }) }),
                makeToken({ id: "b", metadata: saved({ initiative: 2 }) }),
            ], clock(true, 1));
            const writesBefore = scene.writes.length;
            await store.prev();
            expect(scene.writes.length).toBe(writesBefore);
        });

        it("removing the turn holder passes the turn to the next turn", async () => {
            const { store } = await setup([
                makeToken({ id: "a", metadata: saved({ initiative: 3 }) }),
                makeToken({ id: "b", metadata: saved({ initiative: 2, active: true }) }),
                makeToken({ id: "c", metadata: saved({ initiative: 1 }) }),
            ], clock(true, 1));
            await store.remove(["b"]);
            await flush();
            expect(store.getState().combatants.find((c) => c.active)?.id).toBe("c");
        });

        it("removing the last turn's holder wraps to the first turn of the next round", async () => {
            const { store } = await setup([
                makeToken({ id: "a", metadata: saved({ initiative: 3 }) }),
                makeToken({ id: "b", metadata: saved({ initiative: 2, active: true }) }),
            ], clock(true, 4));
            await store.remove(["b"]);
            await flush();
            expect(store.getState()).toMatchObject({ round: 5 });
            expect(store.getState().combatants.find((c) => c.active)?.id).toBe("a");
        });

        it("removing one member of the active group keeps the turn with the group", async () => {
            const { store } = await setup([
                makeToken({ id: "m0", metadata: saved({ groupId: "g", initiative: 9, groupIndex: 0, active: true }) }),
                makeToken({ id: "m1", metadata: saved({ groupId: "g", initiative: 9, groupIndex: 1, active: true }) }),
                makeToken({ id: "solo", metadata: saved({ initiative: 2 }) }),
            ], clock(true, 1));
            await store.remove(["m0"]);
            await flush();
            expect(store.getState().combatants.filter((c) => c.active).map((c) => c.id)).toEqual(["m1"]);
        });

        it("staging the active group passes the turn to the next turn, not the first", async () => {
            const { store } = await setup([
                makeToken({ id: "first", metadata: saved({ initiative: 20 }) }),
                makeToken({ id: "m0", metadata: saved({ groupId: "g", initiative: 10, active: true }) }),
                makeToken({ id: "m1", metadata: saved({ groupId: "g", initiative: 10, groupIndex: 1, active: true }) }),
                makeToken({ id: "after", metadata: saved({ initiative: 5 }) }),
            ], clock(true, 2));
            await store.setGroupStaged("g", true, { controlVisibility: false });
            await flush();
            expect(store.getState().combatants.filter((c) => c.active).map((c) => c.id)).toEqual(["after"]);
            expect(store.getState().round).toBe(2);
        });

        it("end clears the turn and writes only this extension's scene key", async () => {
            const { store, scene } = await setup(
                [makeToken({ id: "a", metadata: saved({ active: true }) })],
                { ...clock(true, 3), "other.extension/key": { keep: true } },
            );
            await store.end();
            await flush();
            expect(store.getState()).toMatchObject({ started: false, round: 0 });
            expect(store.getState().combatants[0].active).toBe(false);
            expect(scene.peek().sceneMetadata["other.extension/key"]).toEqual({ keep: true });
        });
    });

    it("patch skips tokens that have no saved data", async () => {
        const { store, scene } = await setup([makeToken({ id: "plain" })]);
        await store.patch("plain", { elevation: 10 });
        expect(scene.peek().items[0].metadata[META_KEY]).toBeUndefined();
    });
});

describe("initiative rolls and HP taps", () => {
    it("serializes typed HP and button adjustments and announces each committed loss once", async () => {
        const { store, port, meta } = await setup([
            makeToken({ id: "a", metadata: saved({ currentHP: 30, maxHP: 30, tempHP: 5, concentrating: true }) }),
        ]);
        const checks: unknown[] = [];
        port.broadcast.onMessage(CONCENTRATION_CHANNEL, (message) => {
            checks.push({ message, hp: meta("a").currentHP });
        });
        await Promise.all([store.setHP("a", 20), store.adjustHP("a", -5), store.setHP("a", 0, "temp")]);
        await flush();
        expect(meta("a")).toMatchObject({ currentHP: 20, tempHP: 0 });
        expect(checks).toEqual([
            { message: { type: "CHECK_NEEDED", tokenId: "a", tokenName: "a", dc: 10 }, hp: 25 },
            { message: { type: "CHECK_NEEDED", tokenId: "a", tokenName: "a", dc: 10 }, hp: 20 },
        ]);
    });

    it("sets current HP to max HP before and during an encounter", async () => {
        const { store, meta } = await setup([
            makeToken({ id: "a", metadata: saved({ currentHP: 10, maxHP: 10 }) }),
        ]);
        await store.setHP("a", 20, "max");
        expect(meta("a")).toMatchObject({ currentHP: 20, maxHP: 20 });
        await Promise.all([store.start(), store.setHP("a", 30, "max")]);
        expect(meta("a")).toMatchObject({ currentHP: 30, maxHP: 30 });
        await store.setHP("a", 15, "max");
        expect(meta("a")).toMatchObject({ currentHP: 15, maxHP: 15 });
    });

    it("does not announce concentration checks when an HP write fails", async () => {
        const { port } = await setup([
            makeToken({ id: "a", metadata: saved({ concentrating: true }) }),
        ]);
        const checks: unknown[] = [];
        port.broadcast.onMessage(CONCENTRATION_CHANNEL, (message) => checks.push(message));
        const store = createEncounterStore({
            ...port,
            items: { ...port.items, update: async () => { throw new Error("Write failed"); } },
        });
        await expect(store.setHP("a", 0)).rejects.toThrow("Write failed");
        await expect(store.adjustHP("a", -5)).rejects.toThrow("Write failed");
        await flush();
        expect(checks).toEqual([]);
    });

    it("rolls once per group, applies bonuses, preserves member order and skips staged groups", async () => {
        const { store, meta } = await setup([
            makeToken({ id: "a", metadata: saved({ initiativeBonus: -2 }) }),
            makeToken({ id: "b", metadata: saved({ groupId: "g", initiative: 15.1, groupInitiativeBonus: 3 }) }),
            makeToken({ id: "c", metadata: saved({ groupId: "g", initiative: 15.2, groupInitiativeBonus: 3 }) }),
            makeToken({ id: "d", metadata: saved({ groupId: "staged", groupStaged: true, initiative: 7 }) }),
        ]);
        let rolls = 0;
        await store.rollInitiative(undefined, () => { rolls++; return 0.5; });
        expect(rolls).toBe(2);
        expect(meta("a").initiative).toBe(9);
        expect(meta("b")).toMatchObject({ initiative: 14, groupIndex: 0 });
        expect(meta("c")).toMatchObject({ initiative: 14, groupIndex: 1 });
        expect(meta("d").initiative).toBe(7);
        await store.rollInitiative("staged", () => 0);
        expect(meta("d").initiative).toBe(1);
    });

    it("saves group bonuses on every member without replacing individual bonuses", async () => {
        const { store, meta } = await setup([
            makeToken({ id: "a", metadata: saved({ groupId: "g", initiativeBonus: 2 }) }),
            makeToken({ id: "b", metadata: saved({ groupId: "g", initiativeBonus: 5 }) }),
        ]);
        await store.setGroupInitiativeBonus("g", -1);
        await store.rollInitiative("g", () => 0.999);
        expect(meta("a")).toMatchObject({ initiativeBonus: 2, groupInitiativeBonus: -1, initiative: 19 });
        expect(meta("b")).toMatchObject({ initiativeBonus: 5, groupInitiativeBonus: -1, initiative: 19 });
    });

    it("serializes rapid HP taps, absorbs damage with temp HP and caps healing", async () => {
        const { store, meta } = await setup([
            makeToken({ id: "a", metadata: saved({ currentHP: 10, maxHP: 10, tempHP: 1 }) }),
        ]);
        await Promise.all([store.adjustHP("a", -1), store.adjustHP("a", -1), store.adjustHP("a", -1)]);
        expect(meta("a")).toMatchObject({ currentHP: 8, tempHP: 0 });
        await store.adjustHP("a", -5);
        expect(meta("a").currentHP).toBe(3);
        await store.adjustHP("a", 5);
        expect(meta("a").currentHP).toBe(8);
        await store.adjustHP("a", 100);
        expect(meta("a").currentHP).toBe(10);
    });
});


describe("PC initiative entry", () => {
    it("never rolls PCs or groups containing PCs, including explicitly targeted rolls", async () => {
        const { store, meta } = await setup([
            makeToken({ id: "pc", metadata: saved({ playerCharacter: true, initiative: 17 }) }),
            makeToken({ id: "group-pc", metadata: saved({ playerCharacter: true, groupId: "g", initiative: 8 }) }),
            makeToken({ id: "group-npc", metadata: saved({ groupId: "g", initiative: 8 }) }),
            makeToken({ id: "npc", metadata: saved() }),
        ]);
        let rolls = 0;
        const random = () => { rolls++; return 0.5; };
        await store.rollInitiative(undefined, random);
        await store.rollInitiative("pc", random);
        await store.rollInitiative("g", random);
        expect(rolls).toBe(1);
        expect(meta("pc").initiative).toBe(17);
        expect(meta("group-pc").initiative).toBe(8);
        expect(meta("group-npc").initiative).toBe(8);
        expect(meta("npc").initiative).toBe(11);
    });

    it("always lists PCs but only shows eligible NPCs during an encounter", async () => {
        const { store } = await setup([
            makeToken({ id: "pc", visible: false, metadata: saved({ playerCharacter: true, groupId: "staged", groupStaged: true }) }),
            makeToken({ id: "npc", metadata: saved() }),
            makeToken({ id: "hidden", visible: false, metadata: saved() }),
            makeToken({ id: "staged-npc", metadata: saved({ groupId: "staged", groupStaged: true }) }),
        ]);
        const { combatants, groups } = store.getState();
        const ids = (started: boolean, disabled: boolean) => playerCombatants(combatants, groups, started, disabled).map((c) => c.id).sort();
        expect(ids(false, false)).toEqual(["pc"]);
        expect(ids(false, true)).toEqual(["pc"]);
        expect(ids(true, true)).toEqual(["pc"]);
        expect(ids(true, false)).toEqual(["npc", "pc"]);
    });

    it("persists manual PC initiative and applies a grouped PC's initiative to its whole group", async () => {
        const { store, meta } = await setup([
            makeToken({ id: "pc", metadata: saved({ playerCharacter: true }) }),
            makeToken({ id: "group-pc", metadata: saved({ playerCharacter: true, groupId: "g" }) }),
            makeToken({ id: "group-npc", metadata: saved({ groupId: "g" }) }),
        ]);
        await store.setPlayerInitiative("pc", 18);
        await store.setPlayerInitiative("group-pc", 14);
        expect(meta("pc").initiative).toBe(18);
        expect(meta("group-pc").initiative).toBe(14);
        expect(meta("group-npc").initiative).toBe(14);
    });
});


it("locks player initiative during the encounter and unlocks it when the encounter ends", async () => {
    const { store, meta } = await setup([
        makeToken({ id: "pc", metadata: saved({ playerCharacter: true, initiative: 12 }) }),
        makeToken({ id: "group-pc", metadata: saved({ playerCharacter: true, groupId: "g", initiative: 8 }) }),
        makeToken({ id: "group-npc", metadata: saved({ groupId: "g", initiative: 8 }) }),
    ]);
    // Starting and committing immediately also blocks a field edit that was already in progress.
    await Promise.all([store.start(), store.setPlayerInitiative("pc", 20), store.setPlayerInitiative("group-pc", 18)]);
    expect(meta("pc").initiative).toBe(12);
    expect(meta("group-pc").initiative).toBe(8);
    expect(meta("group-npc").initiative).toBe(8);
    await store.end();
    await store.setPlayerInitiative("pc", 20);
    expect(meta("pc").initiative).toBe(20);
});

it("applies rapid temporary HP taps and spills excess damage into current HP", async () => {
    const { store, meta } = await setup([
        makeToken({ id: "npc", metadata: saved({ currentHP: 20, maxHP: 20, tempHP: 8 }) }),
    ]);
    await Promise.all([store.adjustHP("npc", -5, "temp"), store.adjustHP("npc", -1, "temp")]);
    expect(meta("npc")).toMatchObject({ tempHP: 2, currentHP: 20 });
    await store.adjustHP("npc", 5, "temp");
    await store.adjustHP("npc", 1, "temp");
    expect(meta("npc")).toMatchObject({ tempHP: 8, currentHP: 20 });
    await store.adjustHP("npc", -5, "temp");
    await store.adjustHP("npc", -5, "temp");
    expect(meta("npc")).toMatchObject({ tempHP: 0, currentHP: 18 });
});

describe("named profiles when joining initiative", () => {
    it("shares the profile write queue between encounter saves and profile controls", async () => {
        const key = "com.missing-link-dev.battle-board/characterProfiles";
        const stats = { maxHP: 7, movement: 30, ac: 15, initiativeBonus: 2, playerCharacter: false };
        const scene = createFakeScene({
            items: [makeToken({ id: "a", name: "Goblin", metadata: saved(stats) })],
            roomMetadata: { [key]: { wolf: stats } },
        });
        const original = scene.connect();
        let releaseRead!: () => void;
        let notifyReading!: () => void;
        const reading = new Promise<void>((resolve) => { notifyReading = resolve; });
        const blocked = new Promise<void>((resolve) => { releaseRead = resolve; });
        let reads = 0;
        const port = {
            ...original,
            roomMetadata: {
                ...original.roomMetadata,
                get: async () => {
                    const room = await original.roomMetadata.get();
                    if (++reads === 1) {
                        notifyReading();
                        await blocked;
                    }
                    return room;
                },
            },
        };
        const encounter = createEncounterStore(port);
        const profiles = createProfileStore(port);
        const saving = encounter.saveProfile("a");
        await reading;
        const forgetting = profiles.forget("wolf");
        await flush();
        releaseRead();
        await Promise.all([saving, forgetting]);
        expect(await profiles.read()).toEqual({ goblin: stats });

    });

    it("applies a saved profile to ten fresh tokens in one batch, using live names and full HP", async () => {
        const stats = { maxHP: 7, movement: 30, ac: 15, initiativeBonus: 2, playerCharacter: false };
        const scene = createFakeScene({ items: [
            makeToken({ id: "template", name: "Goblin", metadata: saved({ ...stats, currentHP: 1, tempHP: 4, initiative: 19, active: true, concentrating: true }) }),
            ...Array.from({ length: 10 }, (_, i) => makeToken({ id: `g${i}`, name: " GOBLIN " })),
            makeToken({ id: "other", name: "Goblin captain" }),
        ] });
        const port = scene.connect();
        const store = createEncounterStore(port);
        await store.saveProfile("template");
        await store.add([...Array.from({ length: 10 }, (_, i) => `g${i}`), "other"]);
        for (const item of scene.peek().items.filter((t) => /^g\d+$/.test(t.id))) {
            expect(item.metadata[META_KEY]).toMatchObject({ ...stats, currentHP: 7, tempHP: 0, initiative: 0, active: false, concentrating: false });
        }
        expect(scene.peek().items.find((t) => t.id === "other")!.metadata[META_KEY]).toMatchObject({ maxHP: 10, ac: 10 });
        expect(scene.writes.filter((w) => w.kind === "items.update")).toHaveLength(1);
    });

    it("loads profiles in a new scene, including tokens added directly to a group", async () => {
        const original = createFakeScene({ items: [makeToken({ id: "pc", name: "Gundren", metadata: saved({ maxHP: 40, currentHP: 5, ac: 18, movement: 25, playerCharacter: true, initiativeBonus: -1 }) })] });
        await createEncounterStore(original.connect()).saveProfile("pc");
        const nextScene = createFakeScene({ roomMetadata: original.peek().roomMetadata, items: [makeToken({ id: "next", name: "Gundren" })] });
        const store = createEncounterStore(nextScene.connect());
        await store.addToGroup(["next"], { newGroup: { name: "Party", initiative: 16, staged: false } }, { hideWhenStaged: false });
        expect(nextScene.peek().items[0].metadata[META_KEY]).toMatchObject({ maxHP: 40, currentHP: 40, ac: 18, movement: 25, playerCharacter: true, initiativeBonus: -1, initiative: 16, groupName: "Party" });
    });

    it("uses the displayed token label as the profile name and preserves prepped and returning tokens", async () => {
        const { store, port, meta } = await setup([
            makeToken({ id: "template", name: "Goblin", metadata: saved({ maxHP: 7, ac: 15 }) }),
            makeToken({ id: "prepped", name: "Goblin", metadata: saved({ currentHP: 2, maxHP: 20, ac: 17, inInitiative: false }) }),
            makeToken({ id: "fresh", name: "asset-name" }),
        ]);
        await port.items.update(["fresh"], (items) => { (items[0] as ReturnType<typeof makeToken>).text.plainText = "Goblin"; });
        await store.saveProfile("template");
        await store.add(["prepped", "fresh"]);
        expect(meta("fresh")).toMatchObject({ maxHP: 7, ac: 15, currentHP: 7 });
        expect(meta("prepped")).toMatchObject({ currentHP: 2, maxHP: 20, ac: 17 });
        await store.adjustHP("fresh", -1);
        await store.remove(["fresh"]);
        await store.add(["fresh"]);
        expect(meta("fresh").currentHP).toBe(6);
    });

    it("explicitly loads permanent stats without copying encounter state or other token settings", async () => {
        const { store, meta } = await setup([
            makeToken({ id: "template", name: "Goblin", metadata: saved({ maxHP: 12, ac: 16, movement: 40, initiativeBonus: 3, currentHP: 1, tempHP: 4 }) }),
            makeToken({ id: "existing", name: "Goblin", metadata: saved({ currentHP: 2, maxHP: 20, tempHP: 5, active: true, initiative: 17, groupId: "g", movementColor: "#123456" }) }),
        ]);
        await store.saveProfile("template");
        await store.loadProfile("existing");
        expect(meta("existing")).toMatchObject({ currentHP: 12, maxHP: 12, ac: 16, movement: 40, initiativeBonus: 3, tempHP: 5, active: true, initiative: 17, groupId: "g", movementColor: "#123456" });
        await expect(store.loadProfile("missing")).rejects.toThrow("no longer");
    });

    it("saves fresh stats after pending health edits and changes a profile only when explicitly saved", async () => {
        const { store, scene } = await setup([makeToken({ id: "a", name: "Goblin", metadata: saved() })]);
        await Promise.all([store.setHP("a", 18, "max"), store.saveProfile("a")]);
        const key = "com.missing-link-dev.battle-board/characterProfiles";
        expect(scene.peek().roomMetadata[key]).toMatchObject({ goblin: { maxHP: 18 } });
        await store.setHP("a", 25, "max");
        expect(scene.peek().roomMetadata[key]).toMatchObject({ goblin: { maxHP: 18 } });
        await store.saveProfile("a");
        expect(scene.peek().roomMetadata[key]).toMatchObject({ goblin: { maxHP: 25 } });
    });
});

it("applies imported profiles to future additions while leaving current combatants unchanged", async () => {
    const { store, port, meta } = await setup([
        makeToken({ id: "existing", name: "Goblin", metadata: saved({ currentHP: 2, maxHP: 10 }) }),
        makeToken({ id: "fresh", name: "Goblin" }),
    ]);
    await createProfileStore(port).importStorage(JSON.stringify({ goblin: { maxHP: 7, ac: 15, movement: 30, initiativeBonus: 2, playerCharacter: false } }));
    expect(meta("existing")).toMatchObject({ currentHP: 2, maxHP: 10 });
    await store.add(["fresh"]);
    expect(meta("fresh")).toMatchObject({ currentHP: 7, maxHP: 7, ac: 15, initiativeBonus: 2 });
});

describe("pre-encounter initiative controls", () => {
    it("asks the DM to roll groups containing tokens the player does not own", async () => {
        const { scene, store, meta } = await setup([
            makeToken({ id: "pc", owner: "alice", metadata: saved({ playerCharacter: true, groupId: "g", groupIndex: 0 }) }),
            makeToken({ id: "npc", owner: "gm", metadata: saved({ groupId: "g", groupIndex: 1 }) }),
        ]);
        const port = scene.connect("PLAYER", "alice");
        let playerWrites = 0;
        const player = createEncounterStore({
            ...port,
            items: { ...port.items, update: async () => { playerWrites++; throw new Error("Owner-only permission denied"); } },
        });
        let rolls = 0;
        await expect(player.rollPlayerInitiative("pc", () => { rolls++; return 0.5; })).rejects.toThrow("Ask the DM");
        expect(playerWrites).toBe(0);
        expect(rolls).toBe(0);
        expect(meta("pc").initiative).toBe(0);
        expect(meta("npc").initiative).toBe(0);
        await store.rollPlayerInitiative("pc", () => 0.5);
        expect(meta("pc").initiative).toBe(11);
        expect(meta("npc").initiative).toBe(11);
    });

    it("allows a player to roll a group when they own every member", async () => {
        const { scene, meta } = await setup([
            makeToken({ id: "pc", owner: "alice", metadata: saved({ playerCharacter: true, groupId: "g", groupIndex: 0, groupInitiativeBonus: 2 }) }),
            makeToken({ id: "companion", owner: "alice", metadata: saved({ groupId: "g", groupIndex: 1, groupInitiativeBonus: 2 }) }),
        ]);
        const port = scene.connect("PLAYER", "alice");
        const player = createEncounterStore({
            ...port,
            items: { ...port.items, update: async (ids, update) => {
                const items = await port.items.get(ids);
                if (items.some((item) => item.createdUserId !== "alice")) throw new Error("Owner-only permission denied");
                await port.items.update(ids, update);
            } },
        });
        await player.rollPlayerInitiative("pc", () => 0.5);
        expect(meta("pc")).toMatchObject({ initiative: 13, groupIndex: 0 });
        expect(meta("companion")).toMatchObject({ initiative: 13, groupIndex: 1 });
    });

    it("resets PCs, NPCs and staged groups to zero without losing legacy member order or stats", async () => {
        const { store, meta } = await setup([
            makeToken({ id: "pc", metadata: saved({ playerCharacter: true, initiative: 18, initiativeBonus: 3, currentHP: 4 }) }),
            makeToken({ id: "npc", metadata: saved({ initiative: 12, initiativeBonus: 2 }) }),
            makeToken({ id: "second", metadata: saved({ groupId: "g", groupStaged: true, initiative: 10.2, groupInitiativeBonus: 4 }) }),
            makeToken({ id: "first", metadata: saved({ groupId: "g", groupStaged: true, initiative: 10.1, groupInitiativeBonus: 4 }) }),
            makeToken({ id: "removed", metadata: saved({ inInitiative: false, initiative: 17 }) }),
        ]);
        await store.resetInitiative();
        expect(meta("pc")).toMatchObject({ initiative: 0, initiativeBonus: 3, currentHP: 4, playerCharacter: true });
        expect(meta("npc")).toMatchObject({ initiative: 0, initiativeBonus: 2 });
        expect(meta("first")).toMatchObject({ initiative: 0, groupIndex: 0, groupStaged: true, groupInitiativeBonus: 4 });
        expect(meta("second")).toMatchObject({ initiative: 0, groupIndex: 1, groupStaged: true, groupInitiativeBonus: 4 });
        expect(meta("removed").initiative).toBe(17);
    });

    it("rejects reset after the encounter starts and from player clients", async () => {
        const { store, scene, meta } = await setup([makeToken({ id: "pc", metadata: saved({ playerCharacter: true, initiative: 18 }) })]);
        await createEncounterStore(scene.connect("PLAYER")).resetInitiative();
        expect(scene.writes).toEqual([]);
        await Promise.all([store.start(), store.resetInitiative()]);
        expect(meta("pc").initiative).toBe(18);
    });

    it("rolls a PC explicitly at zero while bulk rolls continue to skip all PCs", async () => {
        const { store, meta } = await setup([
            makeToken({ id: "pc", metadata: saved({ playerCharacter: true, initiativeBonus: 2 }) }),
            makeToken({ id: "waiting-pc", metadata: saved({ playerCharacter: true }) }),
            makeToken({ id: "npc", metadata: saved() }),
        ]);
        await store.rollPlayerInitiative("pc", () => 0.5);
        expect(meta("pc").initiative).toBe(13);
        await store.rollInitiative(undefined, () => 0);
        expect(meta("pc").initiative).toBe(13);
        expect(meta("waiting-pc").initiative).toBe(0);
        expect(meta("npc").initiative).toBe(1);
    });

    it("allows player-client PC rolls but blocks nonzero, non-PC and ongoing-encounter rolls", async () => {
        const { store, scene, meta } = await setup([
            makeToken({ id: "pc", metadata: saved({ playerCharacter: true, initiative: 9 }) }),
            makeToken({ id: "waiting", metadata: saved({ playerCharacter: true }) }),
            makeToken({ id: "npc", metadata: saved() }),
        ]);
        const player = createEncounterStore(scene.connect("PLAYER"));
        let rolls = 0;
        const random = () => { rolls++; return 0; };
        await player.rollPlayerInitiative("pc", random);
        await player.rollPlayerInitiative("npc", random);
        expect(rolls).toBe(0);
        expect(scene.writes).toEqual([]);
        await player.rollPlayerInitiative("waiting", random);
        expect(meta("waiting").initiative).toBe(1);
        await store.setPlayerInitiative("waiting", 0);
        await Promise.all([store.start(), store.rollPlayerInitiative("waiting", random)]);
        expect(meta("waiting").initiative).toBe(0);
        expect(rolls).toBe(1);
    });

    it("rolls a PC group once with the shared bonus and preserves member order", async () => {
        const { store, meta } = await setup([
            makeToken({ id: "pc", metadata: saved({ playerCharacter: true, groupId: "g", groupIndex: 1, initiativeBonus: 8, groupInitiativeBonus: 3 }) }),
            makeToken({ id: "npc", metadata: saved({ groupId: "g", groupIndex: 0, groupInitiativeBonus: 3 }) }),
        ]);
        await store.rollPlayerInitiative("pc", () => 0.5);
        expect(meta("pc")).toMatchObject({ initiative: 14, groupIndex: 1, initiativeBonus: 8 });
        expect(meta("npc")).toMatchObject({ initiative: 14, groupIndex: 0 });
        await store.rollInitiative(undefined, () => 0);
        expect(meta("pc").initiative).toBe(14);
        expect(meta("npc").initiative).toBe(14);
    });
});
