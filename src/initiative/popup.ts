import OBR from "@owlbear-rodeo/sdk";
import { getPluginId } from "../getPluginId";
import type { InitiativePromptUI } from "./requests";

export const INITIATIVE_PROMPT_ID = getPluginId("initiative-prompt");
let operations = Promise.resolve();
const enqueue = (run: () => Promise<void>) => {
    const result = operations.then(run, run);
    operations = result.catch(console.error);
    return result;
};

export const initiativePromptUI: InitiativePromptUI = {
    open: (ids) => enqueue(async () => {
        const query = new URLSearchParams();
        ids.forEach((id) => query.append("token", id));
        await OBR.modal.close(INITIATIVE_PROMPT_ID);
        await OBR.modal.open({
            id: INITIATIVE_PROMPT_ID, url: `/initiative.html?${query}`,
            width: 340, height: Math.min(480, 88 + ids.length * 104),
        });
    }),
    close: () => enqueue(() => OBR.modal.close(INITIATIVE_PROMPT_ID)),
};
