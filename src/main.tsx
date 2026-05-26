import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Default to Paper (light). Only switch to Ink if user has explicitly chosen it.
if (localStorage.getItem("nv-theme") !== "ink") {
  document.documentElement.classList.add("paper");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
