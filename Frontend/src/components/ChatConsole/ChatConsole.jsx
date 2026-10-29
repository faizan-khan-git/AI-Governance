import { useState } from "react";

import Layout from "../Layout/Layout.jsx";
import Header from "../Header/Header.jsx";
import AuthPanel from "../AuthPanel/AuthPanel.jsx";
import SettingsPanel from "../SettingsPanel/SettingsPanel.jsx";
import UsageStats from "../UsageStats/UsageStats.jsx";
import ChatWindow from "../ChatWindow/ChatWindow.jsx";
import ChatComposer from "../ChatComposer/ChatComposer.jsx";
import { useChat } from "../../hooks/useChat.js";
import { useAuth } from "../../context/AuthContext.jsx";
import env from "../../config/env.js";

export default function ChatConsole() {
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

