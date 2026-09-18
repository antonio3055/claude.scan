import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-sm px-1.5 py-0.5 text-2xs font-medium tracking-wide uppercase",
  {
    variants: {
      tone: {
        complete: "bg-complete-dim text-complete",
        review: "bg-review-dim text-review",
        failed: "bg-failed-dim text-failed",
        scanning: "bg-scanning-dim text-scanning",
        queued: "bg-queued-dim text-queued",
        muted: "bg-surface-3 text-muted",
      },
    },
    defaultVariants: { tone: "muted" },
  },
);

function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, className }))} {...props} />;
}

export { Badge, badgeVariants };
