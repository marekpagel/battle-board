import { useEffect, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { InitiativeHeader } from "./components/InitiativeHeader";
import { InitiativeTracker } from "./components/InitiativeTracker";

export function App() {
  const [sceneReady, setSceneReady] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) {
      void Promise.all([
        OBR.action.setTitle("Battle Board (Dev)"),
        OBR.action.setBadgeBackgroundColor("#b45309"),
        OBR.action.setBadgeText("DEV"),
      ]).catch(console.error);
    }
    OBR.scene.isReady().then(setSceneReady);
    return OBR.scene.onReadyChange(setSceneReady);
  }, []);

  if (sceneReady) {
    return <InitiativeTracker />;
  } else {
    // Show a basic header when the scene isn't ready
    return (
      <InitiativeHeader subtitle="Open a scene to use the initiative tracker" />
    );
  }
}

