// src/tokens.ts
import OBR, { isImage, type Item } from "@owlbear-rodeo/sdk";

/** A CHARACTER/MOUNT token used by the tracker and viewport focus. */
export type CMToken = {
    id: string;
    name: string;
    center: { x: number; y: number };
    layer: "CHARACTER" | "MOUNT";
    attachedTo?: string | null;
    visible?: boolean;
};

export function toCMToken(it: Item): CMToken | null {
    if (!isImage(it) || (it.layer !== "CHARACTER" && it.layer !== "MOUNT")) return null;
    return {
        id: it.id,
        name: it.text?.plainText || it.name || "Unnamed",
        layer: it.layer,
        center: { x: it.position?.x ?? 0, y: it.position?.y ?? 0 },
        attachedTo: it.attachedTo ?? null,
        visible: it.visible,
    };
}

const signature = (t: CMToken) => `${t.id}:${t.name}:${t.center.x},${t.center.y}:${t.visible}`;

/**
 * Subscribe to CHARACTER/MOUNT tokens. Calls `cb` with every token whenever
 * one moves, is renamed, or is hidden/shown.
 */
export function onCMTokensChange(cb: (tokens: CMToken[]) => void) {
    let live = true;
    let last = "";

    const emit = (items: Item[]) => {
        if (!live) return;
        const tokens = items.map(toCMToken).filter((t): t is CMToken => !!t);
        const sig = tokens.map(signature).join("|");
        if (sig === last) return;
        last = sig;
        cb(tokens);
    };

    OBR.scene.items.getItems().then(emit).catch(console.error);
    const unsubscribe = OBR.scene.items.onChange(emit);

    return () => {
        live = false;
        unsubscribe();
    };
}
