import { useState } from "react";

import Layout from "./components/Layout/Layout.jsx";
import Header from "./components/Header/Header.jsx";
import AuthPanel from "./components/AuthPanel/AuthPanel.jsx";
import SettingsPanel from "./components/SettingsPanel/SettingsPanel.jsx";
import UsageStats from "./components/UsageStats/UsageStats.jsx";
import ChatWindow from "./components/ChatWindow/ChatWindow.jsx";
import ChatComposer from "./components/ChatComposer/ChatComposer.jsx";
import { useChat } from "./hooks/useChat.js";
import { useAuth } from "./context/AuthContext.jsx";
import env from "./config/env.js";

export default function App() {
  const { isAuthenticated } = useAuth();
  const { messages, sending, error, send, clear, dismissError } = useChat();

  const [settings, setSettings] = useState({
    model: env.defaultModel,
    temperature: env.defaultTemperature,
    system: "",
  });

  const handleSend = (text) =>
    send({
      text,
      model: settings.model,
      temperature: settings.temperature,
      system: settings.system,
    });

  const usage = messages.reduce(
    (acc, m) => {
      if (m.meta?.usage) {
        acc.prompt += m.meta.usage.prompt_tokens || 0;
        acc.completion += m.meta.usage.completion_tokens || 0;
        acc.total += m.meta.usage.total_tokens || 0;
      }
      return acc;
    },
    { prompt: 0, completion: 0, total: 0 },
  );

  const replies = messages.filter((m) => m.role === "assistant").length;

  return (
    <Layout
      header={<Header onClear={clear} hasMessages={messages.length > 0} />}
      sidebar={
        <>
          <AuthPanel />
          <SettingsPanel settings={settings} onChange={setSettings} />
          <UsageStats usage={usage} replies={replies} />
        </>
      }
    >
      <ChatWindow
        messages={messages}
        sending={sending}
        error={error}
        onDismissError={dismissError}
      />
      <ChatComposer
        onSend={handleSend}
        sending={sending}
        authenticated={isAuthenticated}
      />
    </Layout>
  );
}
