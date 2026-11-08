import Link from "next/link";
import { SendToTelegram } from "@/components/telegram-connect";

/**
 * "What do I do now?" for a purchase held for approval. Used everywhere a held purchase shows up
 * (dashboard, guided demo, purchase page, agent chat). Wording depends on whether Telegram is linked,
 * so we never claim a Telegram message that wasn't sent.
 */
export function ApprovalHelp({
  telegram,
  place = "elsewhere",
  className = "",
}: {
  /** The user has Telegram connected (held purchases are sent there). */
  telegram: boolean;
  /** Where the Approve/Decline buttons are relative to this text. */
  place?: "here" | "dashboard" | "elsewhere";
  className?: string;
}) {
  const where =
    place === "here" ? (
      <>
        the <strong>Approve</strong> / <strong>Decline</strong> buttons here
      </>
    ) : place === "dashboard" ? (
      <>
        the <strong>Approve</strong> / <strong>Decline</strong> buttons in{" "}
        <strong>Waiting for your approval</strong> at the top of this page
      </>
    ) : (
      <>
        the <strong>Approve</strong> / <strong>Decline</strong> buttons on your{" "}
        <Link
          href="/dashboard#approvals"
          className="underline underline-offset-2"
        >
          dashboard
        </Link>
      </>
    );
  return (
    <div className={`space-y-2 ${className}`}>
      {telegram ? (
        <p>
          Tap <strong>Approve</strong> or <strong>Decline</strong> on the
          message we sent you in Telegram, or use {where}.
        </p>
      ) : (
        <>
          <p>Use {where}.</p>
          <SendToTelegram />
        </>
      )}
      <p className="opacity-80">
        Nothing is charged until you approve. Unanswered requests expire after
        24 hours.
      </p>
    </div>
  );
}
