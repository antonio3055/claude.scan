import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium transition-[background-color,color,box-shadow] duration-150 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-fg shadow-border hover:bg-primary-hover",
        secondary: "bg-surface-2 text-fg shadow-border hover:bg-surface-3",
        outline: "bg-transparent text-fg shadow-border hover:bg-surface-3",
        ghost: "text-fg hover:bg-surface-3",
        stop: "bg-danger text-danger-fg hover:bg-danger-hover",
        danger: "text-failed shadow-border hover:bg-failed-dim",
      },
      size: {
        default: "h-11 px-4",
        sm: "h-8 px-2.5 text-xs",
        lg: "h-11 px-4",
        icon: "size-11",
        iconSm: "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
