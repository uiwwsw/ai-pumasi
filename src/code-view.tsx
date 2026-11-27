// Code mode: a coding agent working in one folder. It looks around and reads on its own;
// every file change and command waits for the user's answer in the transcript.
import { Markdown } from "./markdown";
import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  GitCompare,
  PanelRight,
  Search,
  Square,
  SquareTerminal,
  Users,
  X,
} from "lucide-react";
import { t } from "./i18n";
import { diffLines } from "./code";
import type { AgentEvent, CodeEntry, CodeFolder } from "./routing";

type Item =
  | { kind: "user"; text: string }
  | { kind: "say"; text: string }
  | { kind: "tool"; id: number; tool: "list" | "read" | "search"; label: string; path?: string }
  | { kind: "error"; text: string }
  | {
      kind: "edit";
      id: number;
      path: string;
      before: string;
      after: string;
      state: "ask" | "saved" | "declined" | "undone";
    }
  | {
      kind: "run";
      id: number;
      command: string;
      state: "ask" | "running" | "done" | "declined";
      code?: number | null;
      output?: string;
    }
  | { kind: "note"; text: string };

const fmt = (n: number) => n.toLocaleString();

function Diff({ before, after }: { before: string; after: string }) {
  const d = diffLines(before, after);
  // Long unchanged stretches fold to one line, like a review tool.
  const rows: React.ReactNode[] = [];
  let run: string[] = [];
  const flush = (key: string) => {
    if (run.length > 6) {
      rows.push(
        <div className="diff-row same" key={`${key}-a`}>
          <span>{" "}</span>
          {run[0]}
        </div>,
        <div className="diff-fold" key={`${key}-f`}>
          {t("변경 없는 {count}줄", { count: run.length - 2 })}
        </div>,
        <div className="diff-row same" key={`${key}-b`}>
          <span>{" "}</span>
          {run[run.length - 1]}
        </div>,
      );
    } else
      run.forEach((text, i) =>
        rows.push(
          <div className="diff-row same" key={`${key}-${i}`}>
            <span>{" "}</span>
            {text}
          </div>,
        ),
      );
    run = [];
  };
  d.lines.forEach((l, i) => {
    if (l.kind === "same") return void run.push(l.text);
    flush(`s${i}`);
    rows.push(
      <div className={`diff-row ${l.kind}`} key={i}>
        <span>{l.kind === "add" ? "+" : "−"}</span>
        {l.text}
      </div>,
    );
  });
  flush("end");
  return <div className="diff">{rows}</div>;
}

function counts(before: string, after: string) {
  const d = diffLines(before, after);
  return { added: d.added, removed: d.removed };
}

