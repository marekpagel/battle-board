import type { ObrPort } from "../obr/port";
import type { GridScale } from "./footprint";

/** Grid size and units needed by movement rings and elevation labels. */
export type GridSnapshot = GridScale & { unitLabel: string };

export async function readGrid(port: ObrPort): Promise<GridSnapshot> {
    const [dpi, scale] = await Promise.all([port.grid.getDpi(), port.grid.getScale()]);
    return { dpi, unitsPerCell: scale.multiplier, unitLabel: scale.unit };
}
