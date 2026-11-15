# Attendly email templates (Supabase)

Paste these into **Supabase → Authentication → Emails → Templates**.

| Supabase template | File | Subject |
|---|---|---|
| Reset Password | `reset-password.html` | `Your Attendly reset code: {{ .Token }}` |
| Change Email Address | `change-email.html` | `Confirm your new Attendly email` |

For each: open the template, set the Subject, switch the body to **Source/HTML**, delete what's there, paste the whole file, **Save**.

`{{ .Token }}`, `{{ .ConfirmationURL }}`, `{{ .Email }}` and `{{ .NewEmail }}` are filled in by Supabase. Don't change them.
