import { describe, expect, it } from "vitest";
import { createFakeScene, flush } from "../obr/fakeScene";
import { createProfileStore } from "./store";
import { findProfile, profileKey, PROFILES_META_KEY, readProfiles } from "./profiles";

const goblin = { maxHP: 7, movement: 30, ac: 15, initiativeBonus: 2, playerCharacter: false };

describe("named profiles", () => {
    it("normalizes names and accepts only valid permanent stats", () => {
        expect(profileKey("  Goblin  ")).toBe("goblin");
        expect(readProfiles({ " Goblin ": { ...goblin, currentHP: 1, groupId: "g", initiative: 19 } })).toEqual({ goblin });
        expect(readProfiles({ a: { ...goblin, maxHP: -1 }, b: { ...goblin, ac: NaN }, c: { ...goblin, initiativeBonus: Infinity } })).toEqual({});
        expect(readProfiles(null)).toEqual({});
        expect(readProfiles([])).toEqual({});
        expect(findProfile({}, "constructor")).toBeUndefined();
    });

    it("saves profiles in room metadata, preserves other extensions, and reads them from a fresh client", async () => {
        const scene = createFakeScene({ roomMetadata: { "other.extension": { keep: true } } });
        const store = createProfileStore(scene.connect());
        await store.save("Goblin", { ...goblin, currentHP: 1 } as typeof goblin);
        expect(scene.peek().roomMetadata).toEqual({ "other.extension": { keep: true }, [PROFILES_META_KEY]: { goblin } });
        expect(await createProfileStore(scene.connect()).read()).toEqual({ goblin });
    });

    it("serializes saves, updates by name and forgets only the chosen profile", async () => {
        const scene = createFakeScene();
        const store = createProfileStore(scene.connect());
        await Promise.all([store.save("Goblin", goblin), store.save("Gundren", { ...goblin, playerCharacter: true })]);
        await store.save(" GOBLIN ", { ...goblin, maxHP: 12 });
        expect(Object.keys(await store.read()).sort()).toEqual(["goblin", "gundren"]);
        expect(findProfile(await store.read(), "Goblin")?.maxHP).toBe(12);
        await store.forget("GOBLIN");
        expect(Object.keys(await store.read())).toEqual(["gundren"]);
    });

    it("handles names that collide with object prototype properties", async () => {
        const store = createProfileStore(createFakeScene().connect());
        await store.save("__proto__", goblin);
        await store.save("constructor", goblin);
        const profiles = await store.read();
        expect(findProfile(profiles, "__proto__")).toEqual(goblin);
        expect(findProfile(profiles, "constructor")).toEqual(goblin);
        expect(Object.getPrototypeOf(profiles)).toBe(Object.prototype);
    });

    it("notifies subscribers about room updates, without needing token or scene writes", async () => {
        const scene = createFakeScene();
        const store = createProfileStore(scene.connect());
        const states: boolean[] = [];
        const stop = store.subscribe(() => states.push(store.getState().ready));
        await flush();
        await createProfileStore(scene.connect()).save("Goblin", goblin);
        await flush();
        expect(store.getState()).toEqual({ ready: true, profiles: { goblin } });
        expect(states.every(Boolean)).toBe(true);
        expect(scene.writes.every((w) => w.kind === "roomMetadata")).toBe(true);
        stop();
    });

    it("rejects invalid names, player writes and room storage overflow without losing saved data", async () => {
        const scene = createFakeScene({ roomMetadata: { [PROFILES_META_KEY]: { goblin }, other: "x".repeat(16384) } });
        const gm = createProfileStore(scene.connect("GM"));
        const player = createProfileStore(scene.connect("PLAYER"));
        await expect(gm.save(" ", goblin)).rejects.toThrow("name");
        await expect(gm.save("Bad", { ...goblin, maxHP: -1 })).rejects.toThrow("valid");
        await expect(player.save("Goblin", goblin)).rejects.toThrow("DM");
        await expect(player.forget("Goblin")).rejects.toThrow("DM");
        await expect(gm.save("Wolf", goblin)).rejects.toThrow("full");
        expect(scene.writes).toEqual([]);
        expect(await gm.read()).toEqual({ goblin });
    });
});

