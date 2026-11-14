import { describe, expect, it } from "vitest";
import { isLabel, type Item } from "@owlbear-rodeo/sdk";
import { createFakeScene, flush } from "../obr/fakeScene";
import { makeToken } from "../test/tokens";
import { DEFAULT_META, META_KEY, type MetaShape } from "../components/metadata";
import { desiredHealthMarkers, HEALTH_MARKER_KEY, healthMarkerId, startHealthMarkerSync, syncHealthMarkers, type HealthMarkerFactory } from "./healthMarkers";

const token = (id: string, fields: Partial<MetaShape> = {}, visible = true) => makeToken({
    id, visible, metadata: { [META_KEY]: { ...DEFAULT_META, name: id, visible, ...fields } },
});
const fakeMarker: HealthMarkerFactory = (spec) => ({
    ...makeToken({ id: spec.id }), type: "LABEL", name: spec.text,
    attachedTo: spec.tokenId, position: spec.position, visible: spec.visible,
    metadata: { [HEALTH_MARKER_KEY]: { tokenId: spec.tokenId } },
    text: { plainText: spec.text, style: { fillColor: spec.color, fontSize: 14, padding: 2 } },
}) as unknown as Item;
const markers = (items: Item[]) => items.filter(isLabel);
const setStats = (fields: Partial<MetaShape>) => ([item]: Item[]) => Object.assign(item.metadata[META_KEY] as MetaShape, fields);

describe("map health markers", () => {
    it("marks NPCs dead and PCs unconscious at 0 HP without marking healthy or untracked tokens", async () => {
        const scene = createFakeScene({ items: [
            token("npc", { currentHP: 0 }), token("pc", { currentHP: 0, playerCharacter: true }),
            token("healthy"), makeToken({ id: "untracked" }),
        ] });
        await syncHealthMarkers(scene.connect(), scene.peek().items, 150, fakeMarker);
        expect(markers(scene.peek().items).map((m) => [m.attachedTo, m.text.plainText])).toEqual([
            ["npc", "☠"], ["pc", "💤"],
        ]);
        const writes = scene.writes.length;
        await syncHealthMarkers(scene.connect(), scene.peek().items, 150, fakeMarker);
        expect(scene.writes.length).toBe(writes);
    });

    it("changes a badge when PC classification changes and removes it after healing", async () => {
        const scene = createFakeScene({ items: [token("a", { currentHP: 0 })] });
        const port = scene.connect();
        const sync = () => syncHealthMarkers(port, scene.peek().items, 150, fakeMarker);
        await sync();
        await port.items.update(["a"], setStats({ playerCharacter: true }));
        await sync();
        expect(markers(scene.peek().items)[0].text.plainText).toBe("💤");
        await port.items.update(["a"], setStats({ currentHP: 1 }));
        await sync();
        expect(markers(scene.peek().items)).toEqual([]);
    });

    it("matches token visibility and follows changes to position and size", async () => {
        const scene = createFakeScene({ items: [token("a", { currentHP: 0 }, false)] });
        const port = scene.connect();
        await syncHealthMarkers(port, scene.peek().items, 150, fakeMarker);
        expect(markers(scene.peek().items)[0].visible).toBe(false);
        await port.items.update(["a"], ([t]) => {
            t.visible = true;
            t.position = { x: 200, y: 300 };
            t.scale = { x: 2, y: 2 };
        });
        await syncHealthMarkers(port, scene.peek().items, 150, fakeMarker);
        expect(markers(scene.peek().items)[0]).toMatchObject({ visible: true, position: { x: 200, y: 430 } });
        expect(desiredHealthMarkers(scene.peek().items, 300).get(healthMarkerId("a"))?.position.y).toBe(580);
    });

    it("retains status on removed combatants and deletes orphaned or copied badges only", async () => {
        const spec = { id: "copy", tokenId: "gone", text: "☠", color: "#FFF", position: { x: 0, y: 0 }, visible: true };
        const scene = createFakeScene({ items: [
            token("a", { currentHP: 0, inInitiative: false }),
            fakeMarker(spec), fakeMarker({ ...spec, id: healthMarkerId("gone") }),
            makeToken({ id: "unrelated" }),
        ] });
        const port = scene.connect();
        await syncHealthMarkers(port, scene.peek().items, 150, fakeMarker);
        expect(scene.peek().items.map((i) => i.id)).toEqual(["a", "unrelated", healthMarkerId("a")]);
        await port.items.delete(["a"]);
        await syncHealthMarkers(port, scene.peek().items, 150, fakeMarker);
        expect(scene.peek().items.map((i) => i.id)).toEqual(["unrelated"]);
    });

    it("writes only from GM clients, reacts to HP changes, and settles without a write loop", async () => {
        const scene = createFakeScene({ items: [token("a")] });
        const stopPlayer = startHealthMarkerSync(scene.connect("PLAYER"), fakeMarker);
        await flush();
        expect(scene.writes).toEqual([]);
        const port = scene.connect("GM");
        const stopGm = startHealthMarkerSync(port, fakeMarker);
        await flush();
        await port.items.update(["a"], setStats({ currentHP: 0 }));
        await flush();
        await flush();
        expect(markers(scene.peek().items).map((m) => m.id)).toEqual([healthMarkerId("a")]);
        const writes = scene.writes.length;
        await flush();
        expect(scene.writes.length).toBe(writes);
        await port.items.update(["a"], setStats({ currentHP: 5 }));
        await flush();
        await flush();
        expect(markers(scene.peek().items)).toEqual([]);
        stopGm();
        stopPlayer();
        await port.items.update(["a"], setStats({ currentHP: 0 }));
        await flush();
        expect(markers(scene.peek().items)).toEqual([]);
    });
});
