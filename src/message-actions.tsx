import React, { useEffect, useRef, useState } from "react";
import { Copy, Check, Share2 } from "lucide-react";
import { t } from "./i18n";

export function conversationMarkdown(title: string, messages: { role: "user" | "assistant"; text: string }[]): string {
  const lines = ["# " + title];
  for (const msg of messages) {
    const text = msg.text.trim();
    if (!text) continue;
    const speaker = msg.role === "user" ? "**" + t("나") + "**" : "**Pumasi Agent**";
    lines.push("", speaker, "", text);
  }
  return lines.join("\n") + "\n";
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore errors
    }
  };

  const currentLabel = copied ? t("복사됨") : (label ?? t("복사"));

  return (
    <button
      type="button"
      className="msg-action"
      aria-label={currentLabel}
      title={currentLabel}
      onClick={() => void handleClick()}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export function ShareButton({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text });
      } catch {
        // User cancelled
      }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      } catch {
        // Ignore errors
      }
    }
  };

  const label = copied
    ? t("대화를 복사했습니다. 붙여 넣어 공유하세요.")
    : t("대화 공유");

  return (
    <button
      type="button"
      className="msg-action"
      aria-label={label}
      title={label}
      onClick={() => void handleClick()}
    >
      {copied ? <Check size={14} /> : <Share2 size={14} />}
    </button>
  );
}
