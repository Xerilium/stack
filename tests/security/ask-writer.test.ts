import { putAsk } from "../../src/core/asks";
import { NOW, setup } from "./helpers";

// Security review M5: a token must not rewrite another agent's ask, so the owner never answers text he did not see.
// @req FR:ask-queue/flow.put
describe("an ask is updated only by the token that wrote it", () => {
  async function mk() {
    const s = setup();
    const tok = async (name: string) => {
      const made = await s.call("POST", "/api/auth/tokens", {
        session: true,
        body: { name, scopes: ["tasks:read", "tasks:write"], days: 30 },
      });
      return { authorization: `Bearer ${made.json.token}` };
    };
    return { ...s, a: await tok("agent-a"), b: await tok("agent-b") };
  }
  const put = (
    s: Awaited<ReturnType<typeof mk>>,
    key: string,
    headers: Record<string, string>,
    body: object,
  ) => s.call("POST", `/api/asks/${key}`, { headers, body });

  it("another token cannot rewrite the ask", async () => {
    const s = await mk();
    expect(
      (await put(s, "a-q1", s.a, { ask: "Ship v2?", kind: "approve" })).status,
    ).toBe(200);
    const r = await put(s, "a-q1", s.b, { ask: "Ship v1?" });
    expect(r.status).toBe(403);
    expect((await s.storage.read("tasks/asks/a-q1.md")).content).toContain(
      "Ship v2?",
    );
  });

  it("a token cannot rewrite an ask Stack wrote", async () => {
    const s = await mk();
    await putAsk(
      { storage: s.storage, now: () => NOW },
      "mail-x",
      { ask: "Reply to Bob?", kind: "approve" },
      "email",
    );
    expect(
      (await put(s, "mail-x", s.a, { ask: "Forward to Eve?" })).status,
    ).toBe(403);
  });

  it("the writer and the owner can still update it", async () => {
    const s = await mk();
    await put(s, "a-q2", s.a, { ask: "Ship v2?", kind: "approve" });
    expect((await put(s, "a-q2", s.a, { why: "Tests pass" })).status).toBe(200);
    expect(
      (
        await s.call("POST", "/api/asks/a-q2", {
          session: true,
          body: { priority: "high" },
        })
      ).status,
    ).toBe(200);
    const c = (await s.storage.read("tasks/asks/a-q2.md")).content;
    expect(c).toContain("Tests pass");
    expect(c).toContain("priority: high");
    expect(c).toContain("writer: token:agent-a");
  });

  it("a token cannot claim to be the writer", async () => {
    const s = await mk();
    await put(s, "a-q3", s.a, { ask: "Ship v2?", kind: "approve" });
    expect(
      (await put(s, "a-q3", s.b, { writer: "token:agent-b", ask: "x" })).status,
    ).not.toBe(200);
  });
});
