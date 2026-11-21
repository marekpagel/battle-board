import OBR, { type Popover } from "@owlbear-rodeo/sdk";
import { getPluginId } from "../getPluginId";
import type { TurnBarPosition } from "./preferences";

export const TURN_BAR_POPOVER_ID = getPluginId("turn-bar");

async function placement(position: TurnBarPosition): Promise<Pick<Popover, "anchorPosition" | "transformOrigin">> {
    const [width, height] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
    switch (position) {
        case "top-center":
            return { anchorPosition: { left: width / 2, top: 16 }, transformOrigin: { horizontal: "CENTER", vertical: "TOP" } };
        case "bottom-right":
            return { anchorPosition: { left: width - 72, top: height - 16 }, transformOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" } };
        case "bottom-center":
            return { anchorPosition: { left: width / 2, top: height - 16 }, transformOrigin: { horizontal: "CENTER", vertical: "BOTTOM" } };
        default:
            return { anchorPosition: { left: 72, top: height - 16 }, transformOrigin: { horizontal: "LEFT", vertical: "BOTTOM" } };
    }
}

let operations = Promise.resolve();
function enqueue(operation: () => Promise<void>) {
    operations = operations.then(operation).catch(console.error);
}

/** A late open must finish before cleanup closes it or a replacement opens. */
export function startTurnBarPopover(position: TurnBarPosition): () => void {
    let stopped = false;
    enqueue(async () => {
        const place = await placement(position);
        if (stopped) return;
        await OBR.popover.open({
            id: TURN_BAR_POPOVER_ID, url: "/turnbar.html", width: 460, height: 56,
            anchorReference: "POSITION", disableClickAway: true, ...place,
        });
    });
    return () => {
        stopped = true;
        enqueue(() => OBR.popover.close(TURN_BAR_POPOVER_ID));
    };
}
