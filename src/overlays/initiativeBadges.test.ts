import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import OBR, { isLabel, type Item } from "@owlbear-rodeo/sdk";
import { DEFAULT_META, META_KEY } from "../components/metadata";
import { SCENE_META_KEY } from "../encounter/store";
import { createFakeScene, flush } from "../obr/fakeScene";
import type { ObrPort } from "../obr/port";
import { ROOM_META_KEY } from "../settings/settings";
import { makeToken } from "../test/tokens";
import { buildInitiativeBadge, desiredInitiativeBadges, INITIATIVE_BADGE_KEY, startInitiativeBadgeSync } from "./initiativeBadges";

const token = (id: string, initiative: number, extra: Record<string, unknown> = {}, visible = true) => makeToken({
    id, visible, metadata: { [META_KEY]: { ...DEFAULT_META, name: id, visible, initiative, ...extra } },
});
const clock = (started = true) => ({ [SCENE_META_KEY]: { started, round: started ? 1 : 0 } });
const settle = async () => { await flush(); await flush(); };
const labels = async (port: ObrPort) => (await port.localItems.get()).filter(isLabel);
const orders = (items: Item[]) => items.filter(isLabel).map((label) => [label.attachedTo, label.text.plainText]);

beforeAll(() => { vi.spyOn(OBR.player, "id", "get").mockReturnValue("test-player"); });
afterAll(() => { vi.restoreAllMocks(); });

