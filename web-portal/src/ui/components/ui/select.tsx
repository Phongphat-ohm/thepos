import { useId, type ComponentProps } from "react";

export function Select({ label, children, ...props }: ComponentProps<"select"> & { label: string }) {
  const id = useId();
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <select className="input" id={id} {...props}>{children}</select>
    </div>
  );
}
