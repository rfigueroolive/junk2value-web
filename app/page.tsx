// app/page.tsx
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#280550] text-white">
      {/* Top bar */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#280550]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-[#A0FFA0] font-black">
              J2V
            </div>
            <div className="leading-tight">
              <div className="text-lg font-semibold tracking-tight">Junk2Value</div>
              <div className="text-xs text-white/70">Junk removal • Hauling • Cleanouts</div>
            </div>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-white/80 md:flex">
            <a href="#services" className="hover:text-white">Services</a>
            <a href="#how" className="hover:text-white">How it works</a>
            <a href="#pricing" className="hover:text-white">Pricing</a>
            <a href="#contact" className="hover:text-white">Contact</a>
          </nav>

          <div className="flex items-center gap-2">
            <a
              href="tel:+19702082722"
              className="hidden rounded-2xl border border-white/15 px-4 py-2 text-sm text-white/90 hover:bg-white/10 md:inline-flex"
            >
              Call (970) 208-2722
            </a>
            <a
              href="#contact"
              className="rounded-2xl bg-[#A0FFA0] px-4 py-2 text-sm font-semibold text-[#280550] hover:opacity-90"
            >
              Get a quote
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[#A0FFA0]/20 blur-3xl" />
          <div className="absolute -bottom-40 right-0 h-[420px] w-[420px] rounded-full bg-white/10 blur-3xl" />
        </div>

        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-5 py-16 md:grid-cols-2 md:py-24">
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs text-white/80">
              <span className="h-2 w-2 rounded-full bg-[#A0FFA0]" />
              Grand Junction, CO • Same-week availability
            </div>

            <h1 className="mt-6 text-4xl font-black tracking-tight md:text-5xl">
              Junk removal that’s fast, clean, and{" "}
              <span className="text-[#A0FFA0]">actually reliable.</span>
            </h1>

            <p className="mt-5 max-w-xl text-base leading-7 text-white/80 md:text-lg">
              Book a pickup, get updates by text, and watch clutter turn into space. From single items to full cleanouts.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#contact"
                className="inline-flex items-center justify-center rounded-2xl bg-[#A0FFA0] px-5 py-3 font-semibold text-[#280550] hover:opacity-90"
              >
                Get a fast quote
              </a>
              <a
                href="#services"
                className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-5 py-3 font-semibold text-white hover:bg-white/10"
              >
                See services
              </a>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3 text-sm text-white/75 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-[#A0FFA0] font-semibold">Upfront quotes</div>
                <div className="mt-1 text-white/70">No weird surprises</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-[#A0FFA0] font-semibold">Quick pickups</div>
                <div className="mt-1 text-white/70">Same-week often</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-[#A0FFA0] font-semibold">Text updates</div>
                <div className="mt-1 text-white/70">On the way + receipts</div>
              </div>
            </div>
          </div>

          {/* Quote card */}
          <div className="relative">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/30">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-white/70">Fast quote</div>
                  <div className="text-xl font-bold">Tell us what you’ve got</div>
                </div>
                <div className="rounded-2xl bg-white/10 px-3 py-2 text-xs text-white/70">
                  1–2 minutes
                </div>
              </div>

              <div className="mt-6 grid gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                  <div className="text-xs text-white/60">Items</div>
                  <div className="mt-1 text-sm text-white/85">
                    e.g., couch, mattress, yard debris, boxes…
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                  <div className="text-xs text-white/60">Pickup address</div>
                  <div className="mt-1 text-sm text-white/85">Grand Junction / Fruita / Palisade</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                  <div className="text-xs text-white/60">Best contact</div>
                  <div className="mt-1 text-sm text-white/85">(970) 208-2722 • support@junk2value.com</div>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-[#A0FFA0]/30 bg-[#A0FFA0]/10 p-4 text-sm text-white/85">
                By providing your number, you may receive texts about your quote/job (updates, scheduling, arrival, receipts).
                Msg frequency varies (typically up to 5 per job). Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <a
                  href="sms:+19702082722?&body=Hi%20Junk2Value!%20I%20need%20a%20quote.%20Items%3A%20_____%20Address%3A%20_____%20When%3A%20_____"
                  className="inline-flex flex-1 items-center justify-center rounded-2xl bg-[#A0FFA0] px-5 py-3 font-semibold text-[#280550] hover:opacity-90"
                >
                  Text for a quote
                </a>
                <a
                  href="tel:+19702082722"
                  className="inline-flex flex-1 items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-5 py-3 font-semibold text-white hover:bg-white/10"
                >
                  Call now
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="mx-auto max-w-6xl px-5 py-14 md:py-20">
        <div className="flex items-end justify-between gap-6">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">Services</h2>
            <p className="mt-2 text-white/75">Simple, clean, and done right.</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            {
              title: "Single-item pickups",
              desc: "Mattress, couch, appliances, etc. Quick in-and-out.",
            },
            {
              title: "Full cleanouts",
              desc: "Garages, storage units, rentals, hoarder-lite situations.",
            },
            {
              title: "Yard debris & loads",
              desc: "Branches, bags, scrap, dump runs, and hauling.",
            },
          ].map((s) => (
            <div key={s.title} className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="text-lg font-bold text-[#A0FFA0]">{s.title}</div>
              <div className="mt-2 text-sm leading-6 text-white/75">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-white/10 bg-black/10">
        <div className="mx-auto max-w-6xl px-5 py-14 md:py-20">
          <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">How it works</h2>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { n: "1", t: "Tell us what you need", d: "Call or text photos + a short list of items." },
              { n: "2", t: "Get a fast quote", d: "We confirm price + pickup time. No drama." },
              { n: "3", t: "We haul it away", d: "You get text updates and a receipt." },
            ].map((step) => (
              <div key={step.n} className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#A0FFA0] font-black text-[#280550]">
                  {step.n}
                </div>
                <div className="mt-4 text-lg font-bold">{step.t}</div>
                <div className="mt-2 text-sm leading-6 text-white/75">{step.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-5 py-14 md:py-20">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:items-start">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">Pricing</h2>
            <p className="mt-3 text-white/75">
              Quotes depend on volume, weight, and access (stairs, distance, heavy items).
              Text photos for the fastest estimate.
            </p>

            <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="text-sm text-white/70">Typical jobs</div>
              <ul className="mt-3 space-y-2 text-sm text-white/85">
                <li>• Single item pickup</li>
                <li>• Partial load / dump run</li>
                <li>• Full cleanout</li>
              </ul>
              <div className="mt-5 text-sm text-white/70">
                Want an exact number? Text photos + address.
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-[#A0FFA0]/25 bg-[#A0FFA0]/10 p-6">
            <div className="text-sm text-white/80">Fastest way</div>
            <div className="mt-2 text-2xl font-black">Text photos for a quote</div>
            <p className="mt-3 text-sm leading-6 text-white/80">
              Send: (1) item photos, (2) address, (3) stairs/parking info, (4) preferred day/time.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                href="sms:+19702082722?&body=Hi%20Junk2Value!%20Quote%20request:%0AItems:%20%0AAddress:%20%0AStairs/Access:%20%0APreferred%20time:%20"
                className="inline-flex flex-1 items-center justify-center rounded-2xl bg-[#A0FFA0] px-5 py-3 font-semibold text-[#280550] hover:opacity-90"
              >
                Text now
              </a>
              <a
                href="tel:+19702082722"
                className="inline-flex flex-1 items-center justify-center rounded-2xl border border-white/20 bg-white/10 px-5 py-3 font-semibold text-white hover:bg-white/15"
              >
                Call
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="border-t border-white/10 bg-black/10">
        <div className="mx-auto max-w-6xl px-5 py-14 md:py-20">
          <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">Contact</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="text-sm text-white/70">Phone</div>
              <a className="mt-2 block text-lg font-bold text-[#A0FFA0]" href="tel:+19702082722">
                (970) 208-2722
              </a>
              <div className="mt-2 text-sm text-white/75">Call or text for quotes and scheduling.</div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="text-sm text-white/70">Email</div>
              <a className="mt-2 block text-lg font-bold text-[#A0FFA0]" href="mailto:support@junk2value.com">
                support@junk2value.com
              </a>
              <div className="mt-2 text-sm text-white/75">Send photos and details for estimates.</div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="text-sm text-white/70">Service area</div>
              <div className="mt-2 text-lg font-bold text-[#A0FFA0]">Mesa County + nearby</div>
              <div className="mt-2 text-sm text-white/75">Grand Junction • Fruita • Palisade</div>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-6 md:flex-row md:items-center">
            <div className="text-sm text-white/70">
              © {new Date().getFullYear()} Junk2Value
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <Link className="text-white/80 hover:text-white" href="/privacy">
                Privacy Policy
              </Link>
              <Link className="text-white/80 hover:text-white" href="/terms">
                Terms
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
