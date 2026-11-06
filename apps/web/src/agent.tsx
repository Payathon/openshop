import { useEffect, useRef, useState } from "react";
import { message, post } from "./api.ts";
import { useStudio, type Change } from "./studio.tsx";
import { Card } from "./ui.tsx";

// The AI assistant on 店铺装修 (product-decisions #15). It edits through the same pending
// changes as the forms beside it, so the preview refreshes and every change can be undone.
// The conversation lives in this component only; leaving the page starts a new one.

interface Turn {
  role: "user" | "assistant";
  content: string;
  changes?: Change[];
  failed?: boolean;
}

const EXAMPLES = ["主色换成酒红色，字体用宋体", "首页最上面加一个横幅：周末全场 8 折", "把相册删掉，加一段“关于我们”"];

export function AgentCard() {
  const { overview, refresh, undo } = useStudio();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => list.current?.scrollTo({ top: list.current.scrollHeight }), [turns, busy]);

  const pending = new Set(overview?.changes.map((c) => c.id));

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setDraft("");
    setBusy(true);
    try {
      // Failed replies are only shown, never sent back as part of the conversation.
      const messages = next.filter((t) => !t.failed).map(({ role, content }) => ({ role, content }));
      const r = await post<{ reply: string; changes: Change[] }>("/api/merchant/agent/chat", { messages });
      setTurns((t) => [...t, { role: "assistant", content: r.reply, changes: r.changes }]);
      if (r.changes.length) await refresh();
    } catch (e) {
      setTurns((t) => [...t, { role: "assistant", content: message(e), failed: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="AI 助手" action={<span className="subtle">说一句话改店铺，改动发布后生效</span>}>
      <div className="agent-log" ref={list}>
        {turns.length === 0 && (
          <div className="stack">
            <span className="subtle">比如：</span>
            {EXAMPLES.map((e) => (
              <button key={e} className="btn plain agent-example" onClick={() => void send(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`agent-msg ${t.role}${t.failed ? " failed" : ""}`}>
            <div className="agent-bubble">{t.content}</div>
            {!!t.changes?.length && (
              <ul className="agent-changes">
                {t.changes.map((c) => (
                  <li key={c.id} className={pending.has(c.id) ? "" : "undone"}>
                    <span>{c.summary}</span>
                    {pending.has(c.id) ? (
                      <button className="btn plain" onClick={() => void undo(c.id)}>
                        撤销
                      </button>
                    ) : (
                      <span className="subtle">已撤销或已发布</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <div className="agent-msg assistant"><div className="agent-bubble subtle">正在修改…</div></div>}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          className="textarea agent-input"
          rows={2}
          maxLength={4000}
          placeholder="想怎么改？回车发送，Shift+回车换行"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        <button className="btn primary" disabled={busy || !draft.trim()}>
          发送
        </button>
      </form>
    </Card>
  );
}
