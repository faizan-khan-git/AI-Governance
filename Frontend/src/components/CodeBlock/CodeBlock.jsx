import { useEffect, useRef, useState } from "react";
import styles from "./CodeBlock.module.css";

const COPY_RESET_MS = 2000;

/**
 * Fenced code block with a language label and a copy-to-clipboard action.
 *
 * @param {object} props
 * @param {string} [props.language] language identifier from the fence (e.g. "java")
 * @param {string} props.rawCode plain-text source used for copying
 * @param {import('react').ReactNode} props.children highlighted <code> element
 */
export default function CodeBlock({ language, rawCode, children }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawCode);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), COPY_RESET_MS);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={styles.block}>
      <div className={styles.toolbar}>
        <span className={styles.language}>{language || "text"}</span>
        <button
          type="button"
          className={styles.copy}
          onClick={handleCopy}
          aria-label={copied ? "Code copied" : "Copy code"}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className={styles.pre}>{children}</pre>
    </div>
  );
}
