import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import type { Combatant, CombatantPatch } from "../encounter";
import PlayerRow from "./PlayerRow";
import { playerCanEditHP, showPlayerHealthColumn } from "../encounter/health";
import type { CMToken } from "./tokens";
import type { InitiativeSettings } from "../settings";

type PlayerTableProps = {
    items: Combatant[];
    started: boolean;
    settings: InitiativeSettings;
    tokens: CMToken[];
    updateRow?: (id: string, patch: CombatantPatch) => void;
};

export default function PlayerTable({
    items,
    started,
    settings,
    tokens,
    updateRow
}: PlayerTableProps) {
    const showHealthColumn = showPlayerHealthColumn(settings);
    const showTempColumn = showHealthColumn && items.some((item) => playerCanEditHP(item, settings));
    return (
        <TableContainer
            component={Paper}
            sx={{
                flex: 1,
                minHeight: 166,
                borderRadius: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
            }}
        >
            <Table
                stickyHeader
                size="small"
                aria-label="initiative table"
                sx={{
                    tableLayout: "fixed",
                    width: "100%",
                    "& td, & th": { py: 0.25, px: 0.25 },
                    "& thead th": { fontSize: "0.72rem", letterSpacing: 0.4, py: 0.9, height: 28 },
                }}
            >
                <TableHead>
                    <TableRow>
                        <TableCell width={40} align="center">INIT</TableCell>
                        <TableCell width={60} align="center"></TableCell>
                        <TableCell align="center">NAME</TableCell>
                        {showHealthColumn && <TableCell width={62} align="center">HEALTH</TableCell>}
                        {showTempColumn && <TableCell width={36} align="center">TEMP</TableCell>}
                    </TableRow>
                </TableHead>

                <TableBody>
                    {items.map((item) => (
                        <PlayerRow
                            key={item.id}
                            row={item}
                            started={started}
                            settings={settings}
                            tokens={tokens}
                            showHealthColumn={showHealthColumn}
                            showTempColumn={showTempColumn}
                            updateRow={updateRow}
                        />
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
}
