import { useState } from "react";
import { encounterStore, type Combatant, type CombatantPatch } from "../encounter";

/** Which HP/AC cell is being edited, plus commit handlers that apply the Health rules. */
export function useHPEditing(
    row: Combatant,
    onChange: (patch: CombatantPatch) => void
) {
    const [editingField, setEditingField] = useState<null | "cur" | "max" | "temp" | "ac">(null);

    const apply = (command: Promise<void>) => {
        command.catch(console.error);
        setEditingField(null);
    };

    const commitAc = (v: number) => {
        onChange({ ac: Math.max(0, v) });
        setEditingField(null);
    };

    return {
        editingField,
        setEditingField,
        commitAc,
        commitCurrentHP: (value: number) => apply(encounterStore.setHP(row.id, value)),
        commitTempHP: (value: number) => apply(encounterStore.setHP(row.id, value, "temp")),
        applyMaxChange: (value: number) => apply(encounterStore.setHP(row.id, value, "max")),
    };
}
