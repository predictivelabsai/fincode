import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./RoutedApp";
import StandaloneAuthentication from "./clerk-auth";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

root.render(
  <StrictMode>
    <BrowserRouter>
      <StandaloneAuthentication>
        <App />
      </StandaloneAuthentication>
    </BrowserRouter>
  </StrictMode>,
);
