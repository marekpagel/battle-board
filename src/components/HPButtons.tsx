import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import { encounterStore } from "../encounter";

export function HPButtons({ id, temporary = false }: { id: string; temporary?: boolean }) {
    return <Stack direction="row" justifyContent="center" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {[-5, -1, 1, 5].map((delta) => (
            <Button key={delta} size="small" variant="text"
                aria-label={`${delta < 0 ? "Decrease" : "Increase"} ${temporary ? "temporary HP" : "HP"} by ${Math.abs(delta)}`}
                onClick={() => encounterStore.adjustHP(id, delta, temporary ? "temp" : "current").catch(console.error)}
                sx={{ minWidth: 22, p: 0, border: 0, borderRadius: 0, fontSize: "0.7rem", lineHeight: 1.5, color: "text.secondary" }}>
                {delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}
            </Button>
        ))}
    </Stack>;
}
