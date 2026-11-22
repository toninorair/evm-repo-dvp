export function Overview() {
  return (
    <div className="reveal" style={{ maxWidth: 960 }}>
      <div style={{ paddingBottom: 32, borderBottom: '1px solid var(--line)' }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Nordhaven Bank · Case Study · 60-Minute Panel Session
        </div>
        <h1>Tokenised Repo on Ethereum</h1>
        <p className="muted lead" style={{ marginTop: 14, maxWidth: 680 }}>
          Session plan for the Lead FDE briefing: concept explainer for the trading desk, steering committee decision memo, live atomic DvP demonstration on Sepolia, and open Q&amp;A.
        </p>
      </div>

      <section aria-label="Session timeline" className="timeline">
        {/* Step 1: Walkthrough (Steps 1 & 2) */}
        <article className="timeline-item">
          <div className="timeline-rail" aria-hidden="true">
            <span className="timeline-node active" />
            <span className="timeline-line" />
          </div>
          <div className="timeline-body">
            <div className="timeline-meta">
              <span className="eyebrow">01 · Walkthrough · 20 Min</span>
              <span className="timeline-time">00:00 — 20:00</span>
            </div>
            <h2>Deliverables 1 &amp; 2 — Concept Explainer &amp; Steering Memo</h2>
            <p className="muted timeline-desc">
              Executive walkthrough for Nordhaven’s Head of Repo Trading and Steering Committee: market structure &amp; atomic DvP lifecycle, proven vs. aspirational use cases, and the public Ethereum thesis.
            </p>
            <div className="timeline-actions">
              <a className="btn primary" href="./presentation.html">
                Open Presentation →
              </a>
              <a className="btn primary" href="./presentation.html#5">
                Steering Memo →
              </a>
            </div>
          </div>
        </article>

        {/* Step 2: Live Demo (Step 3) */}
        <article className="timeline-item">
          <div className="timeline-rail" aria-hidden="true">
            <span className="timeline-node" />
            <span className="timeline-line" />
          </div>
          <div className="timeline-body">
            <div className="timeline-meta">
              <span className="eyebrow">02 · Live Demo · 10 Min</span>
              <span className="timeline-time">20:00 — 30:00</span>
            </div>
            <h2>Deliverable 3 — Tokenised Repo Proof Of Concept</h2>
            <p className="muted timeline-desc">
              Live execution against verified Sepolia contracts (<code>RepoDvP</code>, ERC-3643 <code>nhBOND</code>, deposit token <code>nhEUR</code>, and the Chainlink compatible oracle interface <code>nhNAVOracle</code>): programmable atomic opening DvP and closing RvP repo settlement, mark-to-market margin calls, and default close-out settlement.
            </p>
            <div className="timeline-actions">
              <a className="btn primary" href="#/borrower">
                Launch Demo App →
              </a>
            </div>
          </div>
        </article>

        {/* Step 3: Q&A Session */}
        <article className="timeline-item last">
          <div className="timeline-rail" aria-hidden="true">
            <span className="timeline-node" />
          </div>
          <div className="timeline-body">
            <div className="timeline-meta">
              <span className="eyebrow">03 · Panel Q&amp;A · 30 Min</span>
              <span className="timeline-time">30:00 — 60:00</span>
            </div>
            <h2>Q&amp;A — Trading Desk, Legal &amp; Risk, CTO’s Office</h2>
            <p className="muted timeline-desc">
              Open discussion pushing on institutional trade-offs, insolvency &amp; FCD/SFD enforceability, smart-contract security invariants, changing requirements on the spot, and how Ethereum Institutional would scope and lead the Phase 1 pilot.
            </p>
            <div className="timeline-actions">
              <a className="btn primary" href="./presentation.html#6">
                Contract Architecture →
              </a>
              <a className="btn primary" href="./presentation.html#7">
                Repo Flows →
              </a>
            </div>
          </div>
        </article>
      </section>
    </div>
  )
}
