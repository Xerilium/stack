import { putAsk } from "../../src/core/asks";
import { NOW, setup } from "./helpers";

// Security follow-up: an agent token must not rewrite a permission prompt, so the owner never approves a misdescribed tool call.
// @req FR:agent-sessions/perm.ask
describe("perm-* asks are reserved for the broker", () => {
  const PERM = {
    ask: "Allow Bash: rm -rf ~",
    kind: "decide",
    options: ["Allow once", "Deny"],
    recommend: "Deny",
    priority: "high",
    reversible: true,
  } as never;
  async function mk() {
    const s = setup();
    const made = await s.call("POST", "/api/auth/tokens", {
      session: true,
      body: { name: "agent", scopes: ["tasks:read", "tasks:write"], days: 30 },
    });
    return { ...s, h: { authorization: `Bearer ${made.json.token}` } };
  }

  it("a token cannot rewrite an existing permission ask", async () => {
    const s = await mk();
    await putAsk(
      { storage: s.storage, now: () => NOW },
      "perm-abcd1234-0001",
      PERM,
      "stack",
    );
    const r = await s.call("POST", "/api/asks/perm-abcd1234-0001", {
      headers: s.h,
      body: { ask: "Allow Read: README.md", recommend: "Allow once" },
    });
    expect(r.status).toBe(403);
    expect(
      (await s.storage.read("tasks/asks/perm-abcd1234-0001.md")).content,
    ).toContain("rm -rf");
  });

  it("a token cannot create a perm-* ask", async () => {
    const s = await mk();
    const r = await s.call("POST", "/api/asks/perm-abcd1234-0002", {
      headers: s.h,
      body: { ask: "Allow?", kind: "decide", options: ["Allow once", "Deny"] },
    });
    expect(r.status).toBe(403);
    expect(await s.storage.listAsks()).toEqual([]);
  });

  it("a token can still write its own asks", async () => {
    const s = await mk();
    const r = await s.call("POST", "/api/asks/agent-q1", {
      headers: s.h,
      body: { ask: "Ship it?", kind: "approve" },
    });
    expect(r.status).toBe(200);
  });
});
