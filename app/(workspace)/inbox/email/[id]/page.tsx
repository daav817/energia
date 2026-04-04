"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { EmailDetailPanel } from "@/components/communications/EmailDetailPanel";

type EmailMessage = {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  labelIds?: string[];
};

type EmailDetail = {
  body: string;
  bodyHtml: string;
  subject: string;
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  date: string;
  labelIds: string[];
  attachments?: {
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
  }[];
  inlineImages?: Record<string, { attachmentId: string; mimeType: string }>;
};

export default function EmailWindowPage() {
  const params = useParams();
  const id = params.id as string;
  const [email, setEmail] = useState<EmailMessage | null>(null);
  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/emails/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEmail({
          id: data.id,
          subject: data.subject,
          from: data.from,
          to: data.to,
          date: data.date,
          labelIds: data.labelIds,
        });
        setDetail({
          body: data.body,
          bodyHtml: data.bodyHtml,
          subject: data.subject,
          from: data.from,
          to: data.to,
          cc: data.cc || "",
          bcc: data.bcc || "",
          date: data.date,
          labelIds: data.labelIds || [],
          attachments: data.attachments || [],
          inlineImages: data.inlineImages ?? {},
        });
      })
      .catch(() => setEmail(null))
      .finally(() => setLoading(false));
  }, [id]);

  const modifyEmail = async (
    msgId: string,
    opts: { addLabelIds?: string[]; removeLabelIds?: string[]; trash?: boolean; untrash?: boolean }
  ) => {
    try {
      const res = await fetch(`/api/emails/${msgId}/modify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (opts.trash || opts.removeLabelIds?.includes("INBOX")) {
        window.close();
        return;
      }
      if (data.labelIds && email) {
        setEmail({ ...email, labelIds: data.labelIds });
        setDetail((d) => (d ? { ...d, labelIds: data.labelIds } : null));
      }
    } catch (err) {
      console.error("Modify failed:", err);
    }
  };

  const openInNewWindow = (msg: EmailMessage) => {
    window.open(`/inbox/email/${msg.id}`, "_blank", "width=800,height=600");
  };

  const handleReply = (msg: EmailMessage) => {
    window.location.href = `/compose?reply=${msg.id}`;
  };

  const handleForward = (msg: EmailMessage) => {
    window.location.href = `/compose?forward=${msg.id}`;
  };

  if (loading) return <div className="p-8 text-center comms-inbox">Loading...</div>;
  if (!email) return <div className="p-8 text-center comms-inbox">Email not found.</div>;

  return (
    <div className="min-h-screen bg-background p-6 comms-inbox">
      <div className="mx-auto max-w-4xl">
        <EmailDetailPanel
          email={email}
          detail={detail}
          detailLoading={detailLoading}
          selectedLabel={email.labelIds?.includes("TRASH") ? "TRASH" : "INBOX"}
          onModify={modifyEmail}
          onClose={() => window.close()}
          onOpenInNewWindow={openInNewWindow}
          onReply={handleReply}
          onForward={handleForward}
          isPopout
        />
      </div>
    </div>
  );
}
