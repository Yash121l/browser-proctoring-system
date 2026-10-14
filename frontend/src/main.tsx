import React from "react";
import { createRoot } from "react-dom/client";
import "./analytics";
import App from "./App";
import "./ui/DesignSystem.css";

const el = document.getElementById("root")!;
createRoot(el).render(<App />);
