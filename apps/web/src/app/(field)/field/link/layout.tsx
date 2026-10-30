import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer", title: "Project workspace | SAH Helper" };
export default function ProjectLinkLayout({ children }: { children: React.ReactNode }) { return children; }
