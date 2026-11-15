import { useSyncExternalStore } from "react";
import { obrAdapter } from "../obr/obrAdapter";
import { createProfileStore } from "./store";

export const profileStore = createProfileStore(obrAdapter);
export function useProfiles() {
    return useSyncExternalStore(profileStore.subscribe, profileStore.getState);
}
