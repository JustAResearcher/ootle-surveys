import { useState } from "react";
import { Dialog } from "./Dialog";
import { csv, download } from "../lib/export.mjs";
export type InvitationLink = { url: string; submitted: boolean };
export function InvitationDialog({
  links,
  onClose,
}: {
  links: InvitationLink[];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(-1),
    [error, setError] = useState("");
  const local = ["127.0.0.1", "localhost"].includes(
    new URL(links[0].url).hostname,
  );
  return (
    <Dialog title="Your private invitations" onClose={onClose} wide>
      <p className="muted">
        Share a different link with each participant. A link contains the key to
        open the questionnaire, so share it privately.
      </p>
      <div className="invitation-toolbar">
        <span className="small muted">
          {links.filter((l) => !l.submitted).length} unused ·{" "}
          {links.filter((l) => l.submitted).length} submitted
        </span>
        <button
          className="outline compact"
          onClick={() =>
            download(
              csv([
                ["Participant", "Status", "Private invitation link"],
                ...links.map((l, i) => [
                  i + 1,
                  l.submitted ? "Submitted" : "Unused",
                  l.url,
                ]),
              ]),
              "ootle-surveys-private-invitations.csv",
              "text/csv;charset=utf-8",
            )
          }
        >
          Download invitations
        </button>
      </div>
      <div className="invitation-list">
        {links.map((link, i) => (
          <div className="invitation-row" key={link.url}>
            <label htmlFor={"link-" + i}>
              Participant {i + 1}{" "}
              <span className="muted">
                · {link.submitted ? "Submitted" : "Unused"}
              </span>
            </label>
            <input
              id={"link-" + i}
              readOnly
              value={link.url}
              onFocus={(e) => e.target.select()}
            />
            <button
              className="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(link.url)
                  .then(() => {
                    setCopied(i);
                    setError("");
                  })
                  .catch(() =>
                    setError("Select the link and copy it manually."),
                  )
              }
            >
              {copied === i ? "Copied" : "Copy"}
            </button>
          </div>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="small muted">
        {local
          ? "These links work on this computer. Configure an HTTPS public origin before inviting people on other devices."
          : "These links use your configured public address. Keep downloaded invitations private."}
      </p>
    </Dialog>
  );
}
