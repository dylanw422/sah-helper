import { forwardRef, type AnchorHTMLAttributes } from "react";

// Next's router is supplied by the application. In this isolated harness,
// real anchor navigation loads the same editor and its persistent service double.
export default forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(function Link(props, ref) {
  return <a {...props} ref={ref} />;
});
