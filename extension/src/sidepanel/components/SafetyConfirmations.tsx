import { useState } from "react";
import { approveSafetyConfirmation, rejectSafetyConfirmation } from "../../shared/api-client";
import type { SafetyConfirmation } from "../../shared/types";

const ACTION_LABELS: Record<string, string> = {
  send_email:      "Send Email",
  delete_item:     "Delete Item",
  submit_form:     "Submit Form",
  make_purchase:   "Make Purchase",
  share_data:      "Share Private Data",
  change_settings: "Change Account Settings",
  other:           "Action Required",
};

export function SafetyConfirmations({
  confirmations,
  onResolved,
}: {
  confirmations: SafetyConfirmation[];
  onResolved: () => void;
}) {
  return (
    <div className="section">
      <div className="section-label" style={{ color: "var(--red)" }}>Confirmations</div>
      {confirmations.map((c) => (
        <ConfirmationCard key={c.id} confirmation={c} onResolved={onResolved} />
      ))}
    </div>
  );
}

function ConfirmationCard({
  confirmation: c,
  onResolved,
}: {
  confirmation: SafetyConfirmation;
  onResolved: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(action: "approve" | "reject") {
    setError(null);
    setLoading(true);
    try {
      if (action === "approve") await approveSafetyConfirmation(c.id);
      else                      await rejectSafetyConfirmation(c.id);
      onResolved();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const expiresIn = c.expires_at
    ? Math.max(0, Math.round((new Date(c.expires_at).getTime() - Date.now()) / 1000))
    : null;

  return (
    <div className="safety-card">
      <div className="safety-card-header">
        <div className="safety-action-type">
          {ACTION_LABELS[c.action_type] ?? c.action_type}
        </div>
        <span className={`risk-badge ${c.risk_level}`}>{c.risk_level}</span>
      </div>

      <p className="safety-description">{c.description}</p>

      {Object.keys(c.details).length > 0 && (
        <div className="safety-details">
          {JSON.stringify(c.details, null, 2)}
        </div>
      )}

      {expiresIn !== null && (
        <div className="safety-expiry">EXPIRES IN {expiresIn}s</div>
      )}

      {error && <div className="error-msg" style={{ marginBottom: 10 }}>{error}</div>}

      <div className="btn-row" style={{ marginTop: 0 }}>
        <button
          className="btn btn-primary"
          disabled={loading}
          onClick={() => handle("approve")}
          style={{ flex: 1 }}
        >
          {loading ? "…" : "✓  approve"}
        </button>
        <button
          className="btn btn-ghost"
          disabled={loading}
          onClick={() => handle("reject")}
          style={{ flex: 1 }}
        >
          {loading ? "…" : "✗  reject"}
        </button>
      </div>
    </div>
  );
}
