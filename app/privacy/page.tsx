// app/privacy/page.tsx
import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[#280550] text-white">
      <div className="mx-auto max-w-4xl px-6 py-14">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight">Privacy Policy</h1>
          <Link
            href="/"
            className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
          >
            Back to Home
          </Link>
        </div>

        <p className="mt-4 text-white/75">Last updated: {new Date().toLocaleDateString()}</p>

        <section className="mt-10 space-y-6 rounded-3xl border border-white/10 bg-white/5 p-6">
          <p className="text-white/85">
            Junk2Value (“we”, “us”) respects your privacy. This policy explains what information is collected and how it
            is used when you visit our website or request a quote/service.
          </p>

          <div>
            <h2 className="text-xl font-bold text-[#A0FFA0]">Information We Collect</h2>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-white/80">
              <li>Contact info you provide (name, phone number, email)</li>
              <li>Service info (address, item descriptions, photos you send, job notes)</li>
              <li>Basic usage data (analytics, device/browser info) to improve the site</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-bold text-[#A0FFA0]">How We Use Information</h2>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-white/80">
              <li>Provide quotes, schedule jobs, and deliver service</li>
              <li>Send service-related updates by SMS/email if you request them</li>
              <li>Customer support, receipts/invoices, and recordkeeping</li>
              <li>Improve our website and service quality</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-[#A0FFA0]/25 bg-[#A0FFA0]/10 p-5">
            <h2 className="text-xl font-bold text-[#A0FFA0]">SMS Privacy (Important)</h2>
            <p className="mt-3 text-white/85">
              <strong>
                Mobile information will not be shared with third parties/affiliates for marketing or promotional
                purposes.
              </strong>{" "}
              Mobile information may be shared only with service providers as needed to operate our business (for
              example, messaging or customer support). Text messaging opt-in data and consent will not be shared with
              third parties.
            </p>
            <p className="mt-3 text-white/85">
              Message frequency varies (typically up to 5 messages per job). Message &amp; data rates may apply. Reply{" "}
              <strong>STOP</strong> to opt out, <strong>HELP</strong> for help.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-[#A0FFA0]">Sharing</h2>
            <p className="mt-3 text-white/80">
              We may share information with vendors who help us run our business (hosting, payments, communications),
              only as necessary to provide services. We do not sell your personal information.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-[#A0FFA0]">Data Security</h2>
            <p className="mt-3 text-white/80">
              We use reasonable safeguards to protect your data. No method of transmission or storage is 100% secure.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-[#A0FFA0]">Contact</h2>
            <p className="mt-3 text-white/80">
              Email: <a className="text-[#A0FFA0] underline" href="mailto:support@junk2value.com">support@junk2value.com</a>
              <br />
              Phone: <a className="text-[#A0FFA0] underline" href="tel:+19702082722">(970) 208-2722</a>
            </p>
          </div>

          <p className="text-sm text-white/60">
            This page is provided for general informational purposes and is not legal advice.
          </p>
        </section>
      </div>
    </main>
  );
}
