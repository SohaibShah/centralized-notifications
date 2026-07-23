import type { FormSchema } from "@notifications/vue";

export const loginForm: FormSchema = {
  id: "login",
  fields: [
    {
      name: "username",
      label: "Username",
      type: "text",
      required: true,
      autocomplete: "username",
      maxLength: 100,
      placeholder: "e.g. admin",
    },
    {
      name: "password",
      label: "Password",
      type: "password",
      required: true,
      autocomplete: "current-password",
      maxLength: 200,
    },
  ],
  submitLabel: "Sign in",
  submittingLabel: "Signing in…",
};
