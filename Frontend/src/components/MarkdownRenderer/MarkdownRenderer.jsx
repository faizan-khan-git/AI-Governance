import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

import CodeBlock from "../CodeBlock/CodeBlock.jsx";
import styles from "./MarkdownRenderer.module.css";

const LANGUAGE_PATTERN = /language-([\w+#-]+)/;

/** Flatten a hast node to plain text (used for copying highlighted code). */
function hastToText(node) {
  if (!node) return "";
  if (node.type === "text") return node.value;
  return (node.children ?? []).map(hastToText).join("");
}

const components = {
  pre({ node, children }) {
    const codeNode = node?.children?.find((c) => c.tagName === "code");
    const classNames = [codeNode?.properties?.className ?? []].flat().join(" ");
    const language = classNames.match(LANGUAGE_PATTERN)?.[1];
    return (
      <CodeBlock language={language} rawCode={hastToText(codeNode)}>
        {children}
      </CodeBlock>
    );
  },
  a({ node: _node, ...props }) {
    return <a {...props} target="_blank" rel="noopener noreferrer" />;
  },
  table({ node: _node, ...props }) {
    return (
      <div className={styles.tableWrap}>
        <table {...props} />
      </div>
    );
  },
};

/**
 * Renders assistant Markdown (GFM) safely: raw HTML is not rendered and unsafe
 * URLs are stripped by react-markdown's default URL transform.
 */
function MarkdownRenderer({ content }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownRenderer);
