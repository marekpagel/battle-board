import type { ObrPort, Unsubscribe } from "../obr/port";
import { parseProfileStorage, profileKey, profileOf, PROFILES_META_KEY, readProfiles, type CharacterProfile, type CharacterProfiles } from "./profiles";

// Encounter commands and profile settings create separate stores for the same client.
// Serialize their read-modify-write operations together to preserve every edit.
const writeQueues = new WeakMap<ObrPort, Promise<void>>();

export function createProfileStore(port: ObrPort) {
    let state: { ready: boolean; profiles: CharacterProfiles } = { ready: false, profiles: {} };
    const listeners = new Set<() => void>();
    let unsubscribe: Unsubscribe | null = null;
    const apply = (room: Record<string, unknown>) => {
        state = { ready: true, profiles: readProfiles(room[PROFILES_META_KEY]) };
        listeners.forEach((l) => l());
    };
    const write = (edit: (profiles: CharacterProfiles) => CharacterProfiles) => {
        const run = (writeQueues.get(port) ?? Promise.resolve()).then(async () => {
            if (await port.player.getRole() !== "GM") throw new Error("Only the DM can change saved profiles.");
            const room = await port.roomMetadata.get();
            const next = edit(readProfiles(room[PROFILES_META_KEY]));
            if (new TextEncoder().encode(JSON.stringify({ ...room, [PROFILES_META_KEY]: next })).length >= 16384) {
                throw new Error("The room's saved data is full. Forget an unused profile before saving another.");
            }
            await port.roomMetadata.set({ [PROFILES_META_KEY]: next });
        });
        writeQueues.set(port, run.catch(() => {}));
        return run;
    };
    return {
        getState: () => state,
        subscribe(listener: () => void): Unsubscribe {
            listeners.add(listener);
            if (!unsubscribe) {
                unsubscribe = port.roomMetadata.onChange(apply);
                port.roomMetadata.get().then(apply).catch(console.error);
            }
            return () => {
                listeners.delete(listener);
                if (!listeners.size) { unsubscribe?.(); unsubscribe = null; }
            };
        },
        async read() { return readProfiles((await port.roomMetadata.get())[PROFILES_META_KEY]); },
        save(name: string, stats: CharacterProfile) {
            const key = profileKey(name);
            if (!key) return Promise.reject(new Error("Give the token a name before saving a profile."));
            const profile = profileOf(stats);
            if (!Object.hasOwn(readProfiles({ [key]: profile }), key)) return Promise.reject(new Error("The profile's stats must be valid numbers."));
            return write((profiles) => ({ ...profiles, [key]: profile }));
        },
        async importStorage(text: string, mode: "merge" | "replace" = "merge") {
            const imported = parseProfileStorage(text);
            await write((profiles) => mode === "replace" ? imported : { ...profiles, ...imported });
        },
        forget(name: string) {
            return write((profiles) => Object.fromEntries(Object.entries(profiles).filter(([key]) => key !== profileKey(name))));
        },
    };
}
