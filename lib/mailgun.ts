// src/lib/mailgun.ts
import formData from "form-data";
import Mailgun from "mailgun.js";

const mailgun = new Mailgun(formData);

const mg = mailgun.client({
  username: "api",
  key: process.env.MAILGUN_API_KEY as string,
});

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN as string;
const MAILGUN_FROM_EMAIL =
  process.env.MAILGUN_FROM_EMAIL || "Junk2Value <no-reply@junk2value.com>";

if (!MAILGUN_DOMAIN || !process.env.MAILGUN_API_KEY) {
  console.warn("⚠️ Mailgun env vars are missing – emails will fail.");
}

export async function sendFromNoreply(
  to: string,
  subject: string,
  text: string,
  html?: string
) {
  return mg.messages.create(MAILGUN_DOMAIN, {
    from: MAILGUN_FROM_EMAIL,
    to,
    subject,
    text,
    html: html ?? `<p>${text}</p>`,
  });
}
