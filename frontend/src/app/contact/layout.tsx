import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact us",
  description: "Questions, problems or ideas? Send us a message and we will get back to you.",
  alternates: { canonical: "/contact" },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
