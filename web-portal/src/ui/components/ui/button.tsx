import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva("button", {
  variants: { variant: { default: "button-primary", outline: "button-outline", ghost: "button-ghost" } },
  defaultVariants: { variant: "default" },
});

export function Button({
  className, variant, loading, disabled, children, ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { loading?: boolean | string }) {
  return <button data-slot="button" className={cn(buttonVariants({ variant }), className)} {...props}
    disabled={disabled || !!loading} aria-busy={loading ? true : props["aria-busy"]}>
    {loading ? <><LoaderCircle size={16} className="ui-spinner" aria-hidden="true" />{typeof loading === "string" ? loading : children}</> : children}
  </button>;
}
