import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OBR from "@owlbear-rodeo/sdk";
import { flush } from "../obr/fakeScene";
import { startTurnBarPopover, TURN_BAR_POPOVER_ID } from "./popover";

beforeEach(() => {
    vi.spyOn(OBR.viewport, "getWidth").mockResolvedValue(1200);
    vi.spyOn(OBR.viewport, "getHeight").mockResolvedValue(900);
    vi.spyOn(OBR.popover, "open").mockResolvedValue(undefined);
    vi.spyOn(OBR.popover, "close").mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("persistent turn bar popup", () => {
    it("stays open on map clicks and closes when its scene runtime stops", async () => {
        const stop = startTurnBarPopover("bottom-left");
        await flush();
        expect(OBR.popover.open).toHaveBeenCalledWith(expect.objectContaining({
            id: TURN_BAR_POPOVER_ID, url: "/turnbar.html", disableClickAway: true,
            anchorPosition: { left: 72, top: 884 },
        }));
        expect(OBR.popover.close).not.toHaveBeenCalled();
        stop(); await flush();
        expect(OBR.popover.close).toHaveBeenCalledWith(TURN_BAR_POPOVER_ID);
    });

    it("waits for a late open before closing it and opening a replacement", async () => {
        let finishOpen: () => void = () => {};
        vi.mocked(OBR.popover.open).mockReturnValueOnce(new Promise((resolve) => { finishOpen = resolve; }));
        const stopFirst = startTurnBarPopover("bottom-left");
        await flush();
        stopFirst();
        const stopSecond = startTurnBarPopover("top-center");
        await flush();
        expect(OBR.popover.open).toHaveBeenCalledTimes(1);
        expect(OBR.popover.close).not.toHaveBeenCalled();
        finishOpen(); await flush();
        expect(OBR.popover.close).toHaveBeenCalledTimes(1);
        expect(OBR.popover.open).toHaveBeenCalledTimes(2);
        expect(OBR.popover.open).toHaveBeenLastCalledWith(expect.objectContaining({ anchorPosition: { left: 600, top: 16 } }));
        stopSecond(); await flush();
    });
});
