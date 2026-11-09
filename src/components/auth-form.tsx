"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions";

export function AuthForm({
  action,
  withEmail,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  withEmail: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {withEmail && (
        <div className="flex flex-col gap-1">
          <label htmlFor="email">E-mail of gebruikersnaam</label>
          <input
            id="email"
            name="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            defaultValue={state?.email}
            required
          />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="password">Wachtwoord</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={withEmail ? "current-password" : "new-password"}
          required
        />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn" disabled={pending}>
        {pending ? "Even geduld…" : submitLabel}
      </button>
    </form>
  );
}
