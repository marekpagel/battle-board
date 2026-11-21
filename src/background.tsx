import React from "react";
import ReactDOM from "react-dom/client";
import { useEffect, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { PluginGate } from "./PluginGate";
import { PluginThemeProvider } from "./PluginThemeProvider";
import { SceneRuntime } from "./SceneRuntime";

export function Background() {
    const [sceneReady, setSceneReady] = useState(false);
    useEffect(() => {
        let live = true;
        const update = (ready: boolean) => { if (live) setSceneReady(ready); };
        void OBR.scene.isReady().then(update).catch(console.error);
        const unsubscribe = OBR.scene.onReadyChange(update);
        return () => { live = false; unsubscribe(); };
    }, []);
    return sceneReady ? <SceneRuntime /> : null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><PluginGate><PluginThemeProvider><Background /></PluginThemeProvider></PluginGate></React.StrictMode>,
);
