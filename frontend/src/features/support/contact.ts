/** The Contact us form's rules, checked in the browser first so mistakes show up instantly. The server checks again. */

export const CATEGORIES = [
  { value: "general", label: "A question" },
  { value: "bug", label: "Something is broken" },
  { value: "account", label: "My account" },
  { value: "content", label: "A problem with a summary or study set" },
  { value: "feature", label: "A suggestion" },
  { value: "other", label: "Something else" },
] as const;

export const MAX_MESSAGE = 4000;
export const MIN_MESSAGE = 10;

export interface ContactDraft {
  name: string;
  email: string;
  category: string;
  subject: string;
  message: string;
}

export type ContactErrors = Partial<Record<"email" | "message", string>>;

const EMAIL = /^[^@\s<>"',;:()[\]\\]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}$/;

export function validateContact(draft: ContactDraft): ContactErrors {
  const errors: ContactErrors = {};
  if (!EMAIL.test(draft.email.trim())) errors.email = "Please enter a valid email address so we can reply.";
  const length = draft.message.trim().length;
  if (length < MIN_MESSAGE) errors.message = `Please write a little more so we can help (at least ${MIN_MESSAGE} characters).`;
  else if (length > MAX_MESSAGE) errors.message = `Please keep it under ${MAX_MESSAGE} characters.`;
  return errors;
}
