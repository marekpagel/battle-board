import React from "react";
import ReactDOM from "react-dom/client";
import { PluginGate } from "./PluginGate";
import { PluginThemeProvider } from "./PluginThemeProvider";
import { InitiativePrompt } from "./initiative/InitiativePrompt";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><PluginGate><PluginThemeProvider><InitiativePrompt /></PluginThemeProvider></PluginGate></React.StrictMode>,
);
