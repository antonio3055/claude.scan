import * as ProgressPrimitive from "@radix-ui/react-progress";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Progress({
  className,
  value = 0,
  ...props
}: ComponentProps<typeof ProgressPrimitive.Root>) {
  const numeric = typeof value === "number" ? value : 0;
  const clamped = Math.max(0, Math.min(100, numeric));
  return (
    <ProgressPrimitive.Root
      className={cn("relative h-1.5 w-full overflow-hidden rounded-sm bg-surface-3", className)}
      value={clamped}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full bg-primary transition-transform duration-200 ease-smooth"
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
