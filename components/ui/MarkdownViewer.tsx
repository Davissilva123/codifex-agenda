"use client";

import React from "react";

interface MarkdownViewerProps {
  content: string;
  className?: string;
}

export function MarkdownViewer({ content, className = "" }: MarkdownViewerProps) {
  if (!content) return null;

  const lines = content.split("\n");

  function renderInline(text: string) {
    // Processa inline code, bold, italic, links e URLs
    const parts: (string | React.ReactNode)[] = [];
    let remaining = text;

    // Regex para inline code, links, bold, italic e urls soltas
    const inlineRegex = /(`[^`]+`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(https?:\/\/[^\s]+)/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = inlineRegex.exec(remaining)) !== null) {
      if (match.index > lastIndex) {
        parts.push(remaining.slice(lastIndex, match.index));
      }

      const [full, code, , linkText, linkUrl, , boldText, , italicText, bareUrl] = match;

      if (code) {
        parts.push(
          <code key={match.index} className="rounded bg-black/5 dark:bg-white/10 px-1.5 py-0.5 text-xs font-mono text-violet-600 dark:text-violet-300">
            {code.slice(1, -1)}
          </code>
        );
      } else if (linkUrl) {
        parts.push(
          <a key={match.index} href={linkUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-violet-600 dark:text-violet-400 underline hover:opacity-80">
            {linkText}
          </a>
        );
      } else if (boldText) {
        parts.push(<strong key={match.index} className="font-semibold">{boldText}</strong>);
      } else if (italicText) {
        parts.push(<em key={match.index} className="italic">{italicText}</em>);
      } else if (bareUrl) {
        parts.push(
          <a key={match.index} href={bareUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-violet-600 dark:text-violet-400 underline hover:opacity-80">
            {bareUrl}
          </a>
        );
      }

      lastIndex = inlineRegex.lastIndex;
    }

    if (lastIndex < remaining.length) {
      parts.push(remaining.slice(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  }

  return (
    <div className={`space-y-1.5 text-sm leading-relaxed ${className}`}>
      {lines.map((line, index) => {
        const trimmed = line.trim();

        // Linha vazia
        if (!trimmed) {
          return <div key={index} className="h-2" />;
        }

        // Títulos
        if (line.startsWith("### ")) {
          return <h4 key={index} className="pt-1 text-base font-bold">{renderInline(line.slice(4))}</h4>;
        }
        if (line.startsWith("## ")) {
          return <h3 key={index} className="pt-2 text-lg font-bold">{renderInline(line.slice(3))}</h3>;
        }
        if (line.startsWith("# ")) {
          return <h2 key={index} className="pt-2 text-xl font-bold">{renderInline(line.slice(2))}</h2>;
        }

        // Bullet list
        if (/^\s*[-*]\s+/.test(line)) {
          const itemText = line.replace(/^\s*[-*]\s+/, "");
          return (
            <div key={index} className="flex items-start gap-2 pl-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-current opacity-60 shrink-0" />
              <span>{renderInline(itemText)}</span>
            </div>
          );
        }

        // Parágrafo padrão
        return <p key={index} className="break-words">{renderInline(line)}</p>;
      })}
    </div>
  );
}
