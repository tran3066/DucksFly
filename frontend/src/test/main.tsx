import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TestClient } from "./TestClient";
import "./test.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TestClient />
  </StrictMode>,
);
