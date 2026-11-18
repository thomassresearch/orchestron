import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useAppStore } from "../../src/store/useAppStore";
import App from "../../src/App";
import "../../src/index.css";

Object.assign(window, { __workspaceTest: { store: useAppStore } });
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
