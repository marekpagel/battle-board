import { describe, expect, it, vi } from "vitest";
import { createFakeScene, flush } from "../obr/fakeScene";
import { makeToken } from "../test/tokens";
import { DEFAULT_META, META_KEY } from "../components/metadata";
import { createEncounterStore, SCENE_META_KEY } from "../encounter/store";
import { INITIATIVE_REQUEST_CHANNEL, listenForInitiativeRequests, requestPlayerInitiative } from "./requests";

const pc = (id: string, owner = "alice", extra: Record<string, unknown> = {}) => makeToken({ id, owner,
    metadata: { [META_KEY]: { ...DEFAULT_META, name: id, visible: true, playerCharacter: true, initiative: 0, ...extra } } });
const ui = () => ({ open: vi.fn<(ids: string[]) => Promise<void>>().mockResolvedValue(undefined), close: vi.fn(async () => {}) });

describe("player initiative requests", () => {
    it("prompts only connected owners of visible pending PCs, with no main panel subscription", async () => {
        const scene = createFakeScene({ items: [pc("a"), pc("b", "bob"), pc("done", "alice", { initiative: 15 }),
            pc("offline", "offline"), pc("npc", "alice", { playerCharacter: false }), { ...pc("hidden"), visible: false }] });
        const gm = scene.connect("GM", "dm"), alice = scene.connect("PLAYER", "alice"), bob = scene.connect("PLAYER", "bob");
        const aliceUI = ui(), bobUI = ui(), gmUI = ui();
        const stops = [listenForInitiativeRequests(alice, aliceUI), listenForInitiativeRequests(bob, bobUI), listenForInitiativeRequests(gm, gmUI)];
        expect(await requestPlayerInitiative(gm)).toBe(2);
        await flush();
        expect(aliceUI.open).toHaveBeenCalledWith(["a"]);
        expect(bobUI.open).toHaveBeenCalledWith(["b"]);
        expect(gmUI.open).not.toHaveBeenCalled();
        stops.forEach((stop) => stop()); await flush();
        expect(aliceUI.close).toHaveBeenCalledOnce();
    });

    it("does not send requests during an encounter or from a player client", async () => {
        const scene = createFakeScene({ items: [pc("a")], sceneMetadata: { [SCENE_META_KEY]: { started: true, round: 1 } } });
        const gm = scene.connect("GM"), alice = scene.connect("PLAYER", "alice"), popup = ui();
        const stop = listenForInitiativeRequests(alice, popup);
        expect(await requestPlayerInitiative(gm)).toBe(0);
        expect(await requestPlayerInitiative(alice)).toBe(0);
        // Even a delayed pre-encounter request is ignored after Start.
        await gm.broadcast.send(INITIATIVE_REQUEST_CHANNEL, ["a"], "REMOTE");
        await flush(); expect(popup.open).not.toHaveBeenCalled();
        stop();
    });

    it("prompts once per owned group, excludes staged and mixed-owner groups, and preserves member order", async () => {
        const scene = createFakeScene({ items: [
            pc("g2", "alice", { groupId: "g", groupIndex: 1 }), pc("g1", "alice", { groupId: "g", groupIndex: 0 }),
            pc("mixed1", "alice", { groupId: "mixed" }), pc("mixed2", "bob", { groupId: "mixed" }),
            pc("staged", "alice", { groupId: "staged", groupStaged: true }),
        ] });
        const gm = scene.connect("GM"), alice = scene.connect("PLAYER", "alice"), popup = ui();
        scene.connect("PLAYER", "bob");
        const stop = listenForInitiativeRequests(alice, popup);
        expect(await requestPlayerInitiative(gm)).toBe(1);
        await flush(); expect(popup.open).toHaveBeenCalledWith(["g1"]);
        const store = createEncounterStore(alice);
        await store.submitRequestedInitiative("g1", 17);
        const meta = scene.peek().items.map((item) => item.metadata[META_KEY]);
        expect(meta[0]).toMatchObject({ initiative: 17, groupIndex: 1 });
        expect(meta[1]).toMatchObject({ initiative: 17, groupIndex: 0 });
        stop();
    });

    it("rechecks ownership, existing initiative, PC flag and encounter lock before writing", async () => {
        const scene = createFakeScene({ items: [pc("a"), pc("bob", "bob"), pc("npc", "alice", { playerCharacter: false })] });
        const alice = scene.connect("PLAYER", "alice"), store = createEncounterStore(alice);
        await expect(store.submitRequestedInitiative("a", NaN)).rejects.toThrow("valid initiative");
        await expect(store.submitRequestedInitiative("bob", 20)).rejects.toThrow("no longer waiting");
        await expect(store.submitRequestedInitiative("npc", 20)).rejects.toThrow("no longer waiting");
        await store.submitRequestedInitiative("a", 12.5);
        await expect(store.submitRequestedInitiative("a", 20)).rejects.toThrow("no longer waiting");
        expect(scene.peek().items[0].metadata[META_KEY]).toMatchObject({ initiative: 12.5 });
        await store.patch("a", { initiative: 0 });
        await alice.sceneMetadata.set({ [SCENE_META_KEY]: { started: true, round: 1 } });
        await expect(store.submitRequestedInitiative("a", 20)).rejects.toThrow("no longer waiting");
        expect(scene.peek().items[0].metadata[META_KEY]).toMatchObject({ initiative: 0 });
    });

    it("ignores malformed broadcasts and closes after an open completes if its runtime stops", async () => {
        const scene = createFakeScene({ items: [pc("a")] });
        const gm = scene.connect("GM"), alice = scene.connect("PLAYER", "alice"), popup = ui();
        let finish: () => void = () => {};
        popup.open.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const stop = listenForInitiativeRequests(alice, popup);
        await gm.broadcast.send(INITIATIVE_REQUEST_CHANNEL, { tokens: ["a"] }, "REMOTE");
        await flush(); expect(popup.open).not.toHaveBeenCalled();
        await requestPlayerInitiative(gm); await flush();
        stop(); await flush(); expect(popup.close).not.toHaveBeenCalled();
        finish(); await flush(); expect(popup.close).toHaveBeenCalledOnce();
    });
});
