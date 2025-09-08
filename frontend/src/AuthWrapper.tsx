import React, { useState } from "react";
import App from "./App";
import { AuthModal } from "./components/Modals";
import { getAccessToken, setAccessToken } from "./lib/api";

export default function AuthWrapper() {
  const [authorized, setAuthorized] = useState<boolean>(!!getAccessToken());

  if (!authorized) {
    return (
      <AuthModal
        onClose={() => alert("You must authenticate to use this app")}
        onSubmit={(token) => {
          setAccessToken(token);
          setAuthorized(true);
        }}
      />
    );
  } else {
    return <App />;
  }
}
