// /admin/login: outside the console shell, so it renders without a session.

import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return <LoginForm />;
}