describe("initiative order badges", () => {
    it("numbers turns rather than initiative scores, excluding staged, removed and untracked tokens", () => {
        const items = [
            token("slow", 5), token("fast", 21), token("staged", 25, { groupId: "g", groupStaged: true }),
            token("removed", 30, { inInitiative: false }), makeToken({ id: "untracked" }),
        ];
        const specs = desiredInitiativeBadges(items, clock(), 150, "GM");
        expect(specs.map((s) => [s.tokenId, s.order])).toEqual([["fast", 1], ["slow", 2]]);
        expect(desiredInitiativeBadges(items, clock(false), 150, "GM")).toEqual([]);
    });

    it("gives all group members the same turn position and highlight", () => {
        const items = [
            token("first", 20), token("b", 15, { groupId: "g", groupIndex: 1, active: true }),
            token("a", 15, { groupId: "g", groupIndex: 0, active: true }), token("last", 10),
        ];
        const specs = desiredInitiativeBadges(items, clock(), 150, "GM");
        expect(specs.map((s) => [s.tokenId, s.order, s.active])).toEqual([
            ["first", 1, false], ["a", 2, true], ["b", 2, true], ["last", 3, false],
        ]);
    });

    it("does not reveal hidden turns through player badges or gaps in numbering", () => {
        const items = [
            token("hidden", 30, {}, false), token("hidden-pc", 25, { playerCharacter: true }, false),
            token("hidden-member", 20, { groupId: "g" }, false), token("visible-member", 20, { groupId: "g" }),
            token("pc", 10, { playerCharacter: true }),
        ];
        const player = desiredInitiativeBadges(items, clock(), 150, "PLAYER");
        expect(player.map((s) => [s.tokenId, s.order])).toEqual([["visible-member", 1], ["pc", 2]]);
        expect(desiredInitiativeBadges(items, clock(), 150, "GM").map((s) => [s.tokenId, s.order])).toEqual([
            ["hidden", 1], ["hidden-pc", 2], ["hidden-member", 3], ["visible-member", 3], ["pc", 4],
        ]);
    });

    it("places compact, high-contrast badges at the upper right, scaling with zoom and fitting long orders", () => {
        const t = token("large", 15, { active: true });
        t.position = { x: 100, y: 200 };
        t.scale = { x: 2, y: 3 };
        const [spec] = desiredInitiativeBadges([t], clock(), 100, "GM");
        expect(spec).toMatchObject({ size: 20, position: { x: 190, y: 60 } });
        const badge = buildInitiativeBadge(spec);
        expect(badge).toMatchObject({
            attachedTo: "large", disableHit: true, disableAutoZIndex: true, layer: "TEXT",
            disableAttachmentBehavior: ["SCALE", "ROTATION", "VISIBLE", "COPY"],
            style: { minViewScale: 1, maxViewScale: 1, backgroundColor: "#6d46a2", backgroundOpacity: 0.95, pointerHeight: 0 },
            text: { plainText: "1", style: { fillColor: "#ffffff" } },
        });
        expect(buildInitiativeBadge({ ...spec, active: false }).style.backgroundColor).toBe("#202334");
        const long = buildInitiativeBadge({ ...spec, order: 123 });
        expect(long.text.style.fontSize).toBeLessThan(badge.text.style.fontSize);
    });

    it("keeps player and GM badges local and stops writing once the scene settles", async () => {
        const scene = createFakeScene({ items: [token("hidden", 30, {}, false), token("pc", 15)], sceneMetadata: clock() });
        const gm = scene.connect("GM"), player = scene.connect("PLAYER");
        const stopGm = startInitiativeBadgeSync(gm), stopPlayer = startInitiativeBadgeSync(player);
        await settle();
        expect(orders(await gm.localItems.get())).toEqual([["hidden", "1"], ["pc", "2"]]);
        expect(orders(await player.localItems.get())).toEqual([["pc", "1"]]);
        expect(scene.writes.every((write) => write.kind.startsWith("localItems."))).toBe(true);
        const count = scene.writes.length;
        await player.items.update(["pc"], ([item]) => { (item.metadata[META_KEY] as { currentHP: number }).currentHP = 5; });
        await settle();
        expect(scene.writes).toHaveLength(count + 1); // Unrelated health changes need no badge write.
        stopGm(); stopPlayer(); await settle();
        expect(await gm.localItems.get()).toEqual([]);
        expect(await player.localItems.get()).toEqual([]);
    });

    it("updates order, active turn, movement, grid size, removal and encounter state live", async () => {
        const scene = createFakeScene({ items: [token("a", 20), token("b", 10)], sceneMetadata: clock(false) });
        const port = scene.connect();
        const stop = startInitiativeBadgeSync(port);
        await settle();
        expect(await labels(port)).toEqual([]);
        await port.sceneMetadata.set(clock());
        await settle();
        expect(orders(await labels(port))).toEqual([["a", "1"], ["b", "2"]]);
        await port.items.update(["b"], ([item]) => {
            Object.assign(item.metadata[META_KEY] as object, { initiative: 25, active: true });
            item.position = { x: 50, y: 80 };
        });
        scene.setGrid({ dpi: 100 });
        await settle();
        const b = (await labels(port)).find((item) => item.attachedTo === "b")!;
        expect(b).toMatchObject({ text: { plainText: "1", width: 20 }, position: { x: 90, y: 40 }, style: { backgroundColor: "#6d46a2" } });
        await port.items.update(["a"], ([item]) => { Object.assign(item.metadata[META_KEY] as object, { inInitiative: false }); });
        await settle();
        expect(orders(await labels(port))).toEqual([["b", "1"]]);
        await port.items.delete(["b"]);
        await settle();
        expect(await labels(port)).toEqual([]);
        await port.items.add([token("new", 15)]);
        await settle();
        expect(orders(await labels(port))).toEqual([["new", "1"]]);
        await port.sceneMetadata.set(clock(false));
        await settle();
        expect(await labels(port)).toEqual([]);
        stop(); await settle();
    });

    it("responds to staging and visibility without hiding badges when the player list is disabled", async () => {
        const scene = createFakeScene({ items: [token("a", 20), token("b", 10, { playerCharacter: true })], sceneMetadata: clock() });
        const player = scene.connect("PLAYER");
        const stop = startInitiativeBadgeSync(player);
        await settle();
        await player.items.update(["a", "b"], (items) => {
            for (const item of items) Object.assign(item.metadata[META_KEY] as object, { groupId: "g", initiative: 15 });
        });
        await settle();
        expect(orders(await labels(player))).toEqual([["a", "1"], ["b", "1"]]);
        await player.items.update(["a", "b"], (items) => {
            for (const item of items) Object.assign(item.metadata[META_KEY] as object, { groupStaged: true });
        });
        await settle();
        expect(await labels(player)).toEqual([]);
        await player.items.update(["a", "b"], (items) => {
            for (const item of items) Object.assign(item.metadata[META_KEY] as object, { groupStaged: false });
        });
        await player.roomMetadata.set({ [ROOM_META_KEY]: { disablePlayerList: true } });
        await settle();
        expect(orders(await labels(player))).toEqual([["a", "1"], ["b", "1"]]);
        await player.items.update(["b"], ([item]) => { item.visible = false; });
        await settle();
        expect(orders(await labels(player))).toEqual([["a", "1"]]);
        stop(); await settle();
    });

    it("shows players badges for visible PC and NPC tokens they do not own, with the player list already disabled", async () => {
        const scene = createFakeScene({
            items: [token("npc", 20), token("pc", 10, { playerCharacter: true })],
            sceneMetadata: clock(), roomMetadata: { [ROOM_META_KEY]: { disablePlayerList: true } },
        });
        const player = scene.connect("PLAYER", "spectator");
        const stop = startInitiativeBadgeSync(player);
        await settle();
        expect(orders(await labels(player))).toEqual([["npc", "1"], ["pc", "2"]]);
        stop(); await settle();
    });

    it("survives immediate remounts and cleans up only its own overlays", async () => {
        const scene = createFakeScene({ items: [token("pc", 15)], sceneMetadata: clock() });
        const port = scene.connect();
        await port.localItems.add([makeToken({ id: "other-overlay" })]);
        const stopFirst = startInitiativeBadgeSync(port);
        stopFirst();
        const stopSecond = startInitiativeBadgeSync(port);
        await settle();
        expect((await port.localItems.get()).filter((item) => item.metadata[INITIATIVE_BADGE_KEY])).toHaveLength(1);
        stopSecond(); await settle();
        expect((await port.localItems.get()).map((item) => item.id)).toEqual(["other-overlay"]);
    });
});
