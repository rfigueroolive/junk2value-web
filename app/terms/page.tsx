// app/terms/page.tsx
import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#280550] text-white">
      <div className="mx-auto max-w-4xl px-6 py-14">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight">Terms of Service</h1>
          <Link
            href="/"
            className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
          >
            Back to Home
          </Link>
        </div>

        <p className="mt-4 text-white/75">Last updated: {new Date().toLocaleDateString()}</p>

        <section className="mt-10 space-y-6 rounded-3xl border border-white/10 bg-white/5 p-6">
          <div>
            <h2 className="text-xl font-bold text-[#A0FFA0]">1) Services</h2>
            <p className="mt-3 text-white/80">
              Junk2Value provides junk removal, hauling, cleanouts, and related services. Quotes are estimates and may
              change based on actual volume/weight, special handling requirements, and access constraints (stairs,
              distance, parking, heavy items, etc.).
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-[#A0FFA0]">2) Scheduling & Payments</h2>
            <p className="mt-3 text-white/80">
              Scheduling is subject to availability. Payment terms may be provided at the time of booking or service.
              Receipts can be provided by text or email.
            </p>
          </div>

          <div className="rounded-2xl border border-[#A0FFA0]/25 bg-[#A0FFA0]/10 p-5">
            <h2 className="text-xl font-bold text-[#A0FFA0]">3) SMS Terms</h2>
            <p className="mt-3 text-white/85">
              By providing your phone number and requesting a quote, scheduling, or job updates, you consent to receive
              text messages from Junk2Value related to your request (quote updates, scheduling, arrival updates,
              receipts).
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-white/85">
              <li>Message frequency varies (typically up to 5 messages per job)</li>
              <li>Message &amp; data rates may apply</li>
              <li>Reply <strong>STOP</strong> to opt out</li>
              <li>Reply <strong>HELP</strong> for help</li>
            </ul>
            <p className="mt-3 text-white/85">Consent is not a condition of purchase.</p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-[#A0FFA0]">4) Acceptable Use</h2>
            <p className="mt-3 text-white/80">
              Do not misuse this website, attempt unauthorized access, or interfere with site operation.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-[#A0FFA0]">5) Privacy</h2>
            <p className="mt-3 text-white/80">
              Your use is also governed by our{" "}
              <Link className="text-[#A0FFA0] underline" href="/privacy">
                Privacy Policy
              </Link>
              .
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-[#A0FFA0]">6) Disclaimer</h2>
            <p className="mt-3 text-white/80">
              Services and website content are provided “as is” without warranties of any kind to the fullest extent
              permitted by law.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-[#A0FFA0]">7) Contact</h2>
            <p className="mt-3 text-white/80">
              Email:{" "}
              <a className="text-[#A0FFA0] underline" href="mailto:support@junk2value.com">
                support@junk2value.com
              </a>
              <br />
              Phone:{" "}
              <a className="text-[#A0FFA0] underline" href="tel:+19702082722">
                (970) 208-2722
              </a>
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
