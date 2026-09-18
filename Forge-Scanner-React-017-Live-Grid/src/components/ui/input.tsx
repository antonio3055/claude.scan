import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-sm border border-border bg-surface-2 px-3 text-sm text-fg shadow-border",
        "placeholder:text-subtle",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
