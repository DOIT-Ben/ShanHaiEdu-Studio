await import("dotenv/config");

const apiBase = (process.env.COZE_API_BASE || "https://api.coze.cn").replace(/\/$/, "");
const token = process.env.COZE_API_TOKEN?.trim();
const botId = process.env.COZE_PPT_BOT_ID?.trim();

if (!token || !botId) {
  console.log(JSON.stringify({ ok: false, stage: "env", tokenPresent: Boolean(token), botIdPresent: Boolean(botId) }, null, 2));
  process.exit(2);
}

function safePayload(value) {
  return {
    code: value?.code,
    msg: value?.msg || value?.message,
    hasData: Boolean(value?.data),
    dataKeys: value?.data && typeof value.data === "object" ? Object.keys(value.data) : [],
    status: value?.data?.status || value?.status,
  };
}

function readStringPath(value, pathSegments) {
  let cursor = value;
  for (const segment of pathSegments) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = cursor[segment];
  }
  return typeof cursor === "string" && cursor.trim() ? cursor : null;
}

function parseMaybeJsonContent(content) {
  if (typeof content !== "string") return { parseOk: false, contentLength: 0, hasPptxUrl: false };
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(jsonText);
    return {
      parseOk: true,
      contentLength: content.length,
      keys: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : [],
      hasPptxUrl: Boolean(parsed?.pptx_url || parsed?.pptxUrl || parsed?.download_url || parsed?.downloadUrl),
    };
  } catch {
    return { parseOk: false, contentLength: content.length, hasPptxUrl: /https?:\/\//.test(content) && /pptx/i.test(content) };
  }
}

try {
  const submitResponse = await fetch(`${apiBase}/v3/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      bot_id: botId,
      user_id: "shanhai-diagnostic",
      stream: false,
      auto_save_history: true,
      additional_messages: [
        {
          role: "user",
          type: "question",
          content_type: "text",
          content: "请只回复纯 JSON：{\"status\":\"completed\",\"pptx_url\":\"\",\"file_name\":\"diagnostic.pptx\"}。不要解释。",
        },
      ],
    }),
  });
  const submitText = await submitResponse.text();
  const submitted = JSON.parse(submitText);
  console.log(JSON.stringify({ ok: submitResponse.ok, stage: "submit", httpStatus: submitResponse.status, payload: safePayload(submitted) }, null, 2));
  if (!submitResponse.ok) process.exit(1);

  const conversationId = readStringPath(submitted, ["data", "conversation_id"]);
  const chatId = readStringPath(submitted, ["data", "id"]);
  if (!conversationId || !chatId) throw new Error("missing ids after submit");

  let finalStatus = "unknown";
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const retrieveResponse = await fetch(`${apiBase}/v3/chat/retrieve?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const retrieved = JSON.parse(await retrieveResponse.text());
    finalStatus = retrieved?.data?.status || retrieved?.status || "unknown";
    if (finalStatus === "completed" || finalStatus === "failed" || finalStatus === "canceled") {
      console.log(JSON.stringify({ ok: retrieveResponse.ok, stage: "retrieve", httpStatus: retrieveResponse.status, payload: safePayload(retrieved) }, null, 2));
      break;
    }
  }
  if (finalStatus !== "completed") process.exit(1);

  const messagesResponse = await fetch(`${apiBase}/v3/chat/message/list?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const messages = JSON.parse(await messagesResponse.text());
  const messageList = Array.isArray(messages?.data) ? messages.data : Array.isArray(messages?.data?.messages) ? messages.data.messages : [];
  const messageSummary = messageList.map((message) => ({
    role: message.role,
    type: message.type,
    content_type: message.content_type,
    content: parseMaybeJsonContent(message.content),
  }));
  console.log(JSON.stringify({ ok: messagesResponse.ok, stage: "messages", httpStatus: messagesResponse.status, count: messageList.length, messageSummary }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, stage: "exception", message: error instanceof Error ? error.message : "unknown" }, null, 2));
  process.exit(1);
}
