import { buildPath, buildLabel, Command, isImage, isLabel, isPath, type Item, type PathCommand, type Vector2 } from "@owlbear-rodeo/sdk";
import { readMeta } from "../components/metadata";
import { footprintCells } from "../battlefield/footprint";
import { healthColor, playerHealthMode, showsBar, showsNumbers, status, statusColorKey } from "../encounter/health";
import { getPluginId } from "../getPluginId";
import { migrateSettings, ROOM_META_KEY, type HealthMode, type InitiativeSettings } from "../settings/settings";
import type { ObrPort, Role, Unsubscribe } from "../obr/port";

export const HEALTH_BAR_KEY = getPluginId("health-bar");
const PREFIX = `${HEALTH_BAR_KEY}.`;
export type HealthBarSpec = {
    id: string; tokenId: string; position: Vector2; width: number; height: number; dpi: number;
    mode: HealthMode; text: string; textColor: string; fraction: number | null; tempFraction: number;
};
export type HealthBarFactory = (spec: HealthBarSpec) => Item[];

export type HealthStatusColors = Record<ReturnType<typeof statusColorKey>, string>;
const DEFAULT_STATUS_COLORS: HealthStatusColors = { success: "#2e7d32", warning: "#ed6c02", error: "#d32f2f" };

/** Local projections never publish a GM's full HP display to other viewers. */
export function desiredHealthBars(items: Item[], dpi: number, role: Role, settings: InitiativeSettings, colors: HealthStatusColors = DEFAULT_STATUS_COLORS): HealthBarSpec[] {
    const specs: HealthBarSpec[] = [];
    for (const token of items) {
        if (!isImage(token) || (token.layer !== "CHARACTER" && token.layer !== "MOUNT")) continue;
        const meta = readMeta(token);
        if (!meta || (role !== "GM" && !token.visible)) continue;
        const mode = role === "GM" ? "barNumbers" : playerHealthMode(meta, settings);
        if (mode === "none") continue;
        const height = Math.round(Math.min(18, Math.max(8, dpi * 0.09)));
        const cells = footprintCells(token);
        specs.push({
            id: `${PREFIX}${token.id}`, tokenId: token.id, dpi, mode,
            width: Math.max(60, cells.w * dpi), height,
            position: { x: token.position.x, y: token.position.y + cells.h * dpi / 2 - height / 2 - 20 },
            // Status-only overlays carry neither HP numbers nor a fractional bar.
            text: mode === "status" ? status(meta) : showsNumbers(mode)
                ? `${meta.currentHP}/${meta.maxHP}${meta.tempHP > 0 ? ` (+${meta.tempHP})` : ""}` : "",
            textColor: mode === "status" ? colors[statusColorKey(status(meta))] : "#ffffff",
            fraction: showsBar(mode) && meta.maxHP > 0 ? clamp(meta.currentHP / meta.maxHP) : null,
            tempFraction: showsBar(mode) && meta.maxHP > 0 ? clamp(meta.tempHP / meta.maxHP) : 0,
        });
    }
    return specs;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Native scene geometry keeps the fill, empty track and text independent of image loading. */
function pill(width: number, height: number): PathCommand[] {
    const x = width / 2, y = height / 2, r = Math.min(x, y), arc = Math.SQRT1_2;
    return [
        [Command.MOVE, -x + r, -y], [Command.LINE, x - r, -y],
        [Command.CONIC, x, -y, x, -y + r, arc], [Command.LINE, x, y - r],
        [Command.CONIC, x, y, x - r, y, arc], [Command.LINE, -x + r, y],
        [Command.CONIC, -x, y, -x, y - r, arc], [Command.LINE, -x, -y + r],
        [Command.CONIC, -x, -y, -x + r, -y, arc], [Command.CLOSE],
    ];
}

export const buildHealthBar: HealthBarFactory = (spec) => {
    const items: Item[] = [];
    const decorate = (source: Item, part: string, zIndex: number) => {
        const item: Item = { ...source, id: `${spec.id}.${part}` };
        item.name = "Health overlay";
        item.attachedTo = spec.tokenId;
        item.disableAttachmentBehavior = ["SCALE", "ROTATION", "VISIBLE", "COPY"];
        item.locked = true;
        item.disableHit = true;
        item.disableAutoZIndex = true;
        item.visible = true;
        item.layer = "TEXT";
        item.zIndex = zIndex;
        item.metadata = { [HEALTH_BAR_KEY]: JSON.stringify(["native-v4", spec, part]) };
        items.push(item);
    };
    const bar = (part: string, width: number, height: number, color: string, position: Vector2, zIndex: number) => {
        decorate(buildPath().commands(pill(width, height)).position(position)
            .fillColor(color).fillOpacity(1).strokeOpacity(0).strokeWidth(0).build(), part, zIndex);
    };
    if (showsBar(spec.mode)) bar("track", spec.width, spec.height, "#55555d", spec.position, 1000);
    if (spec.fraction !== null && spec.fraction > 0) {
        const width = spec.width * spec.fraction;
        bar("fill", width, spec.height, healthColor(spec.fraction), {
            x: spec.position.x - (spec.width - width) / 2, y: spec.position.y,
        }, 1001);
    }
    if (spec.tempFraction > 0) {
        const width = spec.width * spec.tempFraction, height = Math.max(2, spec.height * 0.15);
        bar("temp", width, height, "#60bafc", {
            x: spec.position.x - (spec.width - width) / 2,
            y: spec.position.y - (spec.height - height) / 2,
        }, 1002);
    }
    if (spec.text) {
        const fontSize = Math.min(spec.height * 0.95, spec.width / spec.text.length * 1.5);
        decorate(buildLabel().plainText(spec.text).width(spec.width).height(spec.height)
            .fontSize(fontSize).fontFamily("Arial").fontWeight(700).lineHeight(1).padding(0)
            .textAlign("CENTER").textAlignVertical("MIDDLE").fillColor(spec.textColor).fillOpacity(1)
            .strokeColor("#111318").strokeOpacity(1).strokeWidth(Math.max(1, fontSize * 0.12))
            // A view-scale factor of 1 disables screen-space zoom compensation.
            .minViewScale(1).maxViewScale(1)
            .backgroundOpacity(0).pointerWidth(0).pointerHeight(0).position(spec.position).build(), "text", 1003);
    }
    return items;
};

// A remounted tracker must wait for its predecessor's in-flight local writes.
const queues = new WeakMap<ObrPort, Promise<void>>();
const owners = new WeakMap<ObrPort, symbol>();
export function syncHealthBars(port: ObrPort, specs: HealthBarSpec[], build: HealthBarFactory = buildHealthBar): Promise<void> {
    const run = (queues.get(port) ?? Promise.resolve()).then(() => reconcileHealthBars(port, specs, build));
    queues.set(port, run.catch(() => {}));
    return run;
}

async function reconcileHealthBars(port: ObrPort, specs: HealthBarSpec[], build: HealthBarFactory) {
    const wanted = new Map(specs.flatMap(build).map((item) => [item.id, item]));
    const local = (await port.localItems.get()).filter((i) => i.id.startsWith(PREFIX));
    const existing = new Map(local.map((i) => [i.id, i]));
    const remove = local.filter((i) => !wanted.has(i.id) || wanted.get(i.id)!.type !== i.type).map((i) => i.id);
    const removed = new Set(remove);
    const changed = [...wanted.values()].filter((i) => existing.has(i.id) && !removed.has(i.id) &&
        existing.get(i.id)!.metadata[HEALTH_BAR_KEY] !== i.metadata[HEALTH_BAR_KEY]);
    if (remove.length) await port.localItems.delete(remove);
    if (changed.length) {
        const replacements = new Map(changed.map((i) => [i.id, i]));
        await port.localItems.update([...replacements.keys()], (items) => {
            for (const item of items) {
                const next = replacements.get(item.id)!;
                item.position = next.position;
                item.metadata = next.metadata;
                item.name = next.name;
                item.zIndex = next.zIndex;
                if (isPath(item) && isPath(next)) {
                    item.commands = next.commands;
                    item.style = next.style;
                } else if (isLabel(item) && isLabel(next)) {
                    item.text = next.text;
                    item.style = next.style;
                }
            }
        });
    }
    const add = [...wanted.values()].filter((i) => !existing.has(i.id) || removed.has(i.id));
    if (add.length) await port.localItems.add(add);
}

/** Each viewer writes only their local overlays, including on role-specific setting changes. */
export function startHealthBarSync(port: ObrPort, build: HealthBarFactory = buildHealthBar, colors: HealthStatusColors = DEFAULT_STATUS_COLORS): Unsubscribe {
    const owner = Symbol("health-bars");
    owners.set(port, owner);
    let stopped = false;
    let pending = false;
    let running: Promise<void> | null = null;
    const unsubscribes: Unsubscribe[] = [];
    const run = () => {
        pending = true;
        if (running || stopped) return;
        running = (async () => {
            while (pending && !stopped) {
                pending = false;
                const [items, dpi, role, room] = await Promise.all([
                    port.items.get(), port.grid.getDpi(), port.player.getRole(), port.roomMetadata.get(),
                ]);
                if (!stopped) await syncHealthBars(port, desiredHealthBars(items, dpi, role, migrateSettings(room[ROOM_META_KEY]), colors), build);
            }
        })().catch((error) => console.error("[Battle Board] Health bar sync failed:", error))
            .finally(() => { running = null; if (pending && !stopped) run(); });
    };
    unsubscribes.push(port.items.onChange(run), port.grid.onChange(run), port.roomMetadata.onChange(run));
    run();
    return () => {
        stopped = true;
        unsubscribes.forEach((u) => u());
        void (async () => {
            await running;
            if (owners.get(port) !== owner) return;
            await syncHealthBars(port, [], build);
            if (owners.get(port) === owner) owners.delete(port);
        })().catch(console.error);
    };
}
