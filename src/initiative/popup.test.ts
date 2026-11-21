import { afterEach, expect, it, vi } from "vitest";
import OBR from "@owlbear-rodeo/sdk";
import { initiativePromptUI, INITIATIVE_PROMPT_ID } from "./popup";

afterEach(() => vi.restoreAllMocks());

it("opens a compact prompt with encoded, pinned token ids and closes it by id", async () => {
    const open = vi.spyOn(OBR.modal, "open").mockResolvedValue(undefined);
    const close = vi.spyOn(OBR.modal, "close").mockResolvedValue(undefined);
    await initiativePromptUI.open(["pc & one"]);
    expect(open).toHaveBeenCalledWith({ id: INITIATIVE_PROMPT_ID, url: "/initiative.html?token=pc+%26+one", width: 340, height: 192 });
    await initiativePromptUI.close();
    expect(close).toHaveBeenLastCalledWith(INITIATIVE_PROMPT_ID);
});
