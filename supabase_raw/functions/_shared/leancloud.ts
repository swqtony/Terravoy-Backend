type ConversationAttrs = Record<string, unknown>;

function getEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`Missing env ${key}`);
  }
  return value;
}

export async function createLeanConversation(params: {
  members: string[];
  name?: string;
  attributes?: ConversationAttrs;
}): Promise<string> {
  const members = Array.from(new Set(params.members)).sort();
  const appId = getEnv("LEAN_APP_ID");
  const masterKey = getEnv("LEAN_MASTER_KEY");
  const server = Deno.env.get("LEAN_SERVER") ?? "https://api.leancloud.cn";
  const body = {
    m: members,
    name: params.name ?? "Match Chat",
    attr: params.attributes ?? {},
    tr: false,
    sys: false,
    // unique conversation by member set to avoid duplicates when functions race
    unique: true,
  };

  const resp = await fetch(`${server}/1.1/classes/_Conversation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LC-Id": appId,
      // Must use master key to create server-side conversations
      "X-LC-Key": `${masterKey},master`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LeanCloud conversation create failed: ${text}`);
  }

  const json = await resp.json();
  const convId = json.objectId as string | undefined;
  if (!convId) {
    throw new Error("LeanCloud response missing objectId");
  }
  return convId;
}
