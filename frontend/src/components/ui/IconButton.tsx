import React from "react";

interface Props extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  /** What the button does. Shown as a tooltip and read by screen readers, since there is no visible text. */
  label: string;
  active?: boolean;
  tone?: "default" | "danger" | "accent";
  size?: "sm" | "md";
}

/** A round icon-only button. Always has a label for tooltips and screen readers. */
export const IconButton = React.forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, active, tone = "default", size = "md", className = "", children, type = "button", ...rest },
  ref,
) {
  const colour =
    tone === "danger"
      ? "text-[var(--text-muted)] hover:text-rose-600 hover:bg-rose-500/10"
      : active
        ? "bg-[var(--brand-lime)] text-[#0E0F0C] border-transparent"
        : "text-[var(--btn-secondary-text)] hover:bg-[var(--btn-secondary-hover)]";
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      data-compact={size === "sm" ? "" : undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--card-border)] ${
        active || tone === "accent" ? "" : "bg-[var(--btn-secondary-bg)]"
      } ${size === "sm" ? "h-8 w-8" : "h-9 w-9"} cursor-pointer transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)] disabled:cursor-not-allowed disabled:opacity-50 ${colour} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