describe("profile storage import", () => {
    it("merges by normalized name and round-trips the saved JSON between rooms", async () => {
        const source = createProfileStore(createFakeScene().connect());
        await source.save("Goblin", goblin);
        const json = JSON.stringify(await source.read(), null, 2);
        const scene = createFakeScene({ roomMetadata: { other: { keep: 1 }, [PROFILES_META_KEY]: { wolf: { ...goblin, maxHP: 11 } } } });
        const target = createProfileStore(scene.connect());
        await target.importStorage(json);
        expect(await target.read()).toEqual({ wolf: { ...goblin, maxHP: 11 }, goblin });
        await target.importStorage(JSON.stringify({ " GOBLIN ": { ...goblin, maxHP: 20 } }));
        expect(await target.read()).toEqual({ wolf: { ...goblin, maxHP: 11 }, goblin: { ...goblin, maxHP: 20 } });
        expect(scene.peek().roomMetadata.other).toEqual({ keep: 1 });
        expect(scene.writes.every((w) => w.kind === "roomMetadata")).toBe(true);
    });

    it("replaces only the profile collection when explicitly selected, including an empty restore", async () => {
        const scene = createFakeScene({ roomMetadata: { other: "kept", [PROFILES_META_KEY]: { goblin } } });
        const store = createProfileStore(scene.connect());
        await store.importStorage(JSON.stringify({ wolf: { ...goblin, maxHP: 11 } }), "replace");
        expect(await store.read()).toEqual({ wolf: { ...goblin, maxHP: 11 } });
        await store.importStorage("{}", "replace");
        expect(await store.read()).toEqual({});
        expect(scene.peek().roomMetadata.other).toBe("kept");
    });

    it.each([
        "{broken json", "null", "[]", "42",
        JSON.stringify({ " ": goblin }),
        JSON.stringify({ good: goblin, bad: { ...goblin, maxHP: -1 } }),
        JSON.stringify({ Goblin: goblin, " GOBLIN ": goblin }),
        JSON.stringify({ bad: { ...goblin, playerCharacter: "false" } }),
        JSON.stringify({ bad: { ...goblin, movement: "30" } }),
    ])("rejects invalid imports in full without changing existing storage: %s", async (json) => {
        const scene = createFakeScene({ roomMetadata: { [PROFILES_META_KEY]: { goblin } } });
        const store = createProfileStore(scene.connect());
        await expect(store.importStorage(json, "replace")).rejects.toThrow();
        expect(await store.read()).toEqual({ goblin });
        expect(scene.writes).toEqual([]);
    });

    it("imports prototype-like names safely and strips fields outside the profile schema", async () => {
        const store = createProfileStore(createFakeScene().connect());
        const raw = Object.fromEntries([["__proto__", { ...goblin, currentHP: 1 }], ["constructor", goblin]]);
        await store.importStorage(JSON.stringify(raw));
        const profiles = await store.read();
        expect(findProfile(profiles, "__proto__")).toEqual(goblin);
        expect(findProfile(profiles, "constructor")).toEqual(goblin);
        expect(Object.getPrototypeOf(profiles)).toBe(Object.prototype);
    });

    it("keeps queued saves during a merge and rejects player imports and room overflow", async () => {
        const scene = createFakeScene();
        const port = scene.connect();
        const store = createProfileStore(port);
        await Promise.all([store.save("Wolf", goblin), store.importStorage(JSON.stringify({ goblin }))]);
        expect(Object.keys(await store.read()).sort()).toEqual(["goblin", "wolf"]);
        await expect(createProfileStore(scene.connect("PLAYER")).importStorage("{}", "replace")).rejects.toThrow("DM");
        await port.roomMetadata.set({ other: "x".repeat(16384) });
        const writes = scene.writes.length;
        await expect(store.importStorage(JSON.stringify({ orc: goblin }))).rejects.toThrow("full");
        expect(scene.writes.length).toBe(writes);
        expect(Object.keys(await store.read()).sort()).toEqual(["goblin", "wolf"]);
    });
});
