import { buildLabel, isImage, isLabel, type Item, type Vector2 } from "@owlbear-rodeo/sdk";
import { readMeta } from "../components/metadata";
import { footprintCells } from "../battlefield/footprint";
import { getPluginId } from "../getPluginId";
import type { ObrPort, Unsubscribe } from "../obr/port";

export const HEALTH_MARKER_KEY = getPluginId("health-marker");
const PREFIX = `${HEALTH_MARKER_KEY}.`;
export const healthMarkerId = (tokenId: string) => `${PREFIX}${tokenId}`;
export type HealthMarkerSpec = { id: string; tokenId: string; text: string; color: string; position: Vector2; visible: boolean };
export type HealthMarkerFactory = (spec: HealthMarkerSpec) => Item;

/** Mark tracked tokens at 0 HP, even after removal from initiative (their stats remain saved). */
export function desiredHealthMarkers(items: Item[], dpi: number): Map<string, HealthMarkerSpec> {
    const desired = new Map<string, HealthMarkerSpec>();
    for (const token of items) {
        if (!isImage(token) || (token.layer !== "CHARACTER" && token.layer !== "MOUNT")) continue;
        const meta = readMeta(token);
        if (!meta || meta.currentHP > 0) continue;
        const id = healthMarkerId(token.id);
        desired.set(id, {
            id, tokenId: token.id,
            text: meta.playerCharacter ? "💤" : "☠",
            color: meta.playerCharacter ? "#FCD34D" : "#FCA5A5",
            position: { x: token.position.x, y: token.position.y + footprintCells(token).h * dpi / 2 - 20 },
            visible: token.visible,
        });
    }
    return desired;
}

export const buildHealthMarker: HealthMarkerFactory = (spec) => buildLabel()
    .id(spec.id).name(spec.text).position(spec.position).plainText(spec.text)
    .fontSize(14).fontWeight(700).textAlign("CENTER").textAlignVertical("MIDDLE")
    .fillColor(spec.color).fillOpacity(1).backgroundColor("#1E2231").backgroundOpacity(0.85)
    .padding(2).cornerRadius(6).pointerHeight(0).pointerWidth(0)
    .attachedTo(spec.tokenId).disableAttachmentBehavior(["SCALE", "ROTATION", "COPY"])
    .layer("TEXT").locked(true).disableHit(true).visible(spec.visible)
    .metadata({ [HEALTH_MARKER_KEY]: { tokenId: spec.tokenId } }).build();

/** Reconcile only our markers. Deterministic ids make GM clients converge (ADR-0003). */
export async function syncHealthMarkers(port: ObrPort, items: Item[], dpi: number, build: HealthMarkerFactory = buildHealthMarker) {
    const desired = desiredHealthMarkers(items, dpi);
    const existing = new Set<string>();
    const remove: string[] = [];
    const update = new Map<string, HealthMarkerSpec>();
    for (const item of items) {
        if (!item.id.startsWith(PREFIX)) {
            if (item.metadata[HEALTH_MARKER_KEY]) remove.push(item.id);
            continue;
        }
        const spec = desired.get(item.id);
        if (!spec || !isLabel(item) || item.attachedTo !== spec.tokenId) {
            remove.push(item.id);
            continue;
        }
        existing.add(item.id);
        if (item.text.plainText !== spec.text || item.text.style.fontSize !== 14 || item.text.style.padding !== 2 || item.visible !== spec.visible ||
            item.position.x !== spec.position.x || item.position.y !== spec.position.y) update.set(item.id, spec);
    }
    if (remove.length) await port.items.delete(remove);
    if (update.size) await port.items.update([...update.keys()], (markers) => {
        for (const marker of markers) {
            if (!isLabel(marker)) continue;
            const spec = update.get(marker.id)!;
            marker.name = spec.text;
            marker.text.plainText = spec.text;
            marker.text.style.fillColor = spec.color;
            marker.text.style.fontSize = 14;
            marker.text.style.padding = 2;
            marker.position = spec.position;
            marker.visible = spec.visible;
        }
    });
    const add = [...desired.values()].filter((spec) => !existing.has(spec.id));
    if (add.length) await port.items.add(add.map(build));
}

/** Only GM clients write markers; coalesce changes arriving during a sync. */
export function startHealthMarkerSync(port: ObrPort, build: HealthMarkerFactory = buildHealthMarker): Unsubscribe {
    let stopped = false;
    let running = false;
    let pending = false;
    const run = async () => {
        pending = true;
        if (running || stopped) return;
        running = true;
        try {
            while (pending && !stopped) {
                pending = false;
                const [items, dpi] = await Promise.all([port.items.get(), port.grid.getDpi()]);
                if (!stopped) await syncHealthMarkers(port, items, dpi, build);
            }
        } catch (error) {
            console.error("[Battle Board] Health marker sync failed:", error);
        } finally {
            running = false;
        }
    };
    let stopItems: Unsubscribe = () => {};
    let stopGrid: Unsubscribe = () => {};
    (async () => {
        if ((await port.player.getRole()) !== "GM" || stopped) return;
        stopItems = port.items.onChange(() => void run());
        stopGrid = port.grid.onChange(() => void run());
        await run();
    })().catch(console.error);
    return () => { stopped = true; stopItems(); stopGrid(); };
}