export function CodeWorkspace() {
  const code = typeof window === "undefined" ? undefined : window.auroraAI?.code;
  const [folder, setFolder] = useState<CodeFolder | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [panel, setPanel] = useState(false);
  const [tree, setTree] = useState<Record<string, CodeEntry[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ path: string; text: string } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const said = useRef<string[]>([]);
  // The agent's reply while it is being written; replaced by the finished text.
  const [draftReply, setDraftReply] = useState("");
  const [undoError, setUndoError] = useState("");
  // Panel view: the file tree, or what git sees as changed.
  const [panelView, setPanelView] = useState<"files" | "changes">("files");
  const [changes, setChanges] = useState<{ state: string; path: string }[] | null>(null);
  const [diffText, setDiffText] = useState<{ path: string; text: string } | null>(null);

  useEffect(() => {
    void code?.current().then(setFolder);
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [items, busy]);
  useEffect(() => {
    if (!code) return;
    return code.onEvent((e: AgentEvent) => {
      if (e.type === "thinking") {
        setStep(e.step);
        setDraftReply("");
      } else if (e.type === "draft") setDraftReply(e.text);
      else if (e.type === "say") {
        setDraftReply("");
        said.current.push(e.text);
        setItems((x) => [...x, { kind: "say", text: e.text }]);
      } else if (e.type === "tool") {
        const label =
          e.kind === "read"
            ? t("{path} 읽음 · {lines}줄", { path: e.path ?? "", lines: e.lines ?? 0 })
            : e.kind === "list"
              ? t("{path} 목록 · {count}개", {
                  path: !e.path || e.path === "." ? "./" : `${e.path}/`,
                  count: e.count ?? 0,
                })
              : t("\"{query}\" 검색 · {count}곳", { query: e.query ?? "", count: e.count ?? 0 });
        setItems((x) => [...x, { kind: "tool", id: e.id, tool: e.kind, label, path: e.path }]);
      } else if (e.type === "tool-error")
        setItems((x) => [...x, { kind: "error", text: `${e.arg}: ${e.error}` }]);
      else if (e.type === "edit")
        setItems((x) => [
          ...x,
          { kind: "edit", id: e.id, path: e.path, before: e.before, after: e.after, state: "ask" },
        ]);
      else if (e.type === "edit-done")
        setItems((x) =>
          x.map((i) =>
            i.kind === "edit" && i.id === e.id
              ? { ...i, state: e.saved ? "saved" : "declined" }
              : i,
          ),
        );
      else if (e.type === "run")
        setItems((x) => [...x, { kind: "run", id: e.id, command: e.command, state: "ask" }]);
      else if (e.type === "run-done")
        setItems((x) =>
          x.map((i) =>
            i.kind === "run" && i.id === e.id
              ? e.declined
                ? { ...i, state: "declined" }
                : { ...i, state: "done", code: e.code, output: e.output }
              : i,
          ),
        );
      else if (e.type === "limit")
        setItems((x) => [
          ...x,
          { kind: "note", text: t("{steps}단계에서 멈췄습니다. 이어서 하려면 다시 요청하세요.", { steps: e.steps }) },
        ]);
      else if (e.type === "stopped")
        setItems((x) => [...x, { kind: "note", text: t("중지했습니다.") }]);
      else if (e.type === "done") {
        setDraftReply("");
        setItems((x) => [
          ...x,
          {
            kind: "note",
            text: t("{steps}단계 · 입력 {input} / 출력 {output} 토큰", {
              steps: e.steps,
              input: fmt(e.usage.in),
              output: fmt(e.usage.out),
            }),
          },
        ]);
      }
    });
  }, []);

  if (!code)
    return (
      <div className="code-workspace">
        <div className="code-start">
          <p>{t("코드 모드는 데스크톱 앱에서 쓸 수 있습니다.")}</p>
        </div>
      </div>
    );

  const load = async (rel: string) => {
    try {
      const list = await code.list(rel);
      setTree((x) => ({ ...x, [rel]: list }));
    } catch {}
  };
  const chooseFolder = async () => {
    const f = await code.open();
    if (!f) return;
    setFolder(f);
    setItems([]);
    setHistory([]);
    setTree({});
    setOpen(new Set());
    setPreview(null);
    void load("");
  };
  const show = async (rel: string) => {
    setPanel(true);
    setPreviewError("");
    try {
      const f = await code.read(rel);
      setPreview({ path: rel, text: f.text });
    } catch (error) {
      setPreview(null);
      setPreviewError(error instanceof Error ? error.message : String(error));
    }
  };
  const togglePanel = () => {
    setPanelView("files");
    setPanel((v) => !v);
    if (!tree[""]) void load("");
  };
  const send = async () => {
    const text = draft.trim();
    if (!text || busy || !folder) return;
    setDraft("");
    setBusy(true);
    setStep(0);
    said.current = [];
    setItems((x) => [...x, { kind: "user", text }]);
    try {
      await code.run({ text, history });
    } catch (error) {
      setItems((x) => [
        ...x,
        { kind: "error", text: error instanceof Error ? error.message : String(error) },
      ]);
    } finally {
      setHistory((h) => [
        ...h,
        { role: "user", text },
        { role: "assistant", text: said.current.join("\n\n") || "(no reply)" },
      ]);
      setBusy(false);
    }
  };
  const answer = (id: number, allow: boolean, kind: "edit" | "run", all = false) => {
    if (kind === "run" && allow)
      setItems((x) => x.map((i) => (i.kind === "run" && i.id === id ? { ...i, state: "running" } : i)));
    void code.answer(id, allow, all);
  };
  const undo = async (id: number) => {
    setUndoError("");
    try {
      await code.undo(id);
      setItems((x) => x.map((i) => (i.kind === "edit" && i.id === id ? { ...i, state: "undone" } : i)));
      if (panelView === "changes") void loadChanges();
    } catch (error) {
      setUndoError(
        (error instanceof Error ? error.message : String(error)).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          "",
        ),
      );
    }
  };
  const loadChanges = async () => {
    setChanges(await code.gitStatus());
  };
  const showChanges = () => {
    setPanel(true);
    setPanelView("changes");
    setPreview(null);
    void loadChanges();
  };
  const showDiff = async (rel: string) => {
    setDiffText({ path: rel, text: await code.gitDiff(rel) });
  };

  const renderTree = (rel: string, depth: number): React.ReactNode =>
    (tree[rel] ?? []).map((e) => (
      <div key={e.path}>
        <button
          className={`tree-row ${preview?.path === e.path ? "active" : ""}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => {
            if (!e.dir) return void show(e.path);
            const next = new Set(open);
            if (next.has(e.path)) next.delete(e.path);
            else {
              next.add(e.path);
              if (!tree[e.path]) void load(e.path);
            }
            setOpen(next);
          }}
        >
          {e.dir ? (
            open.has(e.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />
          ) : (
            <span className="tree-gap" />
          )}
          {e.dir ? <Folder size={14} /> : <FileText size={14} />}
          <span>{e.name}</span>
        </button>
        {e.dir && open.has(e.path) && renderTree(e.path, depth + 1)}
      </div>
    ));

  return (
    <div className={`code-workspace ${panel && folder ? "with-panel" : ""}`}>
      <div className="code-main">
        <div className="code-bar">
          <button className="folder-chip" onClick={chooseFolder} title={folder?.root}>
            <FolderOpen size={14} />
            {folder ? folder.name : t("폴더 열기")}
          </button>
          {folder && (
            <button className="ghost-button code-changes-button" onClick={showChanges}>
              <GitCompare size={14} />
              {t("변경 사항")}
            </button>
          )}
          {folder && (
            <button
              className="icon-button"
              aria-label={t("파일 패널 전환")}
              aria-pressed={panel}
              onClick={togglePanel}
            >
              <PanelRight size={16} />
            </button>
          )}
        </div>
        <div className="code-transcript">
          {!folder ? (
            <div className="code-start">
              <h2>{t("작업할 폴더를 고르세요")}</h2>
              <button className="primary-button" onClick={chooseFolder}>
                <FolderOpen size={15} />
                {t("폴더 열기")}
              </button>
            </div>
          ) : !items.length ? (
            <div className="code-start">
              <h2>{t("{name}에서 무엇을 할까요?", { name: folder.name })}</h2>
            </div>
          ) : (
            <div className="code-items">
              {items.map((i, n) =>
                i.kind === "user" ? (
                  <div className="code-user" key={n}>
                    {i.text}
                  </div>
                ) : i.kind === "say" ? (
                  <div className="code-say" key={n}>
                    {i.text}
                  </div>
                ) : i.kind === "tool" ? (
                  <button
                    className="code-tool"
                    key={n}
                    disabled={i.tool !== "read"}
                    onClick={() => i.path && show(i.path)}
                  >
                    {i.tool === "search" ? (
                      <Search size={13} />
                    ) : i.tool === "list" ? (
                      <Folder size={13} />
                    ) : (
                      <FileText size={13} />
                    )}
                    {i.label}
                  </button>
                ) : i.kind === "error" ? (
                  <div className="code-error" key={n}>
                    {i.text}
                  </div>
                ) : i.kind === "note" ? (
                  <div className="code-note" key={n}>
                    {i.text}
                  </div>
                ) : i.kind === "edit" ? (
                  <div className={`code-card ${i.state}`} key={n}>
                    <div className="code-card-head">
                      <strong>{i.path}</strong>
                      <span>
                        {i.before
                          ? (() => {
                              const c = counts(i.before, i.after);
                              return `+${c.added} −${c.removed}`;
                            })()
                          : t("새 파일")}
                      </span>
                    </div>
                    <Diff before={i.before} after={i.after} />
                    <div className="code-card-foot">
                      {i.state === "ask" ? (
                        <>
                          <button className="primary-button" onClick={() => answer(i.id, true, "edit")}>
                            {t("저장")}
                          </button>
                          <button className="ghost-button" onClick={() => answer(i.id, false, "edit")}>
                            {t("거절")}
                          </button>
                          <button
                            className="ghost-button"
                            title={t("이번 요청에서 나오는 파일 변경을 묻지 않고 저장합니다. 명령은 계속 묻습니다.")}
                            onClick={() => answer(i.id, true, "edit", true)}
                          >
                            {t("이번 요청 모두 저장")}
                          </button>
                        </>
                      ) : i.state === "saved" ? (
                        <>
                          <span>{t("저장했습니다")}</span>
                          <button className="ghost-button" onClick={() => void undo(i.id)}>
                            {t("되돌리기")}
                          </button>
                        </>
                      ) : (
                        <span>{i.state === "undone" ? t("되돌렸습니다") : t("거절했습니다")}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={`code-card ${i.state}`} key={n}>
                    <div className="code-card-head">
                      <SquareTerminal size={14} />
                      <code>{i.command}</code>
                    </div>
                    {i.output !== undefined && <pre className="code-output">{i.output || " "}</pre>}
                    <div className="code-card-foot">
                      {i.state === "ask" ? (
                        <>
                          <button className="primary-button" onClick={() => answer(i.id, true, "run")}>
                            {t("실행")}
                          </button>
                          <button className="ghost-button" onClick={() => answer(i.id, false, "run")}>
                            {t("거절")}
                          </button>
                        </>
                      ) : (
                        <span>
                          {i.state === "running"
                            ? t("실행 중…")
                            : i.state === "declined"
                              ? t("거절했습니다")
                              : t("종료 코드 {code}", { code: String(i.code ?? "—") })}
                        </span>
                      )}
                    </div>
                  </div>
                ),
              )}
              {undoError && <div className="code-error">{undoError}</div>}
              {draftReply && (
                <div className="code-say streaming">
                  <Markdown text={draftReply} />
                </div>
              )}
              {busy && (
                <div className="code-working">
                  <span className="code-dot" />
                  {step ? t("작업 중 · {step}단계", { step }) : t("작업 중")}
                </div>
              )}
              <div ref={end} />
            </div>
          )}
        </div>
        {folder && (
          <div className="code-composer">
            <div className="composer">
              <textarea
                aria-label={t("요청")}
                placeholder={t("할 일을 적으세요")}
                value={draft}
                maxLength={20000}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-toolbar">
                <div className="model-control">
                  <span>{t("자동")}</span>
                </div>
                <button
                  type="button"
                  className="together-toggle"
                  disabled
                  title={t("코드 모드에서는 아직 Pitch in을 쓸 수 없습니다.")}
                >
                  <Users size={14} />
                  {t("Pitch in")}
                </button>
                {busy ? (
                  <button className="send-button" aria-label={t("중지")} onClick={() => void code.stop()}>
                    <Square size={13} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="send-button"
                    aria-label={t("보내기")}
                    disabled={!draft.trim()}
                    onClick={() => void send()}
                  >
                    <ArrowUp size={19} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {panel && folder && (
        <aside className="code-panel" aria-label={t("파일")}>
          <div className="code-panel-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={panelView === "files"}
              onClick={() => {
                setPanelView("files");
                if (!tree[""]) void load("");
              }}
            >
              {t("파일")}
            </button>
            <button role="tab" aria-selected={panelView === "changes"} onClick={showChanges}>
              {t("변경 사항")}
            </button>
          </div>
          {panelView === "changes" ? (
            <div className="code-changes">
              {changes === null ? (
                <p className="code-note">{t("git 저장소가 아니거나 git을 찾지 못했습니다.")}</p>
              ) : !changes.length ? (
                <p className="code-note">{t("바뀐 파일이 없습니다.")}</p>
              ) : (
                changes.map((c) => (
                  <button
                    key={c.path}
                    className={`tree-row ${diffText?.path === c.path ? "active" : ""}`}
                    onClick={() => void showDiff(c.path)}
                  >
                    <span className="git-state">{c.state.trim() || "·"}</span>
                    <span>{c.path}</span>
                  </button>
                ))
              )}
              {diffText && (
                <pre className="code-diff-text">
                  {diffText.text
                    ? diffText.text.split("\n").map((l, k) => (
                        <div
                          key={k}
                          className={
                            l.startsWith("+") && !l.startsWith("+++")
                              ? "add"
                              : l.startsWith("-") && !l.startsWith("---")
                                ? "del"
                                : l.startsWith("@@")
                                  ? "hunk"
                                  : undefined
                          }
                        >
                          {l || " "}
                        </div>
                      ))
                    : t("이 파일은 git이 아직 추적하지 않아 비교할 이전 내용이 없습니다.")}
                </pre>
              )}
            </div>
          ) : (
          <>
          <div className="code-tree">{renderTree("", 0)}</div>
          <div className="code-preview">
            {preview ? (
              <>
                <div className="code-preview-head">
                  <span>{preview.path}</span>
                  <button className="icon-button" aria-label={t("닫기")} onClick={() => setPreview(null)}>
                    <X size={14} />
                  </button>
                </div>
                <pre>
                  {preview.text.split("\n").map((l, i) => (
                    <div key={i}>
                      <span>{i + 1}</span>
                      {l}
                    </div>
                  ))}
                </pre>
              </>
            ) : previewError ? (
              <p className="code-error">{previewError}</p>
            ) : null}
          </div>
          </>
          )}
        </aside>
      )}
    </div>
  );
}
