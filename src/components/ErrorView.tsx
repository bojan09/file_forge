"use client";

import { useEffect, useRef } from "react";
import { useConverter } from "@/lib/converter";
import { AlertIcon } from "./icons";

export function ErrorView() {
  const { state, convert, reset, backToSettings } = useConverter();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  if (state.phase !== "error") return null;
  return (
    <div className="enter mx-auto max-w-lg">
      <section role="alert" className="card space-y-4 border-danger/40 p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <AlertIcon size={26} className="shrink-0 text-danger" />
          <div>
            <h1 ref={ref} tabIndex={-1} className="text-lg font-bold outline-none">
              Conversion failed
            </h1>
            <p className="mt-1 text-sm text-muted" data-testid="error-message">
              {state.message}
            </p>
            <p className="mt-2 text-xs text-muted">{state.fileName}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {state.retryable && state.inspection && (
            <button
              type="button"
              className="btn btn-primary flex-1"
              onClick={() => {
                backToSettings();
                setTimeout(convert, 0);
              }}
            >
              Try again
            </button>
          )}
          {state.inspection && (
            <button type="button" className="btn btn-secondary flex-1" onClick={backToSettings}>
              Change settings
            </button>
          )}
          <button type="button" className="btn btn-secondary flex-1" onClick={reset}>
            Choose another file
          </button>
        </div>
      </section>
    </div>
  );
}
