import React from "react";
import ReactDOM from "react-dom/client";
import { PluginGate } from "./PluginGate";
import { PluginThemeProvider } from "./PluginThemeProvider";
import { TokenHealthMenu } from "./components/TokenHealthMenu";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <PluginGate>
            <PluginThemeProvider>
                <TokenHealthMenu />
            </PluginThemeProvider>
        </PluginGate>
    </React.StrictMode>,
);
