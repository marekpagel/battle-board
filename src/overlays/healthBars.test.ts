import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import OBR, { isImage, isLabel, isPath, type Item } from "@owlbear-rodeo/sdk";
import { createFakeScene, flush } from "../obr/fakeScene";
import { makeToken } from "../test/tokens";
import { DEFAULT_META, META_KEY } from "../components/metadata";
import { DEFAULT_SETTINGS, ROOM_META_KEY, type HealthMode } from "../settings/settings";
import { desiredHealthBars, buildHealthBar, HEALTH_BAR_KEY, startHealthBarSync, syncHealthBars } from "./healthBars";

const token = (id: string, pc = false, extra: Record<string, unknown> = {}, visible = true) => makeToken({
    id, visible, metadata: { [META_KEY]: { ...DEFAULT_META, name: id, visible, playerCharacter: pc, currentHP: 12, maxHP: 30, tempHP: 3, ...extra } },
});
// Exercise the real SDK builders with a ready player identity.
beforeAll(() => { vi.spyOn(OBR.player, "id", "get").mockReturnValue("test-player"); });
afterAll(() => { vi.restoreAllMocks(); });
const factory = buildHealthBar;
const textOf = (items: Item[]) => items.filter(isLabel).map((i) => i.text.plainText);
const settle = async () => { await flush(); await flush(); };

