import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MultiplayerTest } from "./MultiplayerTest";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MultiplayerTest />
  </StrictMode>,
);
