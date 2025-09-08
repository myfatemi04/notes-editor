import React from "react";
import { createRoot } from "react-dom/client";
import AuthWrapper from "./AuthWrapper";
import "./index.css";
import "katex/dist/katex.min.css";

createRoot(document.getElementById("root")!).render(<AuthWrapper />);