describe("map health bars", () => {
    it("shows full health to GMs for all tracked tokens, including hidden tokens and removed combatants", () => {
        const items = [token("npc"), token("hidden", false, {}, false), token("pc", true, { inInitiative: false }), makeToken({ id: "no-stats" })];
        const specs = desiredHealthBars(items, 150, "GM", { ...DEFAULT_SETTINGS, displayHealthStatusToPlayer: false });
        expect(specs.map((s) => s.tokenId)).toEqual(["npc", "hidden", "pc"]);
        expect(specs.every((s) => s.mode === "barNumbers" && s.text === "12/30 (+3)" && s.fraction === 0.4 && s.tempFraction === 0.1)).toBe(true);
    });

    it.each<HealthMode>(["none", "status", "numbers", "bar", "barNumbers"])("honors player health mode %s without leaking extra health details", (mode) => {
        const specs = desiredHealthBars([token("npc")], 150, "PLAYER", { ...DEFAULT_SETTINGS, npcHealthMode: mode });
        if (mode === "none") { expect(specs).toEqual([]); return; }
        const [spec] = specs;
        expect(spec.text).toBe(mode === "status" ? "Bloodied" : mode === "bar" ? "" : "12/30 (+3)");
        expect(spec.fraction).toBe(mode === "bar" || mode === "barNumbers" ? 0.4 : null);
        expect(spec.tempFraction).toBe(mode === "bar" || mode === "barNumbers" ? 0.1 : 0);
        const parts = buildHealthBar(spec);
        if (mode === "status") {
            expect(textOf(parts)).toEqual(["Bloodied"]);
            expect(JSON.stringify(parts)).not.toContain("12/30");
            expect(parts.filter(isPath)).toHaveLength(0);
            expect(parts.filter(isPath).map((p) => p.style.fillColor)).not.toContain("#60bafc");
        }
        if (mode === "status" || mode === "numbers") {
            expect(parts.filter(isPath)).toEqual([]);
            expect(parts.filter(isLabel)[0].style.backgroundOpacity).toBe(0);
        }
        if (mode === "bar") expect(textOf(parts)).toEqual([]);
    });

    it.each([
        [30, false, "Healthy", "#11aa22"], [12, false, "Bloodied", "#ffaa11"],
        [0, false, "Dead", "#ee1122"], [0, true, "Dying", "#ee1122"],
    ] as const)("uses the panel's theme color for %s HP status", (currentHP, pc, text, color) => {
        const [spec] = desiredHealthBars([token("a", pc, { currentHP })], 150, "PLAYER", {
            ...DEFAULT_SETTINGS, pcHealthMode: "status", npcHealthMode: "status",
        }, { success: "#11aa22", warning: "#ffaa11", error: "#ee1122" });
        const [label] = buildHealthBar(spec).filter(isLabel);
        expect(label.text.plainText).toBe(text);
        expect(label.text.style.fillColor).toBe(color);
        expect(label.text.style).toMatchObject({ strokeColor: "#111318", strokeOpacity: 1, fontWeight: 700 });
        expect(label.text.style.strokeWidth).toBeGreaterThan(0);
        expect(label.style.backgroundOpacity).toBe(0);
    });

    it("builds separate native track, proportional fill and readable HP text without image assets", () => {
        const [spec] = desiredHealthBars([token("npc", false, { currentHP: 5, maxHP: 19, tempHP: 0 })], 150, "GM", DEFAULT_SETTINGS);
        const parts = buildHealthBar(spec);
        expect(parts.some(isImage)).toBe(false);
        const paths = parts.filter(isPath);
        expect(paths.map((p) => p.style.fillColor)).toEqual(["#55555d", "#c37822"]);
        const fillWidth = spec.width * 5 / 19;
        // Geometry and left alignment encode 5/19 HP, rather than a full-width red bar.
        expect(paths[1].position.x).toBeCloseTo(spec.position.x - (spec.width - fillWidth) / 2);
        expect(paths[1].commands[1][1]).toBeCloseTo(fillWidth / 2 - Math.min(fillWidth / 2, spec.height / 2));
        const [text] = parts.filter(isLabel);
        expect(text.text.plainText).toBe("5/19");
        expect(text.text.type).toBe("PLAIN");
        // A fixed compensation factor makes font size scale with map zoom.
        expect(text.style).toMatchObject({ minViewScale: 1, maxViewScale: 1 });
        expect(spec.width).toBe(150);
        expect(text.zIndex).toBeGreaterThan(paths[1].zIndex);
        expect(parts.every((p) => p.disableHit && p.disableAutoZIndex)).toBe(true);
        expect(spec.position.y + spec.height / 2).toBeLessThan(75);
    });

    it("replaces legacy image overlays with native items and removes empty fills at 0 HP", async () => {
        const scene = createFakeScene({ items: [token("npc", false, { currentHP: 0, tempHP: 0 })] });
        const port = scene.connect();
        const specs = desiredHealthBars(scene.peek().items, 150, "GM", DEFAULT_SETTINGS);
        await port.localItems.add([makeToken({ id: specs[0].id })]);
        await syncHealthBars(port, specs);
        expect((await port.localItems.get()).some(isImage)).toBe(false);
        expect((await port.localItems.get()).filter(isPath)).toHaveLength(1);
        expect(textOf(await port.localItems.get())).toEqual(["0/30"]);
    });

    it("applies PC and NPC settings independently, the master switch, and hidden-token visibility", () => {
        const items = [token("npc"), token("pc", true), token("hidden", true, {}, false)];
        const specs = desiredHealthBars(items, 150, "PLAYER", { ...DEFAULT_SETTINGS, pcHealthMode: "barNumbers", npcHealthMode: "none" });
        expect(specs.map((s) => s.tokenId)).toEqual(["pc"]);
        expect(desiredHealthBars(items, 150, "PLAYER", { ...DEFAULT_SETTINGS, displayHealthStatusToPlayer: false })).toEqual([]);
    });

    it("sizes and positions the bar from the token footprint and clamps fills", () => {
        const t = token("large", false, { currentHP: 45, maxHP: 30, tempHP: 60 });
        t.scale = { x: 2, y: 3 };
        t.position = { x: 100, y: 200 };
        const [spec] = desiredHealthBars([t], 100, "GM", DEFAULT_SETTINGS);
        expect(spec).toMatchObject({ width: 200, height: 9, position: { x: 100, y: 325.5 }, fraction: 1, tempFraction: 1 });
        const [zero] = desiredHealthBars([token("zero", false, { currentHP: 0, maxHP: 0 })], 150, "GM", DEFAULT_SETTINGS);
        expect(zero).toMatchObject({ text: "0/0 (+3)", fraction: null, tempFraction: 0 });
        expect(JSON.stringify(buildHealthBar(zero))).not.toMatch(/NaN|Infinity/);
    });

    it("keeps local overlays isolated between GM and player clients and never writes shared items", async () => {
        const scene = createFakeScene({ items: [token("npc")] });
        const gm = scene.connect("GM");
        const player = scene.connect("PLAYER");
        const stopGm = startHealthBarSync(gm, factory);
        const stopPlayer = startHealthBarSync(player, factory);
        await settle();
        expect(textOf(await gm.localItems.get())).toEqual(["12/30 (+3)"]);
        expect(textOf(await player.localItems.get())).toEqual(["Bloodied"]);
        expect(await gm.items.get()).toHaveLength(1);
        expect(scene.writes.every((w) => w.kind.startsWith("localItems."))).toBe(true);
        const writes = scene.writes.length;
        await settle();
        expect(scene.writes.length).toBe(writes);
        stopGm(); stopPlayer(); await settle();
        expect(await gm.localItems.get()).toEqual([]);
        expect(await player.localItems.get()).toEqual([]);
    });

    it("updates health, geometry and room settings live and cleans up only its own local overlays", async () => {
        const scene = createFakeScene({ items: [token("npc")] });
        const player = scene.connect("PLAYER");
        await player.localItems.add([makeToken({ id: "other-extension" })]);
        const stop = startHealthBarSync(player, factory);
        await settle();
        await player.roomMetadata.set({ [ROOM_META_KEY]: { npcHealthMode: "barNumbers" } });
        await player.items.update(["npc"], ([t]) => {
            (t.metadata[META_KEY] as { currentHP: number }).currentHP = 6;
            t.position = { x: 50, y: 80 };
        });
        scene.setGrid({ dpi: 100 });
        await settle();
        const bars = (await player.localItems.get()).filter((i) => i.metadata[HEALTH_BAR_KEY]);
        expect(bars).toHaveLength(4);
        expect(textOf(bars)).toEqual(["6/30 (+3)"]);
        expect(bars[0].position.x).toBe(50);
        await player.items.update(["npc"], ([t]) => { t.visible = false; });
        await settle();
        expect(await player.localItems.get()).toHaveLength(1);
        await player.items.update(["npc"], ([t]) => { t.visible = true; });
        await settle();
        expect(await player.localItems.get()).toHaveLength(5);
        await player.roomMetadata.set({ [ROOM_META_KEY]: { npcHealthMode: "numbers" } });
        await settle();
        expect(await player.localItems.get()).toHaveLength(2);
        expect((await player.localItems.get()).filter(isPath)).toEqual([]);
        expect(textOf(await player.localItems.get())).toEqual(["6/30 (+3)"]);
        await player.roomMetadata.set({ [ROOM_META_KEY]: { displayHealthStatusToPlayer: false } });
        await settle();
        expect((await player.localItems.get()).map((i) => i.id)).toEqual(["other-extension"]);
        stop(); await settle();
        expect((await player.localItems.get()).map((i) => i.id)).toEqual(["other-extension"]);
    });

    it("removes orphaned overlays and settles overlapping syncs without duplicates", async () => {
        const scene = createFakeScene({ items: [token("npc")] });
        const port = scene.connect();
        const specs = desiredHealthBars(scene.peek().items, 150, "GM", DEFAULT_SETTINGS);
        await Promise.all([syncHealthBars(port, specs, factory), syncHealthBars(port, specs, factory)]);
        expect(await port.localItems.get()).toHaveLength(4);
        await port.items.delete(["npc"]);
        await syncHealthBars(port, [], factory);
        expect(await port.localItems.get()).toEqual([]);
    });

    it("handles an immediate tracker remount without deleting the replacement overlays", async () => {
        const scene = createFakeScene({ items: [token("npc")] });
        const port = scene.connect();
        const stopFirst = startHealthBarSync(port, factory);
        stopFirst();
        const stopSecond = startHealthBarSync(port, factory);
        await settle();
        expect(await port.localItems.get()).toHaveLength(4);
        stopSecond(); await settle();
        expect(await port.localItems.get()).toEqual([]);
    });
});
